// Mobile visual style (SECURITY_GAPS_FIX N7) — WHEN it applies.
//
// The mobile redesign is applied ONLY:
//   - in app mode (native Capacitor shell, app bundle, owner's /preview/app frame) — lib/platform.ts isApp;
//   - on a really mobile / touch device: (pointer: coarse) AND width < 768 px (Chrome DevTools device mode included).
// Narrowing a desktop browser window keeps the existing layout (fine pointer → no mobile style).
//
// It is exposed two ways: the `mw-mobile` class on <html> (styles in src/styles/mobile.css, all scoped under it)
// and the useMobileStyle() hook for the few components that render a different variant.

import { useSyncExternalStore } from 'react';
import { isApp } from './platform';

export const MOBILE_STYLE_QUERY = '(pointer: coarse) and (max-width: 767.98px)';
export const MOBILE_STYLE_CLASS = 'mw-mobile';

/** Pure decision (unit-tested). */
export const mobileStyleFor = (app: boolean, coarseNarrow: boolean) => app || coarseNarrow;

const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_STYLE_QUERY) : null);
const current = () => mobileStyleFor(isApp, !!mq()?.matches);

function apply() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle(MOBILE_STYLE_CLASS, current());
}

if (typeof window !== 'undefined') {
  apply();
  mq()?.addEventListener?.('change', apply);
}

export function useMobileStyle() {
  return useSyncExternalStore(
    (cb) => {
      const m = mq();
      m?.addEventListener?.('change', cb);
      return () => m?.removeEventListener?.('change', cb);
    },
    current,
    () => isApp,
  );
}
