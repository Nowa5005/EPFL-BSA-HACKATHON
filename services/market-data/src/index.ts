// market-data — single source of market prices, history, search and news for every screen (Trade, Watchlist,
// instrument pages, alerts, wallet widgets, CHF conversions in the co-signer). Read-only public data; provider
// credentials (if any) stay here, server-side. See providers.ts / news.ts for sources and caching.

import { createSecurity, loadDotenv } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import { PORTS } from '@sq/shared';
import { LISTS, WALLET_ASSET_INSTRUMENT, type ListId } from './catalog';
import { getCryptoPriceOn, getHistory, getQuote, getQuotes, ProviderError, RANGES, search, type Range } from './providers';
import { FEEDS, getNews, type NewsTopic } from './news';

const app = express();
// Public read-only market data: every GET is public, but the Origin allow-list / CORS / JSON-only writes still apply,
// and anything else (a future POST…) falls under the shared default-deny guard.
const security = createSecurity({ service: 'market-data', publicRoutes: [['GET', '/*']] });
app.use(security.edge);
app.use(express.json({ limit: '100kb' }));
app.use(security.guard);

type H = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((r) => {
      if (!res.headersSent) res.json(r ?? { ok: true });
    })
    .catch(next);
};
const bad = (m: string) => new ProviderError(m, 400);

app.get('/health', route(() => ({ service: 'market-data', providers: ['Yahoo Finance (unofficial public endpoints)', 'CoinGecko public API'], news: [...new Set(FEEDS.map((f) => f.source))] })));

/** Default instrument lists (ids + static metadata), quotes fetched separately so the lists render immediately. */
app.get('/lists', route(() => LISTS));

app.get(
  '/lists/:list/quotes',
  route(async (req) => {
    const list = LISTS[String(req.params.list) as ListId];
    if (!list) throw bad('Unknown list');
    return getQuotes(list.map((i) => i.id));
  }),
);

app.get(
  '/quotes',
  route(async (req) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    if (!ids.length) throw bad('ids required');
    return getQuotes(ids);
  }),
);

app.get('/quote/:id', route((req) => getQuote(String(req.params.id))));

app.get(
  '/history/:id',
  route(async (req) => {
    const range = String(req.query.range ?? '1M') as Range;
    if (!RANGES.includes(range)) throw bad(`range must be one of ${RANGES.join(', ')}`);
    return getHistory(String(req.params.id), range);
  }),
);

/** CHF price of a crypto-asset on a UTC date (valuation at a reference date — not an official tax rate). */
app.get(
  '/price-on/:id',
  route(async (req) => {
    const date = String(req.query.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date=YYYY-MM-DD required');
    return getCryptoPriceOn(String(req.params.id), date);
  }),
);

app.get('/search', route((req) => search(String(req.query.q ?? ''))));

app.get(
  '/news',
  route((req) => {
    const t = req.query.topic ? String(req.query.topic) : undefined;
    if (t && !['markets', 'companies', 'economy', 'crypto'].includes(t)) throw bad('Unknown topic');
    return getNews(t as NewsTopic | undefined);
  }),
);

/** CHF valuation rates for the wallet's assets (indicative market prices, timestamped — never a fixed constant). */
app.get(
  '/wallet-rates',
  route(async () => {
    const { quotes, errors } = await getQuotes(Object.values(WALLET_ASSET_INSTRUMENT));
    const rates: Record<string, { chf: number; asOf: string; fetchedAt: string; stale: boolean; changePct24h: number | null; provider: string }> = {};
    for (const [asset, id] of Object.entries(WALLET_ASSET_INSTRUMENT)) {
      const q = quotes.find((x) => x.id === id);
      if (q) rates[asset] = { chf: q.price, asOf: q.asOf, fetchedAt: q.fetchedAt, stale: q.stale, changePct24h: q.changePct, provider: q.provider };
    }
    return { rates, errors, kind: 'indicative', note: 'Indicative market valuation (CoinGecko, CHF). Not an executable exchange quote.' };
  }),
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ProviderError) return res.status(err.status).json({ error: err.message, unavailable: err.status === 503 });
  console.error(err);
  res.status(500).json({ error: String((err as Error)?.message ?? err) });
});

app.listen(PORTS.market, () => console.log(`market-data listening on http://localhost:${PORTS.market}`));
