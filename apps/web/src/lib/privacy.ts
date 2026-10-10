// Privacy lock wiring (browser + native app). State machine: lib/privacyLock.ts. Screen: wallet/PrivacyScreen.tsx.
//
// Triggers: document visibilitychange → hidden (also covers the recent-apps / tab-switcher preview: the content is
// hidden SYNCHRONOUSLY in the event handler), pagehide, Capacitor App 'pause' (native background), sleep detection,
// inactivity (demo 60 s, configurable with VITE_PRIVACY_IDLE_SECONDS; production 5 min — PRIVACY_IDLE_PROD_MS).
// Production native target (documented in docs/MOBILE.md): also set Android FLAG_SECURE and an iOS snapshot cover
// view in sceneWillResignActive, which the OS uses for the app switcher before any JavaScript can run.

import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createPrivacyLock, PRIVACY_IDLE_DEMO_MS } from './privacyLock';
import { isUnlocked, subscribe as subscribeDevice, unlock, unlockedKey } from './device';
import { startAuthentication } from './passkeyGuard'; // guarded for the native app
import { cosigner } from './api';
import { isNative } from './platform';
import { tr } from './i18n';

const envIdle = Number(import.meta.env.VITE_PRIVACY_IDLE_SECONDS);
export const privacyLock = createPrivacyLock({ idleMs: envIdle > 0 ? envIdle * 1000 : PRIVACY_IDLE_DEMO_MS });

/** Dev-only test hook: localStorage 'mw:test:privacy-idle-ms' shortens the inactivity delay (Playwright). */
function devIdleOverride() {
  if (!import.meta.env.DEV) return;
  try {
    const v = Number(localStorage.getItem('mw:test:privacy-idle-ms'));
    if (v > 0) privacyLock.setIdleMs(v);
  } catch {
    /* storage unavailable */
  }
}

let snap = { locked: privacyLock.isLocked(), visible: privacyLock.isVisible() };
const refresh = () => {
  snap = { locked: privacyLock.isLocked(), visible: privacyLock.isVisible() };
};
privacyLock.subscribe(refresh);
privacyLock.setWalletUnlocked(isUnlocked());
subscribeDevice(() => privacyLock.setWalletUnlocked(isUnlocked()));

const COVER_CLASS = 'mw-privacy-cover';
function leave(reason: 'hidden' | 'background') {
  if (!privacyLock.isVisible()) return;
  // 1) synchronous DOM cover (before the browser/OS takes its tab-switcher snapshot), 2) unmount via a sync render.
  document.documentElement.classList.add(COVER_CLASS);
  flushSync(() => privacyLock.leave(reason));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  devIdleOverride();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave('hidden');
    else {
      document.documentElement.classList.remove(COVER_CLASS);
      privacyLock.tick(); // detects a return after sleep
    }
  });
  window.addEventListener('pagehide', () => leave('hidden'));
  window.addEventListener('pageshow', () => document.documentElement.classList.remove(COVER_CLASS));
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) window.addEventListener(ev, () => privacyLock.activity(), { passive: true, capture: true });
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    devIdleOverride();
    privacyLock.tick();
  }, 1000);
  if (isNative)
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('pause', () => leave('background'));
      void App.addListener('resume', () => {
        document.documentElement.classList.remove(COVER_CLASS);
        privacyLock.tick();
      });
    });
  if (import.meta.env.DEV) (window as any).__mwPrivacy = privacyLock;
}

const sub = (f: () => void) => privacyLock.subscribe(f);
/** True while the privacy screen must replace the wallet (wallet unlocked but the user left). */
export const usePrivacyLocked = () => useSyncExternalStore(sub, () => snap.locked);
/** True when wallet amounts may be rendered (wallet unlocked in this session and not covered). */
export const useAmountsVisible = () => useSyncExternalStore(sub, () => snap.visible);

export class NoPasskeyError extends Error {}

/** Resume with the passkey: WebAuthn user verification (Touch ID / Face ID / device PIN — the device decides). */
export async function resumeWithPasskey(clientId: string) {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) throw new NoPasskeyError(tr('This browser cannot use passkeys. Use your wallet password.', 'Ce navigateur ne gère pas les passkeys. Utilisez votre mot de passe du wallet.'));
  const options = await cosigner.post('/webauthn/auth/options', { clientId, purpose: 'resume-session' });
  const response = await startAuthentication({ optionsJSON: options });
  await cosigner.post('/webauthn/auth/verify', { clientId, purpose: 'resume-session', response });
  privacyLock.resume();
}

/** Fallback: the wallet password, verified locally by decrypting the keystore (same attempt limiting as Unlock). */
export async function resumeWithPassword(password: string, onProgress?: (p: number) => void) {
  const key = await unlock(password, onProgress, { commit: false });
  if (key.address.toLowerCase() !== unlockedKey().address.toLowerCase()) throw new Error(tr('Incorrect password.', 'Mot de passe incorrect.'));
  privacyLock.resume();
}

/** User-facing message for a failed passkey verification. */
export function resumeErrorMessage(e: any) {
  if (e instanceof NoPasskeyError) return e.message;
  if (e?.name === 'NotAllowedError') return tr('Verification cancelled. Try again or use your wallet password.', 'Vérification annulée. Réessayez ou utilisez votre mot de passe du wallet.');
  return tr(`Passkey verification failed (${e?.message ?? 'error'}). Use your wallet password instead.`, `Vérification par passkey impossible (${e?.message ?? 'erreur'}). Utilisez plutôt votre mot de passe du wallet.`);
}
