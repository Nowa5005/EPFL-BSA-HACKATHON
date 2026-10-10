// Service base URLs used by the browser/app bundle.
// Default: http://localhost:400x (packages/shared SERVICE_URLS) — right for the web app on the dev Mac and for the
// preview frame. A native app on a phone cannot reach the Mac through "localhost", so the host is configurable
// AT BUILD TIME (public values only, never a secret):
//   VITE_API_HOST=http://192.168.1.20 npm run app:build     → http://192.168.1.20:4001 … :4004
//   VITE_COSIGNER_URL / VITE_PARTNER_URL / VITE_BANK_URL / VITE_MARKET_URL → full override per service
// Phone / tunnel (page not on localhost, no VITE_API_HOST): same-origin Vite proxy /svc/<service> (#2).
// See docs/MOBILE.md. The services must also list the app origin in their CORS allowlist (ALLOWED_ORIGINS).

import { PORTS, SERVICE_URLS } from '@sq/shared';

type Env = Record<string, string | undefined>;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * #2 — The services bind 127.0.0.1 only. A page opened from another device (phone on the LAN, dev tunnel) cannot
 * reach them directly, so it goes through the Vite proxy on its own origin: <origin>/svc/<service>
 * (apps/web/vite.config.ts). Explicit VITE_* settings always win; on localhost nothing changes.
 */
export function resolveServiceUrls(env: Env, page?: { origin: string; hostname: string; protocol: string }): typeof SERVICE_URLS {
  const host = env.VITE_API_HOST?.trim().replace(/\/+$/, '');
  const viaProxy = !host && !!page && /^https?:$/.test(page.protocol) && !LOCAL_HOSTNAMES.has(page.hostname);
  const base = (k: keyof typeof PORTS) =>
    viaProxy ? `${page!.origin}/svc/${k}` : host ? `${host}:${PORTS[k]}` : SERVICE_URLS[k as keyof typeof SERVICE_URLS];
  const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim().replace(/\/+$/, '') : fallback);
  return {
    cosigner: pick(env.VITE_COSIGNER_URL, base('cosigner')),
    partner: pick(env.VITE_PARTNER_URL, base('partner')),
    bank: pick(env.VITE_BANK_URL, base('bank')),
    market: pick(env.VITE_MARKET_URL, base('market')),
  };
}

export const WEB_SERVICE_URLS = resolveServiceUrls(
  (import.meta.env ?? {}) as unknown as Env,
  typeof window !== 'undefined' && window.location ? window.location : undefined,
);
