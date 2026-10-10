import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, layoutReducer, normalizeLayout, validateWidgetsPatch, visibleWidgets, WIDGET_IDS } from '../src/widgets';

test('default layout: every widget once, required visible, optional ones hidden', () => {
  const d = defaultLayout('mobile');
  assert.deepEqual([...d.order].sort(), [...WIDGET_IDS].sort());
  assert.ok(!d.hidden.includes('balances') && !d.hidden.includes('actions'));
  assert.deepEqual(d.hidden, ['scheduled', 'approvals']);
});

test('normalize: unknown ids dropped, duplicates removed, stored order preserved', () => {
  const l = normalizeLayout({ order: ['info', 'evil<script>', 'balances', 'info', 'actions', 42, 'crypto'], hidden: ['nope'] });
  assert.deepEqual(l.order.filter((x) => ['info', 'balances', 'actions', 'crypto'].includes(x)), ['info', 'balances', 'actions', 'crypto']);
  assert.equal(new Set(l.order).size, l.order.length);
  assert.equal(l.order.length, WIDGET_IDS.length);
  assert.ok(!l.order.includes('evil<script>' as any));
});

test('normalize: required widgets re-added and can never be hidden', () => {
  const l = normalizeLayout({ order: ['recent', 'info'], hidden: ['balances', 'actions', 'info'] });
  assert.ok(l.order.includes('balances') && l.order.includes('actions'));
  assert.deepEqual(l.hidden.filter((x) => x === 'balances' || x === 'actions'), []);
  assert.ok(l.hidden.includes('info'));
  assert.ok(visibleWidgets(l).includes('balances'));
});

test('normalize: missing known widget inserted at its default place with its default visibility', () => {
  const l = normalizeLayout({ order: ['balances', 'actions', 'crypto', 'chart', 'recent', 'account', 'security', 'fees', 'info'], hidden: [] });
  assert.deepEqual(l.order.slice(-2), ['scheduled', 'approvals']);
  assert.ok(l.hidden.includes('scheduled') && l.hidden.includes('approvals'));
  // reordered layout: 'chart' missing → goes right after 'crypto' (its default predecessor)
  const m = normalizeLayout({ order: ['info', 'crypto', 'balances'], hidden: [] });
  assert.equal(m.order[m.order.indexOf('crypto') + 1], 'chart');
});

test('normalize: garbage gives the default layout', () => {
  for (const g of [null, undefined, 42, 'x', [], { order: [] }, { order: 'balances' }]) assert.deepEqual(normalizeLayout(g), defaultLayout());
});

test('reducer: move up/down, bounds, moveTo', () => {
  let l = defaultLayout();
  l = layoutReducer(l, { type: 'move', id: 'crypto', delta: -1 });
  assert.deepEqual(l.order.slice(0, 3), ['balances', 'crypto', 'actions']);
  const top = layoutReducer(defaultLayout(), { type: 'move', id: 'balances', delta: -1 });
  assert.deepEqual(top, defaultLayout());
  const last = defaultLayout().order.at(-1)!;
  assert.deepEqual(layoutReducer(defaultLayout(), { type: 'move', id: last, delta: 1 }), defaultLayout());
  l = layoutReducer(defaultLayout(), { type: 'moveTo', id: 'info', index: 0 });
  assert.equal(l.order[0], 'info');
  l = layoutReducer(l, { type: 'moveTo', id: 'info', index: 999 });
  assert.equal(l.order.at(-1), 'info');
});

test('reducer: hide/show; required cannot be hidden; reset', () => {
  let l = layoutReducer(defaultLayout(), { type: 'hide', id: 'chart' });
  assert.ok(l.hidden.includes('chart'));
  assert.ok(!visibleWidgets(l).includes('chart'));
  l = layoutReducer(l, { type: 'hide', id: 'balances' });
  assert.ok(!l.hidden.includes('balances'));
  l = layoutReducer(l, { type: 'show', id: 'chart' });
  assert.ok(!l.hidden.includes('chart'));
  l = layoutReducer(layoutReducer(l, { type: 'move', id: 'info', delta: -5 }), { type: 'reset' });
  assert.deepEqual(l, defaultLayout());
});

test('server validation: strict shape, ids normalised', () => {
  assert.equal(validateWidgetsPatch(null).ok, false);
  assert.equal(validateWidgetsPatch([]).ok, false);
  assert.equal(validateWidgetsPatch({ tablet: { order: [] } }).ok, false);
  assert.equal(validateWidgetsPatch({ mobile: { order: 'x' } }).ok, false);
  assert.equal(validateWidgetsPatch({ mobile: { order: [1, 2] } }).ok, false);
  assert.equal(validateWidgetsPatch({ mobile: { order: [], extra: true } }).ok, false);
  assert.equal(validateWidgetsPatch({ mobile: { order: new Array(33).fill('info') } }).ok, false);
  const r = validateWidgetsPatch({ desktop: { order: ['info', 'unknown', 'balances'], hidden: ['actions', 'fees'] } });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.mobile, undefined);
    const o = r.value.desktop!.order;
    assert.ok(o.indexOf('info') < o.indexOf('balances'));
    assert.ok(!o.includes('unknown' as any));
    assert.deepEqual(r.value.desktop!.hidden, ['fees', 'scheduled', 'approvals']);
  }
});
