import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MaxUint256, parseEther, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, decodeSafeTx, erc20Iface, swapOwnerData } from '@sq/shared';
import { evaluatePolicy } from '../src/policy';

const SAFE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SANCTIONED = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';
const UNISWAP = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';
const UNKNOWN = '0x3333333333333333333333333333333333333333';
const old = new Date(Date.now() - 3600_000).toISOString();

function run(tx: ReturnType<typeof buildSafeTx>, over: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) {
  return evaluatePolicy({
    tx,
    decoded: decodeSafeTx(tx, SAFE),
    safeAddress: SAFE,
    contacts: [{ address: BOB, addedAt: old }],
    spentTodayUsdc: 0,
    sponsoredToday: 0,
    balances: { eth: parseEther('1'), usdc: parseUnits('1000', 6) },
    ...over,
  });
}
const usdc = (to: string, amount: string) => buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [to, parseUnits(amount, 6)]), nonce: 0 });

test('small USDC payment to a known contact is approved (standard level)', () => {
  const r = run(usdc(BOB, '10'));
  assert.equal(r.decision, 'approve');
  assert.equal(r.level, 'standard');
});

test('amount at/above 50 USDC requires step-up', () => {
  const r = run(usdc(BOB, '50'));
  assert.equal(r.decision, 'step-up');
  assert.ok(r.checks.find((c) => c.id === 'threshold')?.status === 'step-up');
});

test('new recipient requires step-up', () => {
  const r = run(usdc(UNKNOWN, '5'));
  assert.equal(r.decision, 'step-up');
  assert.equal(r.checks.find((c) => c.id === 'recipient')?.status, 'step-up');
});

test('sanctioned recipient is rejected', () => {
  const r = run(usdc(SANCTIONED, '5'), { contacts: [{ address: SANCTIONED, addedAt: old }] });
  assert.equal(r.decision, 'reject');
  assert.match(r.reasons.join(' '), /sanctions/);
});

test('insufficient on-chain funds is rejected', () => {
  const r = run(usdc(BOB, '10'), { balances: { eth: 0n, usdc: parseUnits('5', 6) } });
  assert.equal(r.decision, 'reject');
});

test('whitelisted dApp approval → step-up with unlimited warning', () => {
  const tx = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('approve', [UNISWAP, MaxUint256]), nonce: 0 });
  const r = run(tx);
  assert.equal(r.decision, 'step-up');
  assert.ok(r.checks.some((c) => c.id === 'unlimited-approve'));
});

test('approval to a non-whitelisted contract is rejected', () => {
  const tx = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('approve', [UNKNOWN, 1n]), nonce: 0 });
  assert.equal(run(tx).decision, 'reject');
});

test('owner change outside the recovery procedure is rejected', () => {
  const tx = buildSafeTx({ to: SAFE, data: swapOwnerData([BOB, UNKNOWN], BOB, '0x4444444444444444444444444444444444444444'), nonce: 0 });
  assert.equal(run(tx).decision, 'reject');
});

test('DELEGATECALL is rejected', () => {
  const tx = { ...usdc(BOB, '1'), operation: 1 as const };
  assert.equal(run(tx).decision, 'reject');
});

test('daily limit and gas quota are enforced', () => {
  assert.equal(run(usdc(BOB, '10'), { spentTodayUsdc: 995 }).decision, 'reject');
  assert.equal(run(usdc(BOB, '10'), { sponsoredToday: 20 }).decision, 'reject');
});

// ── Real market rates (no fixed constant): a missing rate is never read as 0 ──
const ethTx = (to: string, eth: string) => buildSafeTx({ to, value: parseEther(eth), nonce: 0 });

test('ETH transfer with no market rate fails safe: treated as above threshold (step-up), never as 0', () => {
  const r = run(ethTx(BOB, '0.001'), { rates: {} });
  assert.equal(r.decision, 'step-up');
  assert.equal(r.checks.find((c) => c.id === 'threshold')?.status, 'step-up');
  assert.equal(r.checks.find((c) => c.id === 'daily')?.status, 'step-up');
});

test('ETH transfer valued with the real rate: small amount passes, large amount needs step-up', async () => {
  const { usdcEquivalent } = await import('../src/policy');
  const rates = { ETH: 2000, USDC: 0.8 }; // test fixture
  const small = ethTx(BOB, '0.001'); // 2 CHF = 2.5 USDC
  assert.equal(usdcEquivalent(decodeSafeTx(small, SAFE), small, rates), 2.5);
  assert.equal(run(small, { rates }).decision, 'approve');
  assert.equal(run(ethTx(BOB, '0.1'), { rates }).checks.find((c) => c.id === 'threshold')?.status, 'step-up');
  assert.equal(usdcEquivalent(decodeSafeTx(small, SAFE), small, {}), null);
});

test('unknown spend earlier today (unvalued ETH) makes the daily limit unverifiable → step-up', () => {
  const r = run(usdc(BOB, '10'), { spentTodayUsdc: null });
  assert.equal(r.checks.find((c) => c.id === 'daily')?.status, 'step-up');
  assert.notEqual(r.decision, 'approve');
});

test('policy rates ignore old values (fail safe) and fee CHF is null without an ETH rate', async () => {
  const { policyRates, feeChf } = await import('../src/rates');
  const now = Date.now();
  const r = (ageMin: number) => ({ chf: 2000, asOf: new Date(now - ageMin * 60e3).toISOString(), fetchedAt: '', stale: false, provider: 'test' });
  assert.deepEqual(policyRates({ ETH: r(5), USDC: r(500) }, now), { ETH: 2000 });
  assert.deepEqual(feeChf('0.001', undefined), { chf: null, rate: null });
  assert.equal(feeChf('0.001', r(1)).chf, 2);
});
