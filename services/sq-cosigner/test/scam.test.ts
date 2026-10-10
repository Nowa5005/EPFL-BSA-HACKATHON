// #19 — unrecognised tokens and address poisoning: policy engine + independent validation refuse them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, parseEther, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, decodeSafeTx, erc20Iface, foreignAddressFormat, isLookalike } from '@sq/shared';
import { evaluatePolicy } from '../src/policy';

process.env.COSIGNER_DATA_DIR ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mywall-scam-'));
const { validateSafeTx } = await import('../src/validate');

const SAFE = '0x1111111111111111111111111111111111111111';
const CARLA = getAddress('0xabcd111111111111111111111111111111119876');
const LOOKALIKE = getAddress('0xabcd222222222222222222222222222222229876');
const SCAM_TOKEN = getAddress('0x5ca1ab1e00000000000000000000000000000001');
const old = new Date(Date.now() - 3600_000).toISOString();
const contacts = [{ name: 'Carla', address: CARLA, addedAt: old }];

function run(tx: ReturnType<typeof buildSafeTx>, over: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) {
  return evaluatePolicy({ tx, decoded: decodeSafeTx(tx, SAFE), safeAddress: SAFE, contacts, lookalikeRefs: contacts, spentTodayUsdc: 0, sponsoredToday: 0, balances: { eth: parseEther('1'), usdc: parseUnits('1000', 6) }, ...over });
}
const usdc = (to: string, amount: string) => buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [to, parseUnits(amount, 6)]), nonce: 0 });

test('look-alike definition: same first 4 and last 4 hex characters, different address', () => {
  assert.ok(isLookalike(CARLA, LOOKALIKE));
  assert.ok(!isLookalike(CARLA, CARLA));
  assert.ok(!isLookalike(CARLA, '0xabcd111111111111111111111111111111119875'));
});

test('sending to a look-alike of a contact is refused with a clear explanation', () => {
  const r = run(usdc(LOOKALIKE, '1'));
  assert.equal(r.decision, 'reject');
  const c = r.checks.find((x) => x.id === 'lookalike')!;
  assert.equal(c.status, 'fail');
  assert.match(c.detail!, /looks like the address saved for “Carla”/);
  assert.match(c.detailFr!, /ressemble/);
  // ETH too
  assert.equal(run(buildSafeTx({ to: LOOKALIKE, value: parseEther('0.001'), nonce: 0 })).decision, 'reject');
  // the real contact is fine
  assert.equal(run(usdc(CARLA, '1')).checks.find((x) => x.id === 'lookalike'), undefined);
});

test('any call on an unrecognised token (transfer, approve, arbitrary) is refused — policy and validation', () => {
  const transfer = buildSafeTx({ to: SCAM_TOKEN, data: erc20Iface.encodeFunctionData('transfer', [CARLA, 1n]), nonce: 0 });
  const approve = buildSafeTx({ to: SCAM_TOKEN, data: erc20Iface.encodeFunctionData('approve', [CARLA, 1n]), nonce: 0 });
  const claim = buildSafeTx({ to: SCAM_TOKEN, data: '0x4e71d92d', nonce: 0 }); // claim()
  for (const tx of [transfer, approve]) {
    const r = run(tx);
    assert.equal(r.decision, 'reject');
    assert.equal(r.checks.find((x) => x.id === 'unknown-token')?.status, 'fail');
    assert.throws(() => validateSafeTx(tx, SAFE), /unrecognised token/);
  }
  assert.equal(run(claim, { unrecognisedTokens: [SCAM_TOKEN] }).decision, 'reject', 'arbitrary call on a token seen by the indexer');
  assert.throws(() => validateSafeTx(claim, SAFE), /unrecognised operation/);
  // the whitelisted USDC is unaffected
  assert.equal(run(usdc(CARLA, '1')).checks.find((x) => x.id === 'unknown-token'), undefined);
});

test('#20 other-chain address formats are recognised (dedicated message in the send form)', () => {
  assert.equal(foreignAddressFormat('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), 'Bitcoin');
  assert.equal(foreignAddressFormat('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL'), 'Tron');
  assert.equal(foreignAddressFormat('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'), 'Solana');
  assert.equal(foreignAddressFormat(CARLA), null);
});
