// Shared market-data client: the ONLY place the UI gets prices, history, search, news and CHF valuation rates,
// so Trade, Watchlist, instrument pages, alerts and wallet widgets never show contradictory values.
// Data comes from the market-data service (services/market-data), which caches provider responses.

import { useEffect, useState } from 'react';
import { WEB_SERVICE_URLS as SERVICE_URLS } from './services';
import { ApiError } from './api';
import { usePoll } from './hooks';

export type Kind = 'equity' | 'etf' | 'index' | 'crypto';
export type Range = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y';
export const RANGES: Range[] = ['1D', '1W', '1M', '6M', '1Y', '5Y'];

export interface Instrument {
  id: string; // 'yf:NESN.SW' | 'cg:ethereum'
  symbol: string;
  name: string;
  kind: Kind;
  exchange: string;
  currency: string;
}
export interface Quote extends Instrument {
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  changePeriod: '1D' | '24h';
  asOf: string;
  fetchedAt: string;
  delay: 'realtime' | 'delayed' | 'close' | 'unknown';
  delayNote: string;
  marketState: 'open' | 'closed' | 'always-open';
  timezone: string;
  provider: 'Yahoo Finance' | 'CoinGecko';
  stale: boolean;
}
export interface History {
  id: string;
  range: Range;
  currency: string;
  points: { t: number; v: number }[];
  first: number | null;
  last: number | null;
  changePct: number | null;
  asOf: string;
  fetchedAt: string;
  provider: string;
  stale: boolean;
}
export interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  topics: ('markets' | 'companies' | 'economy' | 'crypto')[];
  lang: string;
  image: { url: string; credit: string } | null;
  fullTextAvailable: false;
}
export interface WalletRate {
  chf: number;
  asOf: string;
  fetchedAt: string;
  stale: boolean;
  changePct24h: number | null;
  provider: string;
}

const BASE = SERVICE_URLS.market;

export async function marketGet<T = any>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path);
  } catch {
    throw new ApiError(0, 'Market data service unreachable', null);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Error ${res.status}`, json);
  return json as T;
}

export const instrumentPath = (id: string) => `/sq/instrument/${encodeURIComponent(id)}`;

/** Live quotes for a set of instruments (refreshed every 60 s, the provider cache TTL). */
export function useQuotes(ids: string[], ms = 60_000) {
  const key = ids.join(',');
  return usePoll(async () => (key ? marketGet<{ quotes: Quote[]; errors: Record<string, string> }>(`/quotes?ids=${encodeURIComponent(key)}`) : { quotes: [], errors: {} }), ms, [key]);
}

export function useHistory(id: string | null, range: Range) {
  return usePoll(async () => (id ? marketGet<History>(`/history/${encodeURIComponent(id)}?range=${range}`) : null), range === '1D' ? 120_000 : 600_000, [id, range]);
}

/** CHF valuation of the wallet's assets (indicative market prices with timestamps). No fixed fallback rate. */
export function useWalletRates() {
  return usePoll(() => marketGet<{ rates: Partial<Record<'ETH' | 'USDC', WalletRate>>; errors: Record<string, string>; note: string }>('/wallet-rates'), 60_000, []);
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "x min ago" style freshness for cached data. */
export function ageLabel(iso: string, now = Date.now(), lang: 'en' | 'fr' = 'en') {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return lang === 'fr' ? 'à l’instant' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return lang === 'fr' ? `il y a ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return lang === 'fr' ? `il y a ${h} h` : `${h} h ago`;
  return lang === 'fr' ? `il y a ${Math.round(h / 24)} j` : `${Math.round(h / 24)} d ago`;
}
