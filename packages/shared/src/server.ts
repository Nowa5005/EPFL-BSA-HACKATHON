// Node-only helpers (JSON file storage, service bootstrap). Not imported by the web app.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Tiny JSON-file store: each service owns its own data/ directory (no shared DB, no native modules). */
export class JsonStore<T extends object> {
  private file: string;
  data: T;
  constructor(dir: string, name: string, initial: () => T) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.json`);
    this.data = fs.existsSync(this.file) ? (JSON.parse(fs.readFileSync(this.file, 'utf8')) as T) : initial();
    this.save();
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  update<R>(fn: (d: T) => R): R {
    const r = fn(this.data);
    this.save();
    return r;
  }
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function loadDotenv() {
  // Load the repo-root .env if present (never committed).
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, '.env');
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
      return;
    }
    dir = path.dirname(dir);
  }
}

// ───────────── CHF valuation rates (from the market-data service; never a fixed constant) ─────────────
export interface ServerRate {
  chf: number;
  asOf: string; // timestamp of the market price
  fetchedAt: string;
  stale: boolean;
  provider: string;
}
export type WalletRates = Partial<Record<'ETH' | 'USDC', ServerRate>>;

let ratesCache: { at: number; rates: WalletRates } | null = null;

/**
 * Indicative CHF prices of the wallet assets, cached 30 s. Returns only the assets the provider priced:
 * callers MUST handle a missing rate explicitly (show "unavailable", or treat as "above threshold" in
 * compliance checks) — there is no silent fallback rate.
 */
export async function fetchWalletRates(marketUrl = process.env.MARKET_URL ?? 'http://localhost:4004'): Promise<WalletRates> {
  if (ratesCache && Date.now() - ratesCache.at < 30_000) return ratesCache.rates;
  try {
    const res = await fetch(`${marketUrl}/wallet-rates`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { rates: WalletRates };
    ratesCache = { at: Date.now(), rates: j.rates ?? {} };
  } catch {
    // keep the last known values but flag them stale; nothing at all if we never got any
    if (ratesCache) ratesCache = { at: ratesCache.at, rates: Object.fromEntries(Object.entries(ratesCache.rates).map(([k, v]) => [k, { ...v!, stale: true }])) };
    else return {};
  }
  return ratesCache.rates;
}

// ───────────── Request language (AsyncLocalStorage; set by the security guard from the x-lang header) ─────────────
export * from './requestLang';

// ───────────── Service authentication, CORS allow-list, CSRF defences ─────────────
export * from './serverAuth';

// ───────────── Bind address (#2: loopback by default, HOST to override) ─────────────
export * from './listen';
