import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ChevronRight } from 'lucide-react';
import { Button, Card, cx, Notice, Pill, Skeleton, Spinner, Tabs } from '../components/ui';
import { usePoll } from '../lib/hooks';
import { getLang, locale, tr } from '../lib/i18n';
import { ageLabel, instrumentPath, marketGet, type Instrument, type Quote } from '../lib/market';
import { SqMobileTop } from './SqShell';
import { ChangeTag, delayLabel, fmtPrice, marketStateLabel, rowTime } from './marketUi';
import WatchlistTab from './content/WatchlistTab';
import InspirationTab from './content/InspirationTab';
import NewsTab from './content/NewsTab';
import AlertsTab from './content/AlertsTab';

type Tab = 'watchlists' | 'inspiration' | 'markets' | 'news' | 'alerts';
const TABS: Tab[] = ['watchlists', 'inspiration', 'markets', 'news', 'alerts'];
type ListId = 'shares' | 'etfs' | 'crypto' | 'indices' | 'components';
const LIST_IDS: ListId[] = ['shares', 'etfs', 'crypto', 'indices', 'components'];
const listLabel = (l: ListId) =>
  ({
    shares: tr('Shares', 'Actions'),
    etfs: 'ETFs',
    crypto: 'Crypto',
    indices: tr('Indices', 'Indices'),
    components: tr('Components', 'Composants'),
  })[l];
const listTitle = (l: ListId) =>
  ({
    shares: tr('Popular shares', 'Actions populaires'),
    etfs: tr('Popular ETFs', 'ETF populaires'),
    crypto: tr('Crypto-assets (CHF)', 'Crypto-actifs (CHF)'),
    indices: tr('Indices', 'Indices'),
    components: tr('Components of indices', 'Composants d’indices'),
  })[l];

type Sort = 'default' | 'gainers' | 'losers' | 'name';
const SORTS: Sort[] = ['default', 'gainers', 'losers', 'name'];
const sortLabel = (s: Sort) => ({ default: tr('Default', 'Par défaut'), gainers: tr('Top gainers', 'Plus fortes hausses'), losers: tr('Top losers', 'Plus fortes baisses'), name: tr('Name A–Z', 'Nom A–Z') })[s];

function SwissFlag() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#E20E00" />
      <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill="#fff" />
    </svg>
  );
}

export default function SqMarkets() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'markets';
  const filter: ListId = LIST_IDS.includes(params.get('list') as ListId) ? (params.get('list') as ListId) : 'components';
  const setParam = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set(k, v);
        if (k === 'tab') n.delete('new');
        return n;
      },
      { replace: true },
    );

  return (
    <div className="mx-auto max-w-[880px]">
      <SqMobileTop />
      <Tabs
        className="mt-1"
        value={tab}
        onChange={(t) => setParam('tab', t)}
        tabs={[
          { id: 'watchlists', label: 'Watchlists' },
          { id: 'inspiration', label: 'Inspiration' },
          { id: 'markets', label: tr('Markets', 'Marchés') },
          { id: 'news', label: 'News' },
          { id: 'alerts', label: tr('Alerts', 'Alertes') },
        ]}
      />
      {tab === 'watchlists' ? (
        <WatchlistTab />
      ) : tab === 'inspiration' ? (
        <InspirationTab />
      ) : tab === 'news' ? (
        <NewsTab />
      ) : tab === 'alerts' ? (
        <AlertsTab />
      ) : (
        <MarketsList filter={filter} setFilter={(f) => setParam('list', f)} />
      )}
    </div>
  );
}

function MarketsList({ filter, setFilter }: { filter: ListId; setFilter: (f: ListId) => void }) {
  const [sort, setSort] = useState<Sort>('default');
  const lists = usePoll(() => marketGet<Record<ListId, Instrument[]>>('/lists'), 3_600_000, []);
  const quotes = usePoll(() => marketGet<{ quotes: Quote[]; errors: Record<string, string> }>(`/lists/${filter}/quotes`), 60_000, [filter]);
  // ignore a response that belongs to the previously selected list while the new one loads
  const meta = lists.data?.[filter] ?? [];
  const qData = quotes.data && meta.length && quotes.data.quotes.every((q) => meta.some((m) => m.id === q.id)) ? quotes.data : null;
  const byId = useMemo(() => new Map((qData?.quotes ?? []).map((q) => [q.id, q])), [qData]);

  const rows = useMemo(() => {
    const r = meta.map((m, i) => ({ m, q: byId.get(m.id) ?? null, i }));
    const pct = (x: (typeof r)[number]) => x.q?.changePct ?? null;
    if (sort === 'gainers' || sort === 'losers') {
      const dir = sort === 'gainers' ? -1 : 1;
      return [...r].sort((a, b) => (pct(a) == null ? 1 : pct(b) == null ? -1 : dir * (pct(a)! - pct(b)!)));
    }
    if (sort === 'name') return [...r].sort((a, b) => a.m.name.localeCompare(b.m.name, getLang()));
    return r;
  }, [meta, byId, sort]);

  // list-level freshness / status
  const qs = qData?.quotes ?? [];
  const lastFetch = qs.reduce<string | null>((a, q) => (!a || q.fetchedAt > a ? q.fetchedAt : a), null);
  const delays = [...new Set(qs.map((q) => q.delay))];
  const venues = [...new Map(qs.filter((q) => q.marketState !== 'always-open').map((q) => [`${q.exchange}|${q.marketState}`, q])).values()];
  const providers = [...new Set(qs.map((q) => q.provider))];
  const staleCount = qs.filter((q) => q.stale).length;
  const errCount = Object.keys(qData?.errors ?? {}).length;
  const loading = !qData && !quotes.error;

  return (
    <>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr('Instrument list', 'Liste d’instruments')}>
        {LIST_IDS.map((f) => (
          <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
            {listLabel(f)}
          </Pill>
        ))}
      </div>

      <div className="mt-2 text-center text-[12px] leading-relaxed text-sq-muted" aria-live="polite">
        {lastFetch ? (
          <>
            <span className="num">
              {tr('Updated', 'Mis à jour')}{' '}
              {new Date(lastFetch).toLocaleTimeString(locale(), { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', second: '2-digit' })} (Zurich)
            </span>
            {' · '}
            {delays.map(delayLabel).join(' / ')}
            {venues.map((v) => (
              <span key={v.exchange + v.marketState}>
                {' · '}
                {v.exchange}: {marketStateLabel(v.marketState).toLowerCase()} ({v.timezone})
              </span>
            ))}
            {qs.some((q) => q.marketState === 'always-open') && ` · ${marketStateLabel('always-open')}`}
            <br />
            {tr('Data', 'Données')}: {providers.join(' / ') || 'Yahoo Finance / CoinGecko'}
            {staleCount > 0 && <span className="ml-1 rounded-full bg-sq-warn-50 px-2 py-0.5 font-medium text-sq-warn">{tr(`${staleCount} stale`, `${staleCount} périmé(s)`)}</span>}
          </>
        ) : loading ? (
          <span className="inline-flex items-center gap-2">
            <Spinner /> {tr('Loading live prices…', 'Chargement des cours…')}
          </span>
        ) : (
          tr('Data: Yahoo Finance / CoinGecko', 'Données : Yahoo Finance / CoinGecko')
        )}
      </div>

      {quotes.error && (
        <Notice tone="bad" className="mt-2" title={tr('Prices unavailable', 'Cours indisponibles')}>
          {tr('The market data service could not provide prices', 'Le service de données de marché n’a pas pu fournir les cours')} ({quotes.error}). {tr('No price is shown rather than an invented one.', 'Aucun cours n’est affiché plutôt qu’un cours inventé.')}
          <div className="mt-2">
            <Button variant="secondary" className="w-auto" onClick={() => void quotes.reload()}>
              {tr('Retry', 'Réessayer')}
            </Button>
          </div>
        </Notice>
      )}

      <Card className="mt-2 px-0 pb-1 pt-4">
        <div className="flex items-center justify-between gap-2 px-5">
          <h2 className="text-[17px] font-semibold">{listTitle(filter)}</h2>
          <button
            type="button"
            onClick={() => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length])}
            aria-label={`${tr('Sort', 'Trier')}: ${sortLabel(sort)}. ${tr('Activate to change the order.', 'Activer pour changer l’ordre.')}`}
            className="inline-flex min-h-11 items-center gap-1 text-[15px] text-sq-orange"
          >
            <ArrowDownUp size={18} strokeWidth={2} /> {sort === 'default' ? tr('Sort', 'Trier') : sortLabel(sort)}
          </button>
        </div>
        {filter === 'components' && (
          <div className="px-5 pb-1">
            <span className="inline-flex items-center gap-2 rounded-full bg-sq-chip px-3 py-1.5 text-[14px] font-medium" title={tr('Only the SMI is available in this prototype', 'Seul le SMI est disponible dans ce prototype')}>
              <SwissFlag /> SMI
            </span>
          </div>
        )}
        {errCount > 0 && <p className="px-5 pb-1 text-[12px] text-sq-muted">{tr(`${errCount} instrument(s) unavailable from the provider right now.`, `${errCount} instrument(s) indisponible(s) chez le fournisseur pour le moment.`)}</p>}
        <ul>
          {(meta.length ? rows : Array.from({ length: 6 }, () => null)).map((r, n) =>
            r ? (
              <li key={r.m.id}>
                <Link to={instrumentPath(r.m.id)} className="flex min-h-[64px] w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-sq-bg/60 sm:gap-3 sm:px-4">
                  {r.m.kind === 'index' ? (
                    <span className="w-8 shrink-0" />
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sq-orange text-[13px] font-semibold text-white" aria-hidden>
                      {r.m.symbol[0]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-sq-ink">{r.m.symbol}</span>
                    <span className="block truncate text-[11px] uppercase leading-tight tracking-wide text-sq-muted">{r.m.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-sq-muted">
                      {r.m.exchange.replace('SIX Swiss Exchange', 'SIX')} · {r.m.currency}
                    </span>
                  </span>
                  {r.q ? (
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="num whitespace-nowrap text-[15px] text-sq-ink">
                        {fmtPrice(r.q.price)}
                        <span className="ml-1 text-[12px]">{r.q.currency}</span>
                      </span>
                      <span className={cx('num whitespace-nowrap text-[11px]', r.q.stale ? 'font-medium text-sq-warn' : 'text-sq-muted')} title={r.q.delayNote}>
                        {r.q.stale ? tr('stale', 'périmé') + ' · ' : r.q.delay === 'close' ? tr('close', 'clôture') + ' ' : ''}
                        {rowTime(r.q)}
                      </span>
                    </span>
                  ) : qData?.errors[r.m.id] ? (
                    <span className="shrink-0 text-[12px] text-sq-muted">{tr('Unavailable', 'Indisponible')}</span>
                  ) : (
                    <Skeleton className="h-5 w-20" />
                  )}
                  {r.q ? <ChangeTag pct={r.q.changePct} label={r.q.changePeriod === '24h' ? tr('24 h', '24 h') : tr('today', 'aujourd’hui')} /> : <span className="w-[72px] shrink-0" />}
                  <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-sq-muted" />
                </Link>
              </li>
            ) : (
              <li key={n} className="flex min-h-[64px] items-center gap-3 px-4">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-5 flex-1" />
                <Skeleton className="h-5 w-24" />
              </li>
            ),
          )}
        </ul>
        {lists.error && !meta.length && <p className="px-5 pb-3 text-[13px] text-sq-down">{tr('Instrument lists unavailable', 'Listes d’instruments indisponibles')} ({lists.error}).</p>}
      </Card>
      <p className="mt-2 text-center text-[11px] text-sq-muted">
        {tr('Change: shares, ETFs and indices vs previous close; crypto over 24 h. Prices are for information only, not executable.', 'Variation : actions, ETF et indices vs clôture précédente ; crypto sur 24 h. Cours à titre informatif, non exécutables.')}{' '}
        {lastFetch && `${tr('Fetched', 'Récupéré')} ${ageLabel(lastFetch, Date.now(), getLang())}.`}
      </p>
    </>
  );
}
