// UI language. English by default (also on the very first visit, whatever the browser or Swiss locale says);
// French only when the user explicitly picks it, and that explicit choice is persisted on this device.

import { DEFAULT_LANG, localeOf, type Lang } from '@sq/shared';

const KEY = 'mw:lang';
function read(): Lang {
  try {
    return localStorage.getItem(KEY) === 'fr' ? 'fr' : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}
let current: Lang = read();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = (): Lang => current;
export const locale = () => localeOf(current);

/** tr('English', 'Français') — returns the string for the current language. */
export const tr = (en: string, fr: string) => (current === 'fr' ? fr : en);

/** Explicit language choice. Reloads so every screen (and server messages) switch consistently. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode: choice only lasts for this page */
  }
  current = lang;
  location.reload();
}
