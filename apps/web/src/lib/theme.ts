// Appearance: System (default) / Light / Dark — SECURITY_GAPS_FIX N5.
//
// The choice is stored on THIS device (localStorage 'mw:theme', wrapped in try/catch: private mode, blocked storage);
// it is a device preference like the language, so it is not sent to the server. "System" follows the OS setting
// live through the prefers-color-scheme media query (change listener, no reload). In the native Capacitor app the
// WebView reflects the system appearance through the same media query (iOS WKWebView, Android WebView ≥ 29 with
// the app's DayNight theme), so the same code works there.
//
// The resolved theme is applied as <html data-theme="light|dark"> + color-scheme; the palettes live in index.css.
// index.html applies the stored choice before the first paint (no flash of the wrong theme).

import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
const KEY = 'mw:theme';
const QUERY = '(prefers-color-scheme: dark)';

let memPref: ThemePref | null = null; // fallback when storage is unavailable
export function getThemePref(): ThemePref {
  if (memPref) return memPref;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;
export const resolveTheme = (pref: ThemePref, sysDark: boolean): ResolvedTheme => (pref === 'system' ? (sysDark ? 'dark' : 'light') : pref);

let snap = { pref: getThemePref(), resolved: resolveTheme(getThemePref(), systemDark()) };
const listeners = new Set<() => void>();

function apply() {
  const pref = getThemePref();
  snap = { pref, resolved: resolveTheme(pref, systemDark()) };
  if (typeof document !== 'undefined') {
    const el = document.documentElement;
    el.dataset.theme = snap.resolved;
    el.style.colorScheme = snap.resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', snap.resolved === 'dark' ? '#111317' : '#f0f3fa');
  }
  listeners.forEach((f) => f());
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    memPref = pref; // storage unavailable: applied for this page only
  }
  apply();
}

if (typeof window !== 'undefined') {
  apply();
  window.matchMedia?.(QUERY).addEventListener?.('change', apply);
  window.addEventListener('storage', (e) => e.key === KEY && apply()); // other tabs
}

export function useTheme() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => snap,
  );
}
