// #16 — duress code (silent freeze + console alert, nothing visible to the client, constant-time check) and protective
// limits (lowering immediate, raising deferred). Isolated temp data dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hexlify, parseUnits, randomBytes } from 'ethers';
import { POLICY, USDC_ADDRESS, buildSafeTx, decodeSafeTx, erc20Iface } from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-duress-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

const { db } = await import('../src/db');
const { setDuressCode, checkDuress, removeDuressCode, planLimitChange, settleLimits, effectiveDailyLimit } = await import('../src/duress');
const { evaluatePolicy } = await import('../src/policy');

const mk = (clientId: string) =>
  db.update((d) => {
    d.clients[clientId] = { clientId, name: 'Test Client', email: 't@example.ch', devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full', safeAddress: '0x1111111111111111111111111111111111111111' } as any;
  });
const proof = () => hexlify(randomBytes(32));

test('duress code: only a salted scrypt hash is stored; wrong codes do nothing', () => {
  mk('CH-D1');
  const p = proof();
  setDuressCode('CH-D1', p);
  const rec = db.data.clients['CH-D1'].duress!;
  assert.ok(rec.salt && rec.hash && !JSON.stringify(rec).includes(p.slice(2)));
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8').includes(p.slice(2)), false);
  for (const wrong of [proof(), '', 'not-hex', null, 42, p.slice(0, -1)]) assert.equal(checkDuress('CH-D1', wrong), false);
  assert.equal(db.data.clients['CH-D1'].frozen, undefined);
  assert.equal((db.data.duressAlerts ?? []).length, 0);
});

test('duress code typed → co-signing frozen (as a compliance freeze) + console alert, nothing in the client feed', () => {
  mk('CH-D2');
  const p = proof();
  setDuressCode('CH-D2', p);
  const activityBefore = db.data.activity.length;
  const inboxBefore = db.data.inbox.length;
  assert.equal(checkDuress('CH-D2', p.toUpperCase().replace('0X', '0x')), true); // hex case-insensitive
  const c = db.data.clients['CH-D2'];
  assert.equal(c.frozen, true);
  assert.equal(c.frozenBy, 'compliance'); // the client cannot lift it (features.ts) and real txs get 423
  const alerts = db.data.duressAlerts!.filter((a) => a.clientId === 'CH-D2');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'open');
  assert.equal(checkDuress('CH-D2', p), true);
  assert.equal(db.data.duressAlerts!.filter((a) => a.clientId === 'CH-D2')[0].count, 2); // same alert, counted
  assert.equal(db.data.activity.length, activityBefore); // no client-visible trace
  assert.equal(db.data.inbox.length, inboxBefore);
  removeDuressCode('CH-D2');
  assert.equal(checkDuress('CH-D2', p), false);
});

test('same work whether or not a duress code exists (constant-time compare, dummy record)', () => {
  mk('CH-D3'); // no code
  mk('CH-D4');
  setDuressCode('CH-D4', proof());
  const time = (id: string) => {
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) checkDuress(id, proof());
    return performance.now() - t0;
  };
  time('CH-D3');
  const a = time('CH-D3');
  const b = time('CH-D4');
  assert.ok(a > 20 && b > 20, `scrypt runs in both cases (${a.toFixed(0)} / ${b.toFixed(0)} ms)`);
  assert.ok(Math.max(a, b) / Math.min(a, b) < 2.5, `similar latency (${a.toFixed(0)} vs ${b.toFixed(0)} ms)`);
});

test('limits: lowering is immediate (and cancels a pending raise); raising waits for the delay', () => {
  const now = new Date('2026-10-11T10:00:00Z');
  const cur = { dailyUsdc: 1000, updatedAt: '' };
  const low = planLimitChange(cur, 200, now, 60);
  assert.equal(low.kind, 'lowered');
  assert.equal(low.next.dailyUsdc, 200);
  const up = planLimitChange(low.next, 5000, now, 60);
  assert.equal(up.kind, 'pending');
  assert.equal(up.next.dailyUsdc, 200); // unchanged until the delay is over
  assert.equal(up.next.pending!.effectiveAt, '2026-10-11T10:01:00.000Z');
  const lowAgain = planLimitChange(up.next, 100, now, 60);
  assert.equal(lowAgain.kind, 'lowered');
  assert.equal(lowAgain.next.pending, undefined);
  // production delay: 24 h
  assert.equal(planLimitChange(cur, 2000, now, 86400).next.pending!.effectiveAt, '2026-10-12T10:00:00.000Z');
});

test('limits: a pending raise applies only after its delay, with a notification; the policy uses the effective limit', () => {
  mk('CH-L1');
  const t0 = Date.now();
  db.update((d) => (d.clients['CH-L1'].limits = { dailyUsdc: 20, updatedAt: '', pending: { dailyUsdc: 500, requestedAt: new Date(t0).toISOString(), effectiveAt: new Date(t0 + 60_000).toISOString() } }));
  assert.equal(effectiveDailyLimit(db.data.clients['CH-L1']), 20);
  assert.equal(settleLimits('CH-L1', new Date(t0 + 59_000)).dailyUsdc, 20);
  const inbox = db.data.inbox.length;
  assert.equal(settleLimits('CH-L1', new Date(t0 + 61_000)).dailyUsdc, 500);
  assert.equal(db.data.clients['CH-L1'].limits!.pending, undefined);
  assert.equal(db.data.inbox.length, inbox + 1);
  // policy: a 30 USDC payment to a known contact exceeds a 20 USDC limit, not a 500 one
  const SAFE = '0x1111111111111111111111111111111111111111';
  const BOB = '0x2222222222222222222222222222222222222222';
  const tx = buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [BOB, parseUnits('30', 6)]), nonce: 0 });
  const run = (limit?: number) =>
    evaluatePolicy({ tx, decoded: decodeSafeTx(tx, SAFE), safeAddress: SAFE, contacts: [{ address: BOB, addedAt: new Date(t0 - 3600_000).toISOString() }], spentTodayUsdc: 0, sponsoredToday: 0, balances: { eth: 0n, usdc: parseUnits('100', 6) }, dailyLimitUsdc: limit });
  assert.equal(run(20).checks.find((c) => c.id === 'daily')!.status, 'fail');
  assert.equal(run(20).decision, 'reject');
  assert.equal(run(500).checks.find((c) => c.id === 'daily')!.status, 'pass');
  assert.match(run().checks.find((c) => c.id === 'daily')!.label, new RegExp(String(POLICY.dailyLimitUsdc)));
});

test('new recipient above the threshold is always delayed; small first payments and known contacts are not flagged', () => {
  const SAFE = '0x1111111111111111111111111111111111111111';
  const NEW = '0x3333333333333333333333333333333333333333';
  const pay = (amount: string) => buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('transfer', [NEW, parseUnits(amount, 6)]), nonce: 0 });
  const run = (amount: string, contacts: { address: string; addedAt: string }[] = []) =>
    evaluatePolicy({ tx: pay(amount), decoded: decodeSafeTx(pay(amount), SAFE), safeAddress: SAFE, contacts, spentTodayUsdc: 0, sponsoredToday: 0, balances: { eth: 0n, usdc: parseUnits('1000', 6) } });
  const big = run(String(POLICY.stepUpThresholdUsdc));
  assert.equal(big.decision, 'step-up');
  assert.equal(big.checks.find((c) => c.id === 'new-recipient-delay')?.status, 'step-up');
  assert.equal(run('5').checks.some((c) => c.id === 'new-recipient-delay'), false);
  assert.equal(run('500', [{ address: NEW, addedAt: '2020-01-01T00:00:00Z' }]).checks.some((c) => c.id === 'new-recipient-delay'), false);
});
