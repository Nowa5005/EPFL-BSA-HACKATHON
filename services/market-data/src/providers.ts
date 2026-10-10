// Market data providers + cache. Everything shown as "real" comes from here; nothing is invented on failure:
// on a provider error we serve the last good value flagged `stale` with its timestamp, or an explicit error.
//
//  - Yahoo Finance chart/search endpoints (equities, ETFs, indices): free public endpoints WITHOUT an official API
//    contract — acceptable for a prototype, to be replaced by a licensed feed (e.g. SIX, Refinitiv) in production.
//    Exchange data is usually delayed (SIX ~15 min); when the market is closed the value is the last close.
//  - CoinGecko public API (crypto, CHF): free tier, ~30 calls/min, attribution "Data provided by CoinGecko" required.
//    Optional key: COINGECKO_API_KEY (demo key header) raises the limits. Server-side only.

import { known, remember, type Instrument, type Kind } from './catalog';

const UA = 'Mozilla/5.0 (MyWall prototype; market data proxy)';
const CG_BASE = 'https://api.coingecko.com/api/v3';
const cgHeaders = (): Record<string, string> => (process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {});

export type Delay = 'realtime' | 'delayed' | 'close' | 'unknown';
export type MarketState = 'open' | 'closed' | 'always-open';

export interface Quote {
  id: string;
  symbol: string;
  name: string;
  kind: Kind;
  exchange: string;
  currency: string;
  price: number;
  previousClose: number | null;
  change: number | null; // absolute, over `changePeriod`
  changePct: number | null;
  changePeriod: '1D' | '24h'; // 1D = vs previous close (exchange instruments), 24h = rolling (crypto)
  asOf: string; // timestamp of the price itself (ISO)
  fetchedAt: string; // when we got it from the provider
  delay: Delay;
  delayNote: string;
  marketState: MarketState;
  timezone: string; // exchange timezone (IANA)
  provider: 'Yahoo Finance' | 'CoinGecko';
  stale: boolean;
}

export interface History {
  id: string;
  range: Range;
  currency: string;
  points: { t: number; v: number }[]; // t = epoch ms
  first: number | null;
  last: number | null;
  changePct: number | null; // last vs first point of THIS range
  asOf: string;
  fetchedAt: string;
  provider: Quote['provider'];
  stale: boolean;
}

export const RANGES = ['1D', '1W', '1M', '6M', '1Y', '5Y'] as const;
export type Range = (typeof RANGES)[number];

// ───────────── cache (memory, per key; TTL then serve-stale-on-error) ─────────────
interface Entry<T> {
  value: T;
  at: number;
}
const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export class ProviderError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
  }
}

async function cached<T extends { stale: boolean; fetchedAt: string }>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = (async () => {
    try {
      const v = await load();
      cache.set(key, { value: v, at: Date.now() });
      return v;
    } catch (e) {
      if (hit) return { ...hit.value, stale: true }; // last good value, flagged (fetchedAt tells its age)
      throw e instanceof ProviderError ? e : new ProviderError(`Market data unavailable (${(e as Error).message})`);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
export const _clearCache = () => cache.clear();

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 429) throw new ProviderError('Provider rate limit reached', 503);
  if (res.status === 404) throw new ProviderError('Unknown instrument', 404);
  if (!res.ok) throw new ProviderError(`Provider HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

// ───────────── instruments ─────────────
export function instrumentOf(id: string): Instrument {
  const k = known(id);
  if (k) return k;
  if (/^yf:[A-Za-z0-9.^=\-]{1,20}$/.test(id)) return { id, symbol: id.slice(3), name: id.slice(3), kind: 'equity', exchange: '', currency: '' };
  if (/^cg:[a-z0-9-]{1,60}$/.test(id)) return { id, symbol: id.slice(3).toUpperCase(), name: id.slice(3), kind: 'crypto', exchange: 'Crypto (24/7, aggregated)', currency: 'CHF' };
  throw new ProviderError('Invalid instrument id', 400);
}

// ───────────── Yahoo Finance ─────────────
const YF_RANGE: Record<Range, { range: string; interval: string }> = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
};
const yfKind = (t?: string): Kind => (t === 'ETF' ? 'etf' : t === 'INDEX' ? 'index' : t === 'CRYPTOCURRENCY' ? 'crypto' : 'equity');

async function yfChart(symbol: string, r: Range) {
  const { range, interval } = YF_RANGE[r];
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
  const res = j?.chart?.result?.[0];
  if (!res?.meta) throw new ProviderError(j?.chart?.error?.description ?? 'Unknown instrument', 404);
  return res;
}

function yfQuote(inst: Instrument, res: any): Quote {
  const m = res.meta;
  const now = Date.now() / 1000;
  const reg = m.currentTradingPeriod?.regular;
  const open = reg ? now >= reg.start && now < reg.end : false;
  const price = Number(m.regularMarketPrice);
  const prev = m.previousClose ?? m.chartPreviousClose ?? null;
  const change = prev != null ? price - prev : null;
  const name = inst.name !== inst.symbol || !m.shortName ? inst.name : m.longName ?? m.shortName;
  remember({ ...inst, name, kind: inst.kind ?? yfKind(m.instrumentType), currency: m.currency ?? inst.currency, exchange: inst.exchange || m.fullExchangeName || m.exchangeName });
  return {
    id: inst.id,
    symbol: inst.symbol,
    name,
    kind: known(inst.id)?.kind ?? yfKind(m.instrumentType),
    exchange: inst.exchange || m.fullExchangeName || m.exchangeName || '',
    currency: m.currency ?? inst.currency,
    price,
    previousClose: prev,
    change,
    changePct: prev ? (change! / prev) * 100 : null,
    changePeriod: '1D',
    asOf: new Date(m.regularMarketTime * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
    delay: open ? 'delayed' : 'close',
    delayNote: open ? 'Exchange data, usually delayed (≈15–20 min) on this free feed' : 'Market closed — last regular-session price',
    marketState: open ? 'open' : 'closed',
    timezone: m.exchangeTimezoneName ?? 'UTC',
    provider: 'Yahoo Finance',
    stale: false,
  };
}

// ───────────── CoinGecko ─────────────
const CG_DAYS: Record<Range, string> = { '1D': '1', '1W': '7', '1M': '30', '6M': '180', '1Y': '365', '5Y': '1825' };

async function cgQuotes(insts: Instrument[]): Promise<Quote[]> {
  const ids = insts.map((i) => i.id.slice(3));
  const j = await getJson(`${CG_BASE}/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=chf&include_24hr_change=true&include_last_updated_at=true`, cgHeaders());
  const fetchedAt = new Date().toISOString();
  return insts.flatMap((inst) => {
    const d = j[inst.id.slice(3)];
    if (!d || typeof d.chf !== 'number') return [];
    const pct = typeof d.chf_24h_change === 'number' ? d.chf_24h_change : null;
    const prev = pct != null ? d.chf / (1 + pct / 100) : null;
    return [
      {
        id: inst.id,
        symbol: inst.symbol,
        name: inst.name,
        kind: 'crypto' as const,
        exchange: inst.exchange,
        currency: 'CHF',
        price: d.chf,
        previousClose: prev,
        change: prev != null ? d.chf - prev : null,
        changePct: pct,
        changePeriod: '24h' as const,
        asOf: new Date((d.last_updated_at ?? Date.now() / 1000) * 1000).toISOString(),
        fetchedAt,
        delay: 'realtime' as const,
        delayNote: 'Aggregated market price, refreshed about every minute (indicative, not an executable quote)',
        marketState: 'always-open' as const,
        timezone: 'UTC',
        provider: 'CoinGecko' as const,
        stale: false,
      },
    ];
  });
}

// ───────────── public API ─────────────
const QUOTE_TTL = 60_000;

export async function getQuotes(ids: string[]): Promise<{ quotes: Quote[]; errors: Record<string, string> }> {
  const insts = [...new Set(ids)].slice(0, 60).map(instrumentOf);
  const errors: Record<string, string> = {};
  const crypto = insts.filter((i) => i.id.startsWith('cg:'));
  const yahoo = insts.filter((i) => i.id.startsWith('yf:'));
  const out: Quote[] = [];
  if (crypto.length) {
    // one batched call for all crypto (rate limits), cached per batch key AND per id
    try {
      const batch = await cached(`cgq:${crypto.map((c) => c.id).sort().join(',')}`, QUOTE_TTL, async () => ({ list: await cgQuotes(crypto), stale: false, fetchedAt: new Date().toISOString() }));
      for (const q of batch.list) out.push({ ...q, stale: batch.stale || q.stale });
      for (const c of crypto) if (!batch.list.find((q) => q.id === c.id)) errors[c.id] = 'No price from provider';
    } catch (e) {
      for (const c of crypto) errors[c.id] = (e as Error).message;
    }
  }
  await Promise.all(
    yahoo.map(async (inst) => {
      try {
        out.push(await cached(`yfq:${inst.id}`, QUOTE_TTL, async () => yfQuote(inst, await yfChart(inst.id.slice(3), '1D'))));
      } catch (e) {
        errors[inst.id] = (e as Error).message;
      }
    }),
  );
  const order = new Map(insts.map((i, n) => [i.id, n]));
  out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { quotes: out, errors };
}

export async function getQuote(id: string): Promise<Quote> {
  const { quotes, errors } = await getQuotes([id]);
  if (!quotes[0]) throw new ProviderError(errors[id] ?? 'Unavailable', errors[id] === 'Unknown instrument' ? 404 : 503);
  return quotes[0];
}

const HISTORY_TTL: Record<Range, number> = { '1D': 120_000, '1W': 600_000, '1M': 1_800_000, '6M': 3_600_000, '1Y': 3_600_000, '5Y': 6 * 3_600_000 };

export async function getHistory(id: string, range: Range): Promise<History> {
  const inst = instrumentOf(id);
  return cached(`h:${id}:${range}`, HISTORY_TTL[range], async () => {
    let points: { t: number; v: number }[] = [];
    let currency = inst.currency;
    let provider: Quote['provider'];
    if (id.startsWith('cg:')) {
      provider = 'CoinGecko';
      const j = await getJson(`${CG_BASE}/coins/${encodeURIComponent(id.slice(3))}/market_chart?vs_currency=chf&days=${CG_DAYS[range]}`, cgHeaders());
      points = (j.prices ?? []).map(([t, v]: [number, number]) => ({ t, v }));
      currency = 'CHF';
    } else {
      provider = 'Yahoo Finance';
      const res = await yfChart(id.slice(3), range);
      currency = res.meta.currency ?? currency;
      const ts: number[] = res.timestamp ?? [];
      const cl: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
      points = ts.flatMap((t, i) => (cl[i] == null ? [] : [{ t: t * 1000, v: cl[i]! }]));
    }
    if (!points.length) throw new ProviderError('No history for this period', 404);
    const first = points[0].v;
    const last = points[points.length - 1].v;
    return { id, range, currency, points, first, last, changePct: ((last - first) / first) * 100, asOf: new Date(points[points.length - 1].t).toISOString(), fetchedAt: new Date().toISOString(), provider, stale: false };
  });
}

/** Daily close in CHF on a given UTC date (used for valuations at a reference date). CoinGecko only, ≤ 365 days back on the free tier. */
export async function getCryptoPriceOn(id: string, isoDate: string): Promise<{ id: string; date: string; priceChf: number; provider: 'CoinGecko'; method: string }> {
  if (!id.startsWith('cg:')) throw new ProviderError('Historical CHF price only available for crypto', 400);
  const [y, m, d] = isoDate.split('-');
  const r = await cached(`hd:${id}:${isoDate}`, 24 * 3_600_000, async () => {
    const j = await getJson(`${CG_BASE}/coins/${encodeURIComponent(id.slice(3))}/history?date=${d}-${m}-${y}&localization=false`, cgHeaders());
    const p = j?.market_data?.current_price?.chf;
    if (typeof p !== 'number') throw new ProviderError('No historical price for that date', 404);
    return { p, stale: false, fetchedAt: new Date().toISOString() };
  });
  return { id, date: isoDate, priceChf: r.p, provider: 'CoinGecko', method: 'CoinGecko daily snapshot price at 00:00 UTC of that date (not an official tax rate)' };
}

export interface SearchHit {
  id: string;
  symbol: string;
  name: string;
  kind: Kind;
  exchange: string;
}

export async function search(q: string): Promise<{ results: SearchHit[]; stale: boolean; fetchedAt: string }> {
  const query = q.trim().slice(0, 50);
  if (query.length < 1) return { results: [], stale: false, fetchedAt: new Date().toISOString() };
  return cached(`s:${query.toLowerCase()}`, 600_000, async () => {
    const [yj, cj] = await Promise.all([
      getJson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`).catch(() => null),
      getJson(`${CG_BASE}/search?query=${encodeURIComponent(query)}`, cgHeaders()).catch(() => null),
    ]);
    if (!yj && !cj) throw new ProviderError('Search unavailable');
    const results: SearchHit[] = [];
    for (const r of yj?.quotes ?? []) {
      if (!r.symbol || !['EQUITY', 'ETF', 'INDEX'].includes(r.quoteType)) continue;
      const hit = { id: `yf:${r.symbol}`, symbol: known(`yf:${r.symbol}`)?.symbol ?? r.symbol, name: r.longname ?? r.shortname ?? r.symbol, kind: yfKind(r.quoteType), exchange: r.exchDisp ?? r.exchange ?? '' };
      remember({ ...hit, currency: '' });
      results.push(hit);
    }
    for (const c of (cj?.coins ?? []).slice(0, 5)) {
      const hit = { id: `cg:${c.id}`, symbol: String(c.symbol).toUpperCase(), name: c.name, kind: 'crypto' as const, exchange: 'Crypto (24/7, aggregated)' };
      remember({ ...hit, currency: 'CHF' });
      results.push(hit);
    }
    return { results, stale: false, fetchedAt: new Date().toISOString() };
  });
}
