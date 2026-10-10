// Request language for server messages (node only). The security guard runs every request inside
// runWithLang(x-lang), so deep helpers (policy checks, validation, previews…) can call t(en, fr) without
// threading a `lang` parameter. English is the default (no header, timers, scripts).

import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LANG, LANG_HEADER, localizeDeep, parseLang, pick, type Lang } from './i18n';

const langStore = new AsyncLocalStorage<Lang>();

/** Runs `fn` with `lang` as the current request language. */
export const runWithLang = <R>(lang: Lang, fn: () => R): R => langStore.run(lang, fn);
/** Language of the request being served (English outside a request). */
export const reqLang = (): Lang => langStore.getStore() ?? DEFAULT_LANG;
/** Language sent by the client in the `x-lang` header. */
export const langOfReq = (req: { header(name: string): string | undefined }): Lang => parseLang(req.header(LANG_HEADER));
/** Immediate message (HTTP error, response note…) in the language of the current request. */
export const t = (en: string, fr: string): string => pick(reqLang(), en, fr);

/**
 * Express middleware: every JSON response is passed through localizeDeep() in the request language, so stored
 * bilingual texts (`message` + `messageFr`, `{ en, fr }`) reach the client in its own language.
 */
export const localizeResponses = (_req: unknown, res: { json: (body: unknown) => unknown }, next: () => void) => {
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(localizeDeep(body, reqLang()));
  next();
};
