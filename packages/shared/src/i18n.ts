// Minimal bilingual messages: English is the default language; French is available on explicit choice.
// Strings stay next to the code as tr('English', 'Français') pairs — no external catalogue to drift out of sync.

export type Lang = 'en' | 'fr';
export const DEFAULT_LANG: Lang = 'en';
export const LANG_HEADER = 'x-lang';

export const parseLang = (v: unknown): Lang => (v === 'fr' ? 'fr' : 'en');

/** Server side: pick the message for the language the client sent in the `x-lang` header. */
export const pick = (lang: Lang, en: string, fr: string) => (lang === 'fr' ? fr : en);

/** Locale used for numbers and dates. Swiss formatting either way (CHF, Europe/Zurich), only the language changes. */
export const localeOf = (lang: Lang) => (lang === 'fr' ? 'fr-CH' : 'en-CH');
