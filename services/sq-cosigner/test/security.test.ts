// Security tests (wallet level). Runs in an isolated temp data dir with its own master key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AbiCoder, Wallet, MaxUint256, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, erc20Iface, swapOwnerData } from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-sec-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

const SAFE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';

test('1. an existing plaintext key, once migrated, still decrypts to EXACTLY the same address and key', async () => {
  const { migrateKeyFile, readEncryptedFile, decryptKey } = await import('../src/keyvault');
  const relayer = Wallet.createRandom();
  const k2 = Wallet.createRandom();
  const file = path.join(dir, 'legacy-keys.json');
  fs.writeFileSync(file, JSON.stringify({ relayer: { address: relayer.address, privateKey: relayer.privateKey }, cosigners: { 'CH-1': { address: k2.address, privateKey: k2.privateKey, createdAt: 'x' } } }));
  assert.equal(migrateKeyFile(file, process.env.SERVICE_MASTER_KEY!), 'migrated');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(relayer.privateKey.slice(2)) && !raw.includes(k2.privateKey.slice(2)), 'no plaintext key left in the file');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  const enc = readEncryptedFile(file);
  const r = decryptKey(enc.relayer, process.env.SERVICE_MASTER_KEY!);
  const c = decryptKey(enc.cosigners['CH-1'], process.env.SERVICE_MASTER_KEY!);
  assert.equal(r.address, relayer.address);
  assert.equal(r.privateKey, relayer.privateKey);
  assert.equal(c.address, k2.address);
  // idempotent: a second run leaves the file untouched
  assert.equal(migrateKeyFile(file, process.env.SERVICE_MASTER_KEY!), 'already-encrypted');
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
  // wrong master key cannot decrypt
  assert.throws(() => decryptKey(enc.relayer, 'another-master-key-0123456789abcdefgh'));
});

test('2. a SafeTx whose calldata is modified after validation is refused', async () => {
  const { db } = await import('../src/db');
  const { createPreview, consumePreview } = await import('../src/previews');
  db.update((d) => (d.clients['CH-T'] = { clientId: 'CH-T', name: 'T', email: 't@x', devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full', safeAddress: SAFE } as any));
  const tx = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [BOB, parseUnits('10', 6)]), nonce: 3 });
  const fee = { available: true, chf: 0.01, eth: '0', gasUnits: '0', demo: false };
  const p = createPreview({ clientId: 'CH-T', safeAddress: SAFE, safeTx: tx, safeTxHash: '0x' + '00'.repeat(32), intent: {}, fee });
  // attacker swaps the amount in the calldata (10 → 10 000 USDC) after the client validated the preview
  const tampered = { ...tx, data: erc20Iface.encodeFunctionData('transfer', [BOB, parseUnits('10000', 6)]) };
  assert.throws(() => consumePreview(p.id, 'CH-T', tampered), (e: any) => e.status === 409 && e.extra?.code === 'tx-modified');
  // and the preview is single use: the legitimate tx works once, never twice
  const p2 = createPreview({ clientId: 'CH-T', safeAddress: SAFE, safeTx: tx, safeTxHash: '0x' + '00'.repeat(32), intent: {}, fee });
  assert.equal(consumePreview(p2.id, 'CH-T', tx).id, p2.id);
  assert.throws(() => consumePreview(p2.id, 'CH-T', tx), (e: any) => e.extra?.code === 'preview-used');
  // another client cannot use it
  const p3 = createPreview({ clientId: 'CH-T', safeAddress: SAFE, safeTx: tx, safeTxHash: '0x' + '00'.repeat(32), intent: {}, fee });
  assert.throws(() => consumePreview(p3.id, 'CH-OTHER', tx), (e: any) => e.status === 404);
});

test('2b. the validator refuses unsupported forms of a transaction', async () => {
  const { validateSafeTx } = await import('../src/validate');
  const ok = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [BOB, 1n]), nonce: 0 });
  assert.equal(validateSafeTx(ok, SAFE).kind, 'erc20-transfer');
  const err = (t: any) => assert.throws(() => validateSafeTx(t, SAFE), (e: any) => e.status === 400);
  err({ ...ok, data: ok.data + '00' }); // trailing bytes
  err({ ...ok, operation: 1 }); // DELEGATECALL
  err({ ...ok, gasPrice: '1', refundReceiver: BOB }); // refund drain
  err({ ...ok, value: '1' }); // ETH attached to a token call
  err({ ...ok, data: '0x23b872dd' + AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256'], [SAFE, BOB, 1n]).slice(2) }); // transferFrom: unsupported
  err(buildSafeTx({ to: BOB, data: '0xdeadbeef', nonce: 0 })); // unknown contract call
  err(buildSafeTx({ to: SAFE, data: swapOwnerData([BOB, SAFE], BOB, '0x4444444444444444444444444444444444444444'), nonce: 0 })); // owner change outside recovery
  assert.equal(validateSafeTx(buildSafeTx({ to: SAFE, data: swapOwnerData([BOB, SAFE], BOB, '0x4444444444444444444444444444444444444444'), nonce: 0 }), SAFE, { allowOwnerChange: true }).kind, 'swap-owner');
  const approve = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('approve', [BOB, MaxUint256]), nonce: 0 });
  assert.equal(validateSafeTx(approve, SAFE).kind, 'erc20-approve');
});

test('3. a frozen wallet cannot obtain a co-signature (K2 is never released)', async () => {
  const { db } = await import('../src/db');
  const { getOrCreateCosigner, cosignerWallet } = await import('../src/keys');
  db.update((d) => (d.clients['CH-F'] = { clientId: 'CH-F', name: 'F', email: 'f@x', devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full' } as any));
  const addr = getOrCreateCosigner('CH-F');
  assert.equal(cosignerWallet('CH-F').address, addr); // not frozen: available
  db.update((d) => {
    d.clients['CH-F'].frozen = true;
    d.clients['CH-F'].frozenBy = 'client';
  });
  assert.throws(() => cosignerWallet('CH-F'), (e: any) => e.status === 423);
  // the key on disk is encrypted, and the file never contains it in clear
  const raw = fs.readFileSync(path.join(dir, 'keys.json'), 'utf8');
  assert.ok(raw.includes('mywall-keys-encrypted-v1'));
});
