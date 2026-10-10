// Visual check: captures the key screens at mobile (390×844), tablet (820×1180) and desktop (1440×900)
// into docs/design/screens/. Requires `npm run dev` running. Uses a virtual WebAuthn authenticator
// (Chrome DevTools Protocol) so the passkey steps run headless.
//
//   npm run screenshots              → full run: creates Alice's wallet (real Sepolia deploy), captures, keeps the state
//   npm run screenshots -- --reset   → also resets the demo state at the end
//   npm run screenshots -- --real    → also makes a real 1 USDC account → wallet transfer

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const OUT = path.resolve(import.meta.dirname, '..', 'docs', 'design', 'screens');
const SIZES = { mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } } as const;
const PASSWORD = 'Lac-Leman-2026-bleu!';

fs.mkdirSync(OUT, { recursive: true });
const log = (s: string) => console.log(`▶ ${s}`);

/** Client-side navigation (keeps the in-memory unlocked key). */
async function go(page: Page, p: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, p);
  await page.waitForTimeout(1200);
}

async function shoot(page: Page, name: string, full = true) {
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), fullPage: full });
  }
  await page.setViewportSize(SIZES.mobile);
}

async function main() {
  await fetch(`${BASE}`).catch(() => {
    throw new Error('Web app not reachable — start it with `npm run dev`');
  });
  for (const u of ['http://localhost:4001', 'http://localhost:4002', 'http://localhost:4003']) await fetch(`${u}/admin/reset`, { method: 'POST' });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: SIZES.mobile, deviceScaleFactor: 2, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  currentPage = page;
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  log('login');
  await page.goto(`${BASE}/login`);
  await shoot(page, '00-login');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/sq/markets');
  await page.waitForTimeout(800);
  await shoot(page, '01-sq-markets', false);
  await go(page, '/sq');
  await shoot(page, '02-sq-home');

  log('onboarding');
  await go(page, '/onboarding');
  await shoot(page, '10-onboarding-welcome');
  await page.getByRole('button', { name: 'Activer My Wall' }).click();
  await page.getByRole('button', { name: 'Utiliser le document de démonstration' }).click();
  await shoot(page, '11-onboarding-identity');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await page.getByText('Lier ', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Créer la passkey' }).click();
  await page.getByText('Mot de passe du wallet').first().waitFor();
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill('Alice-trop-court1');
  await shoot(page, '12-onboarding-password-refused');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ index: 2 });
  await selects.nth(1).selectOption({ index: 4 });
  await selects.nth(2).selectOption({ index: 6 });
  const answers = page.locator('input[type=password]');
  for (let i = 0; i < 3; i++) await answers.nth(i).fill(['Rex', 'Rue du Lac', 'Mme Dupont'][i]);
  await shoot(page, '13-onboarding-questions');
  await page.getByRole('button', { name: 'Créer mon wallet' }).click();
  await page.getByText('Votre kit de récupération').waitFor({ timeout: 120000 });
  await shoot(page, '14-onboarding-kit');
  await page.getByRole('button', { name: /Copier/ }).first().click().catch(() => undefined);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Enregistrer dans le cloud/ }).click()]);
  await dl.saveAs(path.join(OUT, '..', 'cloud-backup-sample.json')).catch(() => undefined);
  await page.getByRole('button', { name: 'Ouvrir My Wall' }).click();
  await page.waitForURL('**/wallet');

  log('activity: simulated + real reception');
  await page.getByRole('button', { name: /Simuler une réception/ }).click();
  await page.waitForTimeout(4500);
  if (process.argv.includes('--real')) {
    // optional: a real 1 USDC transfer from the Swissquote account (spends test USDC)
    await page.locator('input[aria-label="Montant en USDC"]').fill('1');
    await page.getByRole('button', { name: 'Transférer' }).click();
    await page.waitForTimeout(25000);
  }
  await go(page, '/wallet');
  await shoot(page, '20-wallet');
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.screenshot({ path: path.join(OUT, '21-wallet-sheet-up-mobile.png') });
  await go(page, '/wallet/transactions');
  await shoot(page, '22-transactions');
  await go(page, '/wallet/info');
  await shoot(page, '23-info');
  await go(page, '/wallet/swaplet');
  await page.setViewportSize(SIZES.desktop);
  await page.getByRole('button', { name: /^Aperçu/ }).first().click().catch(() => undefined);
  await shoot(page, '24-swaplet');
  await go(page, '/wallet/security');
  await shoot(page, '25-security');
  await go(page, '/send');
  await shoot(page, '26-send');
  await go(page, '/settings');
  await shoot(page, '27-settings');

  log('unlock screen');
  await page.goto(`${BASE}/wallet/unlock`);
  await shoot(page, '15-unlock');

  await browser.close();
  if (process.argv.includes('--reset')) for (const u of ['http://localhost:4001', 'http://localhost:4002', 'http://localhost:4003']) await fetch(`${u}/admin/reset`, { method: 'POST' });
  console.log(`✅ screenshots in ${path.relative(process.cwd(), OUT)}`);
}

let currentPage: Page | null = null;
main().catch(async (e) => {
  await currentPage?.screenshot({ path: path.join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => undefined);
  console.error('❌', e.message);
  process.exit(1);
});
