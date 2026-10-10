import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data dir: importing snapshots.ts loads the co-signer db module.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-snap-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

const { makeSnapshot, valueSnapshot, seriesFor, compact, shouldRecord } = await import('../src/snapshots');

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 10, 12);
// Test fixture rates (not used by the app): the point is that each snapshot keeps ITS OWN rate.
const rate = (chf: number) => ({ chf, asOf: new Date(NOW).toISOString(), fetchedAt: new Date(NOW).toISOString(), stale: false, provider: 'test' });
const snap = (hoursAgo: number, eth: string, usdc: string, ethChf?: number, usdcChf?: number) =>
  makeSnapshot(new Date(NOW - hoursAgo * H), { ETH: eth, USDC: usdc }, { ...(ethChf ? { ETH: rate(ethChf) } : {}), ...(usdcChf ? { USDC: rate(usdcChf) } : {}) });

test('each snapshot is valued at the price recorded at that time (not today’s price)', () => {
  const a = valueSnapshot(snap(10, '1', '100', 2000, 0.9));
  const b = valueSnapshot(snap(1, '1', '100', 3000, 0.8));
  assert.equal(a.total, 2000 + 90);
  assert.equal(b.total, 3000 + 80);
  assert.equal(a.assets.ETH.value, 2000);
});

test('a held asset without a recorded rate is null — never guessed, never 0', () => {
  const v = valueSnapshot(snap(1, '0.5', '10', undefined, 0.9));
  assert.equal(v.assets.ETH.value, null);
  assert.equal(v.total, null);
  // an asset not held needs no rate
  assert.equal(valueSnapshot(snap(1, '0', '10', undefined, 0.9)).total, 9);
});

test("don't fabricate history: no snapshots → no points and not enough data", () => {
  const s = seriesFor([], '7d', NOW);
  assert.equal(s.points.length, 0);
  assert.equal(s.enough, false);
  assert.equal(s.recordingSince, null);
});

test('recording started recently: points exist but a long period is flagged not enough / partial', () => {
  const snaps = [snap(4, '1', '0', 2000), snap(2, '1', '0', 2010), snap(1, '1', '0', 2020)];
  const day = seriesFor(snaps, '24h', NOW);
  assert.equal(day.enough, true); // 3 h of a 24 h period ≥ 10 %
  assert.equal(day.partial, true);
  const year = seriesFor(snaps, '1Y', NOW);
  assert.equal(year.enough, false); // 3 h is not a year of history
  assert.equal(year.points.length, 3); // but nothing invented either
  assert.equal(year.recordingSince, snaps[0].at);
});

test('period filter really changes the data', () => {
  const snaps = [snap(24 * 20, '1', '0', 1500), snap(24 * 3, '1', '0', 1800), snap(2, '1', '0', 2000)];
  assert.equal(seriesFor(snaps, '24h', NOW).points.length, 1);
  assert.equal(seriesFor(snaps, '7d', NOW).points.length, 2);
  assert.equal(seriesFor(snaps, '1M', NOW).points.length, 3);
});

test('retention keeps recent points and downsamples older ones', () => {
  const snaps = [] as ReturnType<typeof snap>[];
  for (let m = 0; m < 60 * 24 * 5; m += 15) snaps.push(makeSnapshot(new Date(NOW - (60 * 24 * 5 - m) * 60e3), { ETH: '1', USDC: '0' }, {}));
  const c = compact(snaps, NOW);
  const recent = c.filter((s) => NOW - new Date(s.at).getTime() <= 48 * H).length;
  assert.equal(recent, snaps.filter((s) => NOW - new Date(s.at).getTime() <= 48 * H).length);
  assert.ok(c.length < snaps.length);
  assert.ok(c.length - recent <= 24 * 3 + 1); // ≤ 1 per hour beyond 48 h
});

test('rate limiting of opportunistic snapshots', () => {
  assert.equal(shouldRecord(undefined, NOW, 5 * 60e3), true);
  assert.equal(shouldRecord(snap(0.05, '1', '0'), NOW, 5 * 60e3), false); // 3 min ago
  assert.equal(shouldRecord(snap(0.1, '1', '0'), NOW, 5 * 60e3), true); // 6 min ago
});
