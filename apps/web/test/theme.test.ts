// N5: both palettes (index.css) meet WCAG AA contrast for the main text / surface pairs; theme resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveTheme } from '../src/lib/theme';

const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');
function vars(block: string) {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}
const blockAfter = (marker: string) => {
  const i = css.indexOf(marker);
  assert.ok(i >= 0, marker);
  return css.slice(i, css.indexOf('}', i));
};
const light = { ...vars(blockAfter('@theme {')), ...vars(blockAfter(':root {')) };
const dark = { ...light, ...vars(blockAfter('html[data-theme="dark"] {')) };

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum ratio]
const TEXT_PAIRS: [string, string][] = [
  ['color-sq-ink', 'color-sq-bg'],
  ['color-sq-ink', 'color-sq-surface'],
  ['color-sq-ink', 'color-sq-chip'],
  ['color-sq-ink-2', 'color-sq-surface'],
  ['color-sq-ink-2', 'color-sq-bg'],
  ['color-sq-muted', 'color-sq-surface'],
  ['color-sq-muted', 'color-sq-bg'],
  ['color-sq-up', 'color-sq-surface'],
  ['color-sq-down', 'color-sq-surface'],
  ['color-sq-up', 'color-sq-ok-50'],
  ['color-sq-down', 'color-sq-bad-50'],
  ['color-sq-warn', 'color-sq-surface'],
  ['color-sq-warn', 'color-sq-warn-50'],
  ['color-sq-orange-600', 'color-sq-surface'],
  ['color-sq-orange-600', 'color-sq-orange-50'],
  ['color-sq-on-dark', 'color-sq-dark'],
  ['asset-eth', 'asset-eth-bg'],
  ['asset-usdc', 'asset-usdc-bg'],
  ['asset-btc', 'asset-btc-bg'],
  ['asset-other', 'asset-other-bg'],
];
const WHITE_ON: string[] = ['color-sq-up-solid', 'color-sq-down-solid', 'color-sq-warn-solid'];

for (const [name, pal] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`${name} palette: text pairs meet WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      assert.ok(pal[fg] && pal[bg], `${fg}/${bg} defined`);
      const r = contrast(pal[fg], pal[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} ${pal[fg]} on ${bg} ${pal[bg]} = ${r.toFixed(2)}`);
    }
  });
  test(`${name} palette: white text on filled badges meets AA`, () => {
    for (const bg of WHITE_ON) assert.ok(contrast('#ffffff', pal[bg]) >= 4.5, `${name}: white on ${bg} ${pal[bg]} = ${contrast('#ffffff', pal[bg]).toFixed(2)}`);
  });
  test(`${name} palette: borders and chart line are visible (≥ 1.2 / 3:1)`, () => {
    assert.ok(contrast(pal['color-sq-line'], pal['color-sq-surface']) >= 1.2);
    assert.ok(contrast(pal['color-sq-chart'], pal['color-sq-surface']) >= 3);
  });
}

test('orange stays the accent in both modes; white button text is bold/large-text AA (3:1)', () => {
  assert.equal(light['color-sq-orange'], dark['color-sq-orange']);
  assert.ok(contrast('#ffffff', light['color-sq-orange']) >= 3);
});

test('dark palette is designed, not inverted: backgrounds are dark, text light, surfaces raised above the page', () => {
  assert.ok(lum(dark['color-sq-bg']) < 0.02 && lum(dark['color-sq-ink']) > 0.8);
  assert.ok(lum(dark['color-sq-surface']) > lum(dark['color-sq-bg']));
});

test('theme resolution: System follows the OS, manual choice wins', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
