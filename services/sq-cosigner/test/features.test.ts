import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLANS, breakEvenCents, cheapestTier, checkRecipient, commission, conditionsChanged, installments, monthlyCostCents } from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-feat-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

test('instalments split the yearly price exactly (Plus 11 × 5.83 + 5.87, Pro 12 × 12.50)', () => {
  assert.deepEqual(installments(7000), [...Array(11).fill(583), 587]);
  assert.equal(installments(7000).reduce((a, b) => a + b, 0), 7000);
  assert.deepEqual(installments(15000), Array(12).fill(1250));
});

test('commission uses the plan rate on our commission only, integer half-up rounding', () => {
  assert.equal(commission(500_000_000n, PLANS.free.commissionBps), 4_000_000n); // 500 USDC × 0.80 % = 4 USDC
  assert.equal(commission(500_000_000n, PLANS.plus.commissionBps), 2_000_000n); // −50 %
  assert.equal(commission(500_000_000n, PLANS.pro.commissionBps), 1_000_000n); // −75 %
  assert.equal(commission(1n, 80), 0n);
  assert.equal(commission(63n, 80), 1n); // 0.504 → 1 (half-up)
});

test('cost comparator: Plus beats Free above 1 750 €, Pro beats Plus above 4 000 €', () => {
  assert.equal(breakEvenCents('free', 'plus'), 175_000);
  assert.equal(breakEvenCents('plus', 'pro'), 400_000);
  assert.equal(monthlyCostCents('free', 100_000), 800);
  assert.equal(monthlyCostCents('plus', 100_000), 1100);
  assert.equal(cheapestTier(100_000), 'free');
  assert.equal(cheapestTier(200_000), 'plus');
  assert.equal(cheapestTier(500_000), 'pro');
});

test('plan entitlements are computed server-side from the subscription state', async () => {
  const { buildSubscription, effectiveTier, quoteSwap } = await import('../src/features');
  const free = { subscription: undefined } as any;
  assert.equal(effectiveTier(free), 'free');
  const plus = { subscription: buildSubscription('plus', 'annual-installments') } as any;
  assert.equal(effectiveTier(plus), 'plus');
  assert.equal(plus.subscription.schedule.length, 12);
  assert.equal(plus.subscription.schedule.reduce((n: number, s: any) => n + s.amountCents, 0), 7000);
  assert.ok(plus.subscription.commitmentEnd);
  // cancelled and past period end → back to free
  const ended = { subscription: { ...buildSubscription('pro', 'monthly', new Date(Date.now() - 40 * 864e5)), status: 'cancel-at-period-end' } } as any;
  assert.equal(effectiveTier(ended), 'free');
  // the quote applies the tier's rate: Pro pays a quarter of the free commission
  const qFree = quoteSwap({ from: 'USDC', amount: '500', slippageBps: 50, tier: 'free', now: 0 });
  const qPro = quoteSwap({ from: 'USDC', amount: '500', slippageBps: 50, tier: 'pro', now: 0 });
  assert.equal(qFree.commission, '4.0');
  assert.equal(qPro.commission, '1.0');
  assert.ok(Number(qPro.minOut) < Number(qPro.expectedOut));
});

test('confirmation is invalidated only when the change is significant (both thresholds)', () => {
  const cfg = { maxPct: 25, minAbs: 0.5 };
  assert.equal(conditionsChanged(2, 8, cfg), true); // 2 → 8 CHF
  assert.equal(conditionsChanged(0.001, 0.002, cfg), false); // +100 % but negligible
  assert.equal(conditionsChanged(2, 2.4, cfg), false); // +20 %
  assert.equal(conditionsChanged(10, 13, cfg), true);
});

test('recipient check: exact, look-alike (difference in the middle), new, bad checksum', () => {
  const contacts = [{ name: 'Bob', address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }];
  assert.equal(checkRecipient('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', contacts).status, 'exact');
  const poisoned = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'.toLowerCase().replace('94c9b9', '94c9c9');
  const r = checkRecipient(poisoned, contacts);
  assert.equal(r.status, 'lookalike');
  assert.ok((r as any).diff.length >= 1 && (r as any).diff.every((i: number) => i > 5 && i < 38)); // in the middle
  assert.equal(checkRecipient('0x' + 'ab'.repeat(20), contacts).status, 'new');
  assert.equal(checkRecipient('0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', contacts).status, 'invalid'); // checksum broken
  assert.equal(checkRecipient('0x123', contacts).status, 'invalid');
});
