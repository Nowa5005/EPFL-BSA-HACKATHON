// Non-destructive screenshots of the Swissquote side (login, home, Trade, instrument, search, News, reader,
// Inspiration, Watchlist, Alerts, App preview) at mobile / tablet / desktop into docs/design/screens/.
// Only signs in (as alice) and reads: no reset, no wallet operation, nothing created.
// Also measures the mobile logo at 360 / 390 / 430 px.
//
//   npm run screenshots:markets          (requires `npm run dev`)

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = path.resolve(import.meta.dirname, '..', 'docs', 'design', 'screens');
const SIZES = { mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } } as const;
fs.mkdirSync(OUT, { recursive: true });
const log = (s: string) => console.log(`▶ ${s}`);

async function shoot(page: Page, name: string, full = true) {
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), fullPage: full });
  }
  await page.setViewportSize(SIZES.mobile);
}
async function open(page: Page, url: string, waitText?: string | RegExp) {
  await page.goto(BASE + url);
  if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  // fr-CH browser locale on purpose: the UI must still be English by default
  const ctx = await browser.newContext({ viewport: SIZES.mobile, deviceScaleFactor: 2, locale: 'fr-CH', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('mw:preview-collapsed', '1')); // owner preview switch out of the way
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));

  log('login');
  await open(page, '/login', 'Sign in');
  await shoot(page, '00-login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/sq/**');

  log('logo sizes');
  for (const w of [360, 390, 430]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const p of ['/sq', '/sq/markets']) {
      await open(page, p);
      const box = await page.locator('img[src*="swissquote-logo"]').first().boundingBox();
      console.log(`  ${w}px ${p}: logo ${box ? `${Math.round(box.width)}×${Math.round(box.height)} at x=${Math.round(box.x)}` : 'NOT FOUND'}`);
    }
  }
  await page.setViewportSize(SIZES.mobile);

  log('home');
  await open(page, '/sq', 'Markets');
  await shoot(page, '02-sq-home');
  log('trade');
  await open(page, '/sq/markets?tab=markets&list=components', 'NESN');
  await shoot(page, '01-sq-markets');
  log('instrument');
  await open(page, '/sq/instrument/yf%3ANESN.SW', /Nestl/);
  await shoot(page, '03-instrument');
  log('news');
  await open(page, '/sq/markets?tab=news', /Read the original|Image:/);
  await shoot(page, '04-news', false);
  log('reader');
  await page.locator('main a, main button').filter({ hasText: /\w{12,}/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shoot(page, '05-news-reader', false);
  log('inspiration');
  await open(page, '/sq/markets?tab=inspiration', /Editorial/);
  await shoot(page, '06-inspiration', false);
  log('watchlist');
  await open(page, '/sq/markets?tab=watchlists');
  await shoot(page, '07-watchlist', false);
  log('alerts');
  await open(page, '/sq/markets?tab=alerts');
  await shoot(page, '08-alerts', false);
  log('app preview');
  await page.setViewportSize(SIZES.desktop);
  await page.goto(`${BASE}/preview/app?preview=1`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '29-app-preview-desktop.png') });

  await browser.close();
  log(`done → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
