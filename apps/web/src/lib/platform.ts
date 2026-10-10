// Web vs App: one codebase, two targets (see docs/MOBILE.md).
//
// "App mode" = the same screens rendered as the mobile application:
//   - inside the native Capacitor shell (iOS / Android)            → isNative = true
//   - in a bundle built for the shell (`vite build --mode app`)     → BUILD_APP = true
//   - inside the owner's browser preview frame (/preview/app)       → iframe named PREVIEW_FRAME_NAME, or ?app=1
// App mode forces the mobile layout whatever the width, and hides the owner's preview switch.
// It is NOT a customer choice: customers never see a Web/App toggle.

import { Capacitor } from '@capacitor/core';
import { useSyncExternalStore } from 'react';

export const PREVIEW_FRAME_NAME = 'mw-app-preview';
const PREVIEW_KEY = 'mw:preview';

export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
const BUILD_APP = import.meta.env.MODE === 'app' || import.meta.env.VITE_TARGET === 'app';

function detectPreviewFrame(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // ?app=1 marks this browsing context (window.name survives reloads inside the iframe, not in other tabs).
    const q = new URLSearchParams(window.location.search);
    if (q.get('app') === '1') window.name = PREVIEW_FRAME_NAME;
    return window.name === PREVIEW_FRAME_NAME && window.self !== window.top;
  } catch {
    return false;
  }
}

export const inPreviewFrame = detectPreviewFrame();
export const isApp = isNative || BUILD_APP || inPreviewFrame;

/** Desktop layout (top bar, wide grids)? Never in app mode: the app always uses the phone layout. */
export function useIsDesktopLayout(query = '(min-width: 1024px)') {
  // (own matchMedia subscription: no import from components/ui, which would create an import cycle)
  const wide = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
  return !isApp && wide;
}

/** Owner preview switch: visible in dev, or once enabled with ?preview=1 (persisted; ?preview=0 turns it off).
 *  Never inside app mode (so never inside the preview frame nor the native app). */
export function previewToolEnabled(): boolean {
  if (isApp || typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('preview');
    if (q === '1') localStorage.setItem(PREVIEW_KEY, '1');
    if (q === '0') localStorage.removeItem(PREVIEW_KEY);
    return import.meta.env.DEV || localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return import.meta.env.DEV;
  }
}

export type PasskeySupport = { ok: true } | { ok: false; reason: 'native-unconfigured' | 'no-webauthn' | 'no-platform-authenticator' };

/** Passkeys in the native WebView need an HTTPS RP ID domain + associated domains (iOS apple-app-site-association,
 *  Android assetlinks.json) or a native passkey plugin. The demo uses RP ID "localhost", which cannot work there,
 *  even if the JS API exists. Set VITE_NATIVE_PASSKEYS=1 only once that configuration is really in place. */
export async function passkeySupport(): Promise<PasskeySupport> {
  if (isNative && import.meta.env.VITE_NATIVE_PASSKEYS !== '1') return { ok: false, reason: 'native-unconfigured' };
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) return { ok: false, reason: 'no-webauthn' };
  try {
    const uv = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!uv) return { ok: false, reason: 'no-platform-authenticator' };
  } catch {
    /* unknown: let the browser decide (security keys / phone via QR may still work) */
  }
  return { ok: true };
}

/** True when the passkey ceremony must not even be attempted (native shell without the domain configuration). */
export const passkeysBlockedInNative = () => isNative && import.meta.env.VITE_NATIVE_PASSKEYS !== '1';

/** Injected browser wallets (window.ethereum, e.g. MetaMask) never exist in a native WebView: an external wallet
 *  would need WalletConnect or a deep link there. Use this before offering an "injected wallet" button. */
export const injectedWalletAvailable = () => typeof window !== 'undefined' && !isNative && !!(window as any).ethereum;
