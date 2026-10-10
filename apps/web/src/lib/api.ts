import { LANG_HEADER } from '@sq/shared';
import { WEB_SERVICE_URLS as SERVICE_URLS } from './services';
import { getLang } from './i18n';
import { getComplianceSession, getSession, saveComplianceSession, saveSession } from './device';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}

// Authentication: the session token issued by sq-bank at login is sent as `Authorization: Bearer …` (never a cookie,
// so the browser does not attach it to cross-site requests — see docs/THREAT_MODEL.md). /admin/* calls use the
// compliance console session; an explicit token (e.g. the short-lived "fresh" token after re-authentication) wins.
interface ReqOptions {
  token?: string;
}

const PAGES_WITHOUT_CLIENT_SESSION = ['/login', '/recover', '/admin', '/attacker'];

async function req<T>(base: string, method: string, path: string, body?: unknown, opts: ReqOptions = {}): Promise<T> {
  const compliance = path.startsWith('/admin/') ? getComplianceSession()?.token : undefined;
  const token = opts.token ?? compliance ?? getSession()?.token;
  const headers: Record<string, string> = { 'content-type': 'application/json', [LANG_HEADER]: getLang() };
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Service unreachable (${base}). Is "npm run dev" running?`, null);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !opts.token) {
    // The token we sent was refused (expired, tampered, or signed with another key): forget it and sign in again.
    if (compliance) saveComplianceSession(null);
    else {
      saveSession(null);
      try {
        if (!PAGES_WITHOUT_CLIENT_SESSION.some((p) => window.location.pathname.startsWith(p))) window.location.assign('/login');
      } catch {
        /* not in a browser */
      }
    }
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Error ${res.status}`, json);
  return json as T;
}

const make = (base: string) => ({
  get: <T = any>(p: string, opts?: ReqOptions) => req<T>(base, 'GET', p, undefined, opts),
  post: <T = any>(p: string, b?: unknown, opts?: ReqOptions) => req<T>(base, 'POST', p, b ?? {}, opts),
});

export const cosigner = make(SERVICE_URLS.cosigner);
export const partner = make(SERVICE_URLS.partner);
export const bank = make(SERVICE_URLS.bank);
