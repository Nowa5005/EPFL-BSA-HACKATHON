// Service base URLs used by the browser/app bundle.
// Default: http://localhost:400x (packages/shared SERVICE_URLS) — right for the web app on the dev Mac and for the
// preview frame. A native app on a phone cannot reach the Mac through "localhost", so the host is configurable
// AT BUILD TIME (public values only, never a secret):
//   VITE_API_HOST=http://192.168.1.20 npm run app:build     → http://192.168.1.20:4001 … :4004
//   VITE_COSIGNER_URL / VITE_PARTNER_URL / VITE_BANK_URL / VITE_MARKET_URL → full override per service
// See docs/MOBILE.md. The services must also list the app origin in their CORS allowlist (ALLOWED_ORIGINS).

import { PORTS, SERVICE_URLS } from '@sq/shared';

type Env = Record<string, string | undefined>;

export function resolveServiceUrls(env: Env): typeof SERVICE_URLS {
  const host = env.VITE_API_HOST?.trim().replace(/\/+$/, '');
  const base = (k: keyof typeof PORTS) => (host ? `${host}:${PORTS[k]}` : SERVICE_URLS[k as keyof typeof SERVICE_URLS]);
  const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim().replace(/\/+$/, '') : fallback);
  return {
    cosigner: pick(env.VITE_COSIGNER_URL, base('cosigner')),
    partner: pick(env.VITE_PARTNER_URL, base('partner')),
    bank: pick(env.VITE_BANK_URL, base('bank')),
    market: pick(env.VITE_MARKET_URL, base('market')),
  };
}

export const WEB_SERVICE_URLS = resolveServiceUrls((import.meta.env ?? {}) as unknown as Env);
