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

/**
 * Stored texts (activity log, notifications, policy checks, decoded actions…) keep both languages: the English text
 * in the field itself (`message`) and the French one next to it (`messageFr`). They are localised when they are
 * READ (services pass every JSON response through localizeDeep in the x-lang language), in the reader's language — not in the language of whoever triggered the event. Legacy records only have a
 * (French) `message`: they are shown as-is.
 */
export interface Bilingual {
  en: string;
  fr: string;
}
export const both = (en: string, fr: string): Bilingual => ({ en, fr });
/** Accepts a plain string (same text in both languages) or a Bilingual pair. */
export const splitText = (v: string | Bilingual): Bilingual => (typeof v === 'string' ? { en: v, fr: v } : v);

/** `{ [key]: en, [key + 'Fr']: fr }` — spread into a stored record. */
export const biField = <K extends string>(key: K, en: string, fr: string) => ({ [key]: en, [`${key}Fr`]: fr }) as Record<K, string> & Record<`${K}Fr`, string>;

const FR_SUFFIX = /^(.+)Fr$/;

/**
 * Returns a copy of `v` where every `xFr` sibling replaces `x` when lang is 'fr' (and is dropped otherwise).
 * Anything else is copied unchanged (including `{ en, fr }` objects, which some clients pick themselves).
 */
export function localizeDeep<T>(v: T, lang: Lang, depth = 0): T {
  if (depth > 40 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => localizeDeep(x, lang, depth + 1)) as unknown as T;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v; // Date, Buffer, class instances: untouched
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(src)) {
    const m = k.match(FR_SUFFIX);
    if (m && m[1] in src) continue; // folded into its base field below
    const frKey = `${k}Fr`;
    out[k] = localizeDeep(lang === 'fr' && frKey in src && src[frKey] != null ? src[frKey] : val, lang, depth + 1);
  }
  return out as T;
}
