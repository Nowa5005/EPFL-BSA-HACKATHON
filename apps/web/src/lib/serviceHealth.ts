// #21 (part A) — Detects that Swissquote's services are unreachable, from the browser.
// Polls GET /health of the co-signer and the bank (public routes) with a timeout. Two consecutive failures of either
// → "down" (avoids flapping on a single slow request). Pure helpers are unit-tested (apps/web/test/serviceHealth.test.ts).

import { useEffect, useState } from 'react';
import { WEB_SERVICE_URLS } from './services';

export const HEALTH_TIMEOUT_MS = 4000;
export const HEALTH_INTERVAL_MS = 20_000;
export const FAILURES_BEFORE_DOWN = 2;

/** One probe: true when the service answers 2xx within the timeout. Never throws. */
export async function probe(url: string, timeoutMs = HEALTH_TIMEOUT_MS, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await f(`${url}/health`, { signal: ctrl.signal, cache: 'no-store' });
      return r.ok;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

/** Next consecutive-failure counter and resulting state. */
export function nextHealth(prevFailures: number, ok: boolean): { failures: number; down: boolean } {
  const failures = ok ? 0 : prevFailures + 1;
  return { failures, down: failures >= FAILURES_BEFORE_DOWN };
}

let shared: { down: boolean; checkedAt: number | null } = { down: false, checkedAt: null };
const listeners = new Set<(s: typeof shared) => void>();
let failures = 0;
let timer: ReturnType<typeof setInterval> | null = null;

async function checkNow() {
  const urls = [WEB_SERVICE_URLS.cosigner, WEB_SERVICE_URLS.bank];
  const ok = (await Promise.all(urls.map((u) => probe(u)))).every(Boolean);
  const n = nextHealth(failures, ok);
  failures = n.failures;
  shared = { down: n.down, checkedAt: Date.now() };
  listeners.forEach((l) => l(shared));
}

/** Shared health state (one poller for the whole app). */
export function useServiceHealth() {
  const [s, setS] = useState(shared);
  useEffect(() => {
    listeners.add(setS);
    if (!timer) {
      void checkNow();
      timer = setInterval(() => void checkNow(), HEALTH_INTERVAL_MS);
    }
    return () => {
      listeners.delete(setS);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return { ...s, recheck: checkNow };
}

// ── Local history cache (on-chain facts only: no names, no notes), used by Emergency mode ──
const CACHE_KEY = 'mw:emergency-history';
export interface CachedTx {
  kind: string;
  status: string;
  asset: string;
  amount: string;
  from: string;
  to: string;
  txHash?: string;
  at: string;
}
export function cacheWalletTxs(safeAddress: string | undefined, txs: { kind: string; status: string; asset: string; amount: string; from: string; to: string; txHash?: string; simulated?: boolean; confirmedAt?: string; createdAt: string }[]) {
  if (!safeAddress) return;
  try {
    const rows: CachedTx[] = txs
      .filter((t) => !t.simulated && t.txHash)
      .slice(0, 50)
      .map((t) => ({ kind: t.kind, status: t.status, asset: t.asset, amount: t.amount, from: t.from, to: t.to, txHash: t.txHash, at: t.confirmedAt ?? t.createdAt }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ safeAddress: safeAddress.toLowerCase(), savedAt: new Date().toISOString(), rows }));
  } catch {
    /* storage unavailable: Emergency mode then says the cache is empty */
  }
}
export function readCachedTxs(safeAddress: string): { savedAt: string; rows: CachedTx[] } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return v && v.safeAddress === safeAddress.toLowerCase() ? { savedAt: v.savedAt, rows: v.rows ?? [] } : null;
  } catch {
    return null;
  }
}
