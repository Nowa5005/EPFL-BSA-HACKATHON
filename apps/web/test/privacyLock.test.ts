import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyLock, PRIVACY_IDLE_DEMO_MS, PRIVACY_IDLE_PROD_MS, SLEEP_GAP_MS } from '../src/lib/privacyLock';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('nothing is visible and nothing locks while the wallet itself is locked', () => {
  const l = createPrivacyLock();
  assert.equal(l.isVisible(), false);
  l.leave();
  assert.equal(l.isLocked(), false);
});

test('a fresh unlock shows amounts in clear (no manual reveal)', () => {
  const l = createPrivacyLock();
  l.setWalletUnlocked(true);
  assert.equal(l.isVisible(), true);
  assert.equal(l.isLocked(), false);
});

test('leaving (hidden / background) locks immediately; only resume() reopens', () => {
  const c = clock();
  const l = createPrivacyLock({ now: c.now });
  l.setWalletUnlocked(true);
  l.leave('background');
  assert.equal(l.isLocked(), true);
  assert.equal(l.isVisible(), false);
  assert.equal(l.reason(), 'background');
  l.activity();
  l.tick();
  assert.equal(l.isLocked(), true, 'activity does not unlock');
  l.resume();
  assert.equal(l.isVisible(), true);
  assert.equal(l.reason(), null);
});

test('inactivity locks after idleMs, activity postpones it', () => {
  const c = clock();
  const l = createPrivacyLock({ now: c.now, idleMs: 60_000 });
  l.setWalletUnlocked(true);
  for (let i = 0; i < 50; i++) {
    c.advance(1000);
    l.tick();
  }
  l.activity();
  for (let i = 0; i < 59; i++) {
    c.advance(1000);
    l.tick();
  }
  assert.equal(l.isLocked(), false);
  c.advance(1000);
  l.tick();
  assert.equal(l.isLocked(), true);
  assert.equal(l.reason(), 'idle');
});

test('a large gap between ticks (device sleep) locks', () => {
  const c = clock();
  const l = createPrivacyLock({ now: c.now, idleMs: 10 * 60_000 });
  l.setWalletUnlocked(true);
  c.advance(SLEEP_GAP_MS + 1);
  l.tick();
  assert.equal(l.isLocked(), true);
  assert.equal(l.reason(), 'sleep');
});

test('locking the wallet key resets; a new unlock starts open', () => {
  const l = createPrivacyLock();
  l.setWalletUnlocked(true);
  l.leave();
  l.setWalletUnlocked(false);
  assert.equal(l.isLocked(), false);
  assert.equal(l.isVisible(), false);
  l.setWalletUnlocked(true);
  assert.equal(l.isVisible(), true);
});

test('resume restarts the inactivity timer; idle delay is configurable', () => {
  const c = clock();
  const l = createPrivacyLock({ now: c.now, idleMs: 5000 });
  l.setWalletUnlocked(true);
  c.advance(5000);
  l.tick();
  assert.equal(l.isLocked(), true);
  l.resume();
  c.advance(1000);
  l.tick();
  assert.equal(l.isLocked(), false);
  l.setIdleMs(1500);
  c.advance(1000);
  l.tick();
  assert.equal(l.isLocked(), true);
});

test('listeners are notified on lock and resume; demo/prod delays documented', () => {
  const l = createPrivacyLock();
  let n = 0;
  l.subscribe(() => n++);
  l.setWalletUnlocked(true);
  l.leave();
  l.leave(); // already locked: no extra notification
  l.resume();
  assert.equal(n, 3);
  assert.equal(PRIVACY_IDLE_DEMO_MS, 60_000);
  assert.ok(PRIVACY_IDLE_PROD_MS > PRIVACY_IDLE_DEMO_MS);
});
