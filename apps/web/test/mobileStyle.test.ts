import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/mobile.css'), 'utf8');

test('N7: every mobile style rule is scoped under html.mw-mobile (desktop and narrow desktop windows untouched)', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const sel = m[1].trim();
    if (sel.startsWith('@media') || sel.startsWith('@supports')) continue;
    selectors.push(...sel.split(',').map((s) => s.trim()).filter(Boolean));
  }
  assert.ok(selectors.length > 20);
  for (const s of selectors) assert.match(s, /^html\.mw-mobile[.\s:[]/, s);
});

test('N7: no heavy effects in the mobile style (gradients, blur, big shadows, decorative animations)', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /gradient\(/);
  assert.doesNotMatch(body, /backdrop-filter|filter:\s*blur/);
  assert.doesNotMatch(body, /animation:/);
  assert.doesNotMatch(body, /box-shadow:(?!\s*none)/);
});

test('N7: targeting query = touch pointer AND phone width (narrowing a desktop window does not match)', async () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/mobileStyle.ts'), 'utf8');
  assert.match(src, /MOBILE_STYLE_QUERY = '\(pointer: coarse\) and \(max-width: 767\.98px\)'/);
  assert.match(src, /mobileStyleFor = \(app: boolean, coarseNarrow: boolean\) => app \|\| coarseNarrow/);
});
