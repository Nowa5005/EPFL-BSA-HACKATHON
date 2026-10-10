import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRule, initialState, parseRule, zurichLocalToUtc, type AlertRule, type EvalState } from '../src/alertsEval';

const at = (iso: string) => new Date(iso);
const q = (price: number) => ({ price, asOf: '2026-10-09T15:30:00Z' });

/** Runs a rule over a sequence of prices and returns the indices that triggered. */
function run(rule: AlertRule, prices: (number | null)[]) {
  let s: EvalState = initialState();
  const fired: number[] = [];
  const states: EvalState[] = [];
  prices.forEach((p, i) => {
    const r = evaluateRule(rule, { now: at('2026-10-10T10:00:00Z'), quote: p === null ? null : q(p) }, s);
    s = r.state;
    states.push(s);
    if (r.trigger) fired.push(i);
  });
  return { fired, states };
}

test('price above: fires once on the crossing, not again while it stays above', () => {
  const rule: AlertRule = { type: 'price-above', instrumentId: 'yf:NESN.SW', threshold: 80 };
  assert.deepEqual(run(rule, [79, 79.5, 80.5, 81, 82, 81.2]).fired, [2]);
});

test('price above: threshold already below the current price fires on the first evaluation', () => {
  const rule: AlertRule = { type: 'price-above', instrumentId: 'yf:NESN.SW', threshold: 10 };
  assert.deepEqual(run(rule, [76]).fired, [0]);
});

test('price below: re-arms only after the condition became false again', () => {
  const rule: AlertRule = { type: 'price-below', instrumentId: 'cg:ethereum', threshold: 2000 };
  // crosses below (1), stays below (2), back above → re-armed (3), crosses below again (4)
  const { fired, states } = run(rule, [2050, 1990, 1980, 2010, 1995]);
  assert.deepEqual(fired, [1, 4]);
  assert.equal(states[2].armed, false);
  assert.equal(states[3].armed, true);
});

test('missing data: no trigger, status data-unavailable, arming unchanged', () => {
  const rule: AlertRule = { type: 'price-above', instrumentId: 'yf:NESN.SW', threshold: 80 };
  const { fired, states } = run(rule, [79, null, 81]);
  assert.deepEqual(fired, [2]);
  assert.equal(states[1].status, 'data-unavailable');
  assert.equal(states[1].armed, true);
  assert.equal(states[2].status, 'ok');
});

test('% change over a period is computed against the first point of that period history', () => {
  const rule: AlertRule = { type: 'change-pct', instrumentId: 'yf:NESN.SW', period: '1W', direction: 'down', pct: 5 };
  const history = { points: [{ t: 1, v: 100 }, { t: 2, v: 97 }, { t: 3, v: 96 }] };
  const now = at('2026-10-10T10:00:00Z');
  let r = evaluateRule(rule, { now, quote: q(96), history }, initialState()); // −4 %
  assert.equal(r.trigger, undefined);
  assert.equal(r.state.lastValue, -4);
  r = evaluateRule(rule, { now, quote: q(94.5), history }, r.state); // −5.5 %
  assert.ok(r.trigger);
  assert.equal(r.trigger!.value, -5.5);
  r = evaluateRule(rule, { now, quote: q(94), history }, r.state); // still beyond: no repeat
  assert.equal(r.trigger, undefined);
  // 'either' direction fires on a rise too
  const up = evaluateRule({ ...rule, direction: 'either' }, { now, quote: q(106), history }, initialState());
  assert.ok(up.trigger);
});

test('% change without history → data unavailable, no trigger', () => {
  const rule: AlertRule = { type: 'change-pct', instrumentId: 'yf:NESN.SW', period: '1D', direction: 'either', pct: 1 };
  const r = evaluateRule(rule, { now: at('2026-10-10T10:00:00Z'), quote: q(96), history: { points: [] } }, initialState());
  assert.equal(r.trigger, undefined);
  assert.equal(r.state.status, 'data-unavailable');
});

test('reminder fires once at the Europe/Zurich time (summer time, CEST = UTC+2)', () => {
  const rule: AlertRule = { type: 'reminder', at: '2026-07-01T09:00', note: 'Check portfolio' };
  let r = evaluateRule(rule, { now: at('2026-07-01T06:59:00Z') }, initialState());
  assert.equal(r.trigger, undefined);
  r = evaluateRule(rule, { now: at('2026-07-01T07:00:00Z') }, r.state);
  assert.ok(r.trigger);
  r = evaluateRule(rule, { now: at('2026-07-01T08:00:00Z') }, r.state);
  assert.equal(r.trigger, undefined);
});

test('Europe/Zurich wall clock → UTC, including DST edges', () => {
  assert.equal(zurichLocalToUtc('2026-01-15T09:00')!.toISOString(), '2026-01-15T08:00:00.000Z'); // CET
  assert.equal(zurichLocalToUtc('2026-07-15T09:00')!.toISOString(), '2026-07-15T07:00:00.000Z'); // CEST
  // last Sunday of March 2026 (29th): 02:00–03:00 does not exist → moved forward to 03:30 CEST
  assert.equal(zurichLocalToUtc('2026-03-29T02:30')!.toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(zurichLocalToUtc('2026-03-29T03:00')!.toISOString(), '2026-03-29T01:00:00.000Z');
  // last Sunday of October 2026 (25th): 02:30 happens twice → first occurrence (CEST)
  assert.equal(zurichLocalToUtc('2026-10-25T02:30')!.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(zurichLocalToUtc('2026-10-25T03:30')!.toISOString(), '2026-10-25T02:30:00.000Z');
  assert.equal(zurichLocalToUtc('2026-02-31T10:00'), null);
  assert.equal(zurichLocalToUtc('nope'), null);
});

test('reminder around the autumn DST change fires at the right instant', () => {
  const rule: AlertRule = { type: 'reminder', at: '2026-10-25T08:00', note: '' }; // CET after the change → 07:00Z
  assert.equal(evaluateRule(rule, { now: at('2026-10-25T06:59:59Z') }, initialState()).trigger, undefined);
  assert.ok(evaluateRule(rule, { now: at('2026-10-25T07:00:00Z') }, initialState()).trigger);
});

test('rule validation rejects malformed ids and values', () => {
  assert.equal(typeof parseRule({ type: 'price-above', instrumentId: 'NESN', threshold: 1 }), 'string');
  assert.equal(typeof parseRule({ type: 'price-above', instrumentId: 'yf:NESN.SW', threshold: -1 }), 'string');
  assert.equal(typeof parseRule({ type: 'change-pct', instrumentId: 'cg:bitcoin', period: '1M', direction: 'up', pct: 5 }), 'string');
  assert.equal(typeof parseRule({ type: 'reminder', at: '2026-13-01T10:00' }), 'string');
  assert.deepEqual(parseRule({ type: 'price-below', instrumentId: 'yf:^SSMI', threshold: '12000' }), { type: 'price-below', instrumentId: 'yf:^SSMI', threshold: 12000 });
});
