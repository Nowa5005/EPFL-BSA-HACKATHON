// #3 / #19 — on-chain indexer: log parsing, idempotency (txHash:logIndex), reconciliation with app-created rows,
// confirmation depth, unrecognised tokens and look-alike senders. Fixtures only (no network): isolated data dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AbiCoder, getAddress, zeroPadValue } from 'ethers';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-idx-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';
process.env.INDEXER = 'off';

const { parseIndexerLog, applyEvent, knownPartiesOf, TRANSFER_TOPIC, SAFE_RECEIVED_TOPIC } = await import('../src/indexer');
const { db } = await import('../src/db');
const { upsertWalletTx, docIdOf } = await import('../src/walletTx');
const { USDC_ADDRESS } = await import('@sq/shared');

const SAFE = getAddress('0xdea17fdb8c93c3273cfbf5c258e6d362dc300445');
const TREASURY = getAddress('0x8f5ac56fe53a3af46ebb565a936bc094e2ec3fa0');
const STRANGER = getAddress('0x00000000000000000000000000000000000aa001');
const CONTACT = getAddress('0xabcd111111111111111111111111111111119876');
const LOOKALIKE = getAddress('0xabcd222222222222222222222222222222229876');
const SCAM_TOKEN = getAddress('0x5ca1ab1e00000000000000000000000000000001');
const set = new Set([SAFE.toLowerCase()]);
const enc = (v: bigint) => AbiCoder.defaultAbiCoder().encode(['uint256'], [v]);
const pad = (a: string) => zeroPadValue(a, 32);
let n = 0;
const hash = () => `0x${(++n).toString(16).padStart(64, 'a')}`;
const transfer = (token: string, from: string, to: string, value: bigint, txHash = hash(), index = 3, blockNumber = 100) => ({ address: token, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: enc(value), transactionHash: txHash, index, blockNumber });

db.update((d) => {
  d.clients['CH-T1'] = { clientId: 'CH-T1', name: 'Test', email: 't@example.com', safeAddress: SAFE, devices: [], contacts: [{ name: 'Carla', address: CONTACT, addedAt: '2026-01-01T00:00:00Z' }], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full' } as any;
});
const client = () => db.data.clients['CH-T1'];
const parties = () => knownPartiesOf(client(), [{ address: TREASURY, kind: 'swissquote-account' }], Object.values(db.data.walletTxs ?? {}));
const ctx = (confirmed = true) => ({ clientId: 'CH-T1', confirmed, backfilled: false, parties: parties() });
const rows = () => Object.values(db.data.walletTxs ?? {}).filter((t) => t.clientId === 'CH-T1');

test('parsing: ERC-20 / ERC-721 receipts, SafeReceived ETH, zero-value poisoning; own sends and others ignored', () => {
  const usdc = parseIndexerLog(transfer(USDC_ADDRESS, TREASURY, SAFE, 3_000_000n), set)!;
  assert.equal(usdc.kind, 'token-in');
  assert.equal(usdc.valueRaw, '3000000');
  assert.equal(usdc.from, TREASURY);
  assert.match(usdc.key, /^0x[0-9a-f]{64}:3$/);
  const nft = parseIndexerLog({ address: SCAM_TOKEN, topics: [TRANSFER_TOPIC, pad(STRANGER), pad(SAFE), pad('0x07')], data: '0x', transactionHash: hash(), index: 1, blockNumber: 5 }, set)!;
  assert.equal(nft.kind, 'nft-in');
  const eth = parseIndexerLog({ address: SAFE, topics: [SAFE_RECEIVED_TOPIC, pad(STRANGER)], data: enc(10n ** 15n), transactionHash: hash(), index: 0, blockNumber: 5 }, set)!;
  assert.deepEqual([eth.kind, eth.from, eth.valueRaw], ['eth-in', STRANGER, '1000000000000000']);
  assert.equal(parseIndexerLog(transfer(USDC_ADDRESS, SAFE, LOOKALIKE, 0n), set)!.kind, 'zero-out');
  assert.equal(parseIndexerLog(transfer(USDC_ADDRESS, SAFE, CONTACT, 5n), set), null, 'the wallet’s own (non-zero) sends are not receipts');
  assert.equal(parseIndexerLog(transfer(USDC_ADDRESS, STRANGER, CONTACT, 5n), set), null, 'other wallets ignored');
  assert.equal(parseIndexerLog({ ...transfer(USDC_ADDRESS, STRANGER, SAFE, 5n), data: '0x12' }, set), null, 'malformed data ignored');
});

test('a confirmed external USDC receipt → history row + receipt document + notification; the same log twice → no duplicate', () => {
  const ev = parseIndexerLog(transfer(USDC_ADDRESS, STRANGER, SAFE, 2_500_000n), set)!;
  const inboxBefore = db.data.inbox.length;
  assert.equal(applyEvent(ev, ctx()), 'recorded');
  const r = rows().find((t) => t.txHash === ev.txHash)!;
  assert.deepEqual([r.kind, r.status, r.asset, r.amount, r.source], ['receive', 'confirmed', 'USDC', '2.5', 'external']);
  assert.equal(r.counterpartyName, undefined, 'unknown sender: no invented name');
  assert.ok(db.data.documents![docIdOf(r)], 'receipt document created');
  assert.equal(db.data.inbox.length, inboxBefore + 1);
  assert.equal(applyEvent(ev, ctx()), 'duplicate');
  assert.equal(rows().filter((t) => t.txHash === ev.txHash).length, 1);
  assert.equal(Object.values(db.data.documents!).filter((d) => d.walletTxId === r.id).length, 1);
});

test('treasury sender is named "Your Swissquote account"; a receipt already tracked by the app is reconciled, not listed twice', () => {
  const tx = hash();
  const app = upsertWalletTx({ clientId: 'CH-T1', kind: 'receive', status: 'confirmed', asset: 'USDC', amount: '1', from: TREASURY, to: SAFE, txHash: tx, source: 'swissquote-account', counterpartyName: 'Swissquote account' });
  const ev = parseIndexerLog(transfer(USDC_ADDRESS, TREASURY, SAFE, 1_000_000n, tx), set)!;
  assert.equal(applyEvent(ev, ctx()), 'reconciled');
  assert.equal(rows().filter((t) => t.txHash === tx).length, 1);
  assert.equal(rows().find((t) => t.txHash === tx)!.id, app.id);
  const ev2 = parseIndexerLog(transfer(USDC_ADDRESS, TREASURY, SAFE, 4_000_000n), set)!;
  applyEvent(ev2, ctx());
  const r2 = rows().find((t) => t.txHash === ev2.txHash)!;
  assert.equal(r2.counterpartyName, 'Your Swissquote account');
  assert.equal(r2.source, 'swissquote-account');
});

test('confirmation depth: pending first (no receipt yet), confirmed on a later pass — same row', () => {
  const ev = parseIndexerLog(transfer(USDC_ADDRESS, STRANGER, SAFE, 7_000_000n), set)!;
  assert.equal(applyEvent(ev, ctx(false)), 'pending');
  const p = rows().find((t) => t.txHash === ev.txHash)!;
  assert.equal(p.status, 'pending');
  assert.equal(db.data.documents![docIdOf(p)], undefined);
  assert.equal(applyEvent(ev, ctx(true)), 'recorded');
  const c = rows().filter((t) => t.txHash === ev.txHash);
  assert.equal(c.length, 1);
  assert.equal(c[0].status, 'confirmed');
  assert.ok(db.data.documents![docIdOf(c[0])]);
});

test('ETH received through SafeReceived → ETH history row', () => {
  const ev = parseIndexerLog({ address: SAFE, topics: [SAFE_RECEIVED_TOPIC, pad(STRANGER)], data: enc(2n * 10n ** 15n), transactionHash: hash(), index: 9, blockNumber: 7 }, set)!;
  assert.equal(applyEvent(ev, ctx()), 'recorded');
  const r = rows().find((t) => t.txHash === ev.txHash)!;
  assert.deepEqual([r.asset, r.amount], ['ETH', '0.002']);
});

test('#19 unrecognised token received → hidden sighting only (no history row, never valued)', () => {
  const ev = parseIndexerLog(transfer(SCAM_TOKEN, STRANGER, SAFE, 10n ** 24n), set)!;
  const before = rows().length;
  assert.equal(applyEvent(ev, ctx()), 'token-sighting');
  assert.equal(rows().length, before, 'not in the valued history');
  const s = db.data.tokenSightings!['CH-T1'][SCAM_TOKEN.toLowerCase()];
  assert.equal(s.transfers.length, 1);
  assert.equal(applyEvent(ev, ctx()), 'duplicate');
});

test('#19 look-alike of a contact sending dust or zero-value → flagged "lookalike", no receipt document', () => {
  const ev = parseIndexerLog(transfer(USDC_ADDRESS, LOOKALIKE, SAFE, 1n), set)!;
  applyEvent(ev, ctx());
  const r = rows().find((t) => t.txHash === ev.txHash)!;
  assert.ok(r.flags?.includes('lookalike'));
  assert.equal(r.lookalikeOf?.name, 'Carla');
  assert.equal(r.counterpartyName, undefined, 'the look-alike never borrows the contact’s name');
  assert.equal(db.data.documents![docIdOf(r)], undefined);
  const z = parseIndexerLog(transfer(USDC_ADDRESS, SAFE, LOOKALIKE, 0n), set)!;
  applyEvent(z, ctx());
  const rz = rows().find((t) => t.txHash === z.txHash)!;
  assert.equal(rz.kind, 'send');
  assert.deepEqual(rz.flags, ['lookalike', 'zero-value']);
});
