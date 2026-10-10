import { LANG_HEADER, SERVICE_URLS } from '@sq/shared';
import { getLang } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}

async function req<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', [LANG_HEADER]: getLang() }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Service unreachable (${base}). Is "npm run dev" running?`, null);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Error ${res.status}`, json);
  return json as T;
}

const make = (base: string) => ({
  get: <T = any>(p: string) => req<T>(base, 'GET', p),
  post: <T = any>(p: string, b?: unknown) => req<T>(base, 'POST', p, b ?? {}),
});

export const cosigner = make(SERVICE_URLS.cosigner);
export const partner = make(SERVICE_URLS.partner);
export const bank = make(SERVICE_URLS.bank);
