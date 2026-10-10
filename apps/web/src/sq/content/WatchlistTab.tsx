// Watchlist: instruments the client follows, stored server-side (sq-bank /clients/:id/watchlist).
// Prices come from the same market-data layer as Trade (useQuotes), so values never contradict.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { Button, ChangeBadge, Card, cx, fmt, Notice, Skeleton, Spinner } from '../../components/ui';
import { useLocal } from '../../lib/hooks';
import { getLang, tr } from '../../lib/i18n';
import { ageLabel, instrumentPath, useQuotes, type Quote } from '../../lib/market';
import { InstrumentSearch, kindLabel } from './InstrumentSearch';
import { zurichTime } from './common';
import { watchlistApi, type WatchItem } from './userdata';

/** Discovery suggestions (well-known instruments), shown only while the watchlist is empty. NOT the user's choice. */
const DISCOVER: { id: string; symbol: string; name: string; group: 'index' | 'equity' | 'etf' | 'crypto' }[] = [
  { id: 'yf:^SSMI', symbol: 'SMI', name: 'SMI® (price index)', group: 'index' },
  { id: 'yf:^GSPC', symbol: 'S&P 500', name: 'S&P 500', group: 'index' },
  { id: 'yf:NESN.SW', symbol: 'NESN', name: 'Nestlé S.A.', group: 'equity' },
  { id: 'yf:AAPL', symbol: 'AAPL', name: 'Apple Inc.', group: 'equity' },
  { id: 'yf:CHSPI.SW', symbol: 'CHSPI', name: 'iShares Core SPI (CH)', group: 'etf' },
  { id: 'yf:VT', symbol: 'VT', name: 'Vanguard Total World Stock ETF', group: 'etf' },
  { id: 'cg:bitcoin', symbol: 'BTC', name: 'Bitcoin', group: 'crypto' },
  { id: 'cg:ethereum', symbol: 'ETH', name: 'Ethereum', group: 'crypto' },
];

export const delayLabel = (q: Quote) =>
  ({
    realtime: tr('Live (indicative)', 'En direct (indicatif)'),
    delayed: tr('Delayed', 'Différé'),
    close: tr('Last close', 'Dernière clôture'),
    unknown: tr('Delay unknown', 'Délai inconnu'),
  })[q.delay];

export function useWatchlist() {
  const { session } = useLocal();
  const clientId = session?.clientId ?? '';
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      setItems((await watchlistApi.list(clientId)).items);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [clientId]);
  useEffect(() => void load(), [load]);
  const add = async (id: string) => setItems((await watchlistApi.add(clientId, id)).items);
  const remove = async (id: string) => setItems((await watchlistApi.remove(clientId, id)).items);
  return { items, error, load, add, remove, clientId };
}

export default function WatchlistTab() {
  const wl = useWatchlist();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const ids = wl.items?.map((i) => i.instrumentId) ?? [];
  const quotes = useQuotes(ids);
  const has = (id: string) => ids.includes(id);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setActionErr(null);
    try {
      await fn();
    } catch (e: any) {
      setActionErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (wl.error && !wl.items)
    return (
      <Notice tone="bad" className="mt-4" title={tr('Watchlist unavailable', 'Watchlist indisponible')}>
        {tr('Your watchlist could not be loaded from the server.', 'Votre watchlist n’a pas pu être chargée depuis le serveur.')}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void wl.load()}>
          {tr('Try again', 'Réessayer')}
        </button>
      </Notice>
    );
  if (!wl.items)
    return (
      <Card className="mt-4 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );

  const empty = wl.items.length === 0;
  const addButton = (id: string) =>
    has(id) ? (
      <span className="text-[13px] text-sq-muted">{tr('In watchlist', 'Dans la watchlist')}</span>
    ) : (
      <Button variant="secondary" className="w-auto min-h-10 px-3 py-1.5 text-[14px]" disabled={busy === id} onClick={() => void act(id, () => wl.add(id))}>
        {busy === id ? <Spinner /> : <Plus size={16} strokeWidth={2} aria-hidden />} {tr('Add', 'Ajouter')}
      </Button>
    );

  return (
    <section aria-label="Watchlist" className="mt-4 space-y-4">
      {actionErr && <Notice tone="bad">{actionErr}</Notice>}

      <Card className="px-0 pb-1 pt-4">
        <div className="flex items-center justify-between gap-2 px-5">
          <h2 className="text-[17px] font-semibold">{tr('My watchlist', 'Ma watchlist')}</h2>
          <Button variant={adding ? 'ghost' : 'secondary'} className="w-auto min-h-10 px-3 py-1.5 text-[14px]" onClick={() => setAdding((a) => !a)}>
            {adding ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />} {adding ? tr('Close search', 'Fermer la recherche') : tr('Add an instrument', 'Ajouter un instrument')}
          </Button>
        </div>
        {adding && (
          <div className="px-5 pt-3">
            <InstrumentSearch autoFocus label={tr('Search an instrument', 'Rechercher un instrument')} action={(h) => addButton(h.id)} />
          </div>
        )}
        {empty ? (
          <p className="px-5 py-4 text-[14px] text-sq-muted">{tr('You are not following any instrument yet.', 'Vous ne suivez encore aucun instrument.')}</p>
        ) : (
          <>
            <p className="num px-5 pt-2 text-[12px] text-sq-muted">
              {quotes.data
                ? tr(`Prices fetched ${ageLabel(quotes.data.quotes[0]?.fetchedAt ?? new Date().toISOString())} · Yahoo Finance / CoinGecko`, `Cours récupérés ${ageLabel(quotes.data.quotes[0]?.fetchedAt ?? new Date().toISOString(), Date.now(), 'fr')} · Yahoo Finance / CoinGecko`)
                : quotes.error
                  ? tr('Prices unavailable right now.', 'Cours indisponibles pour le moment.')
                  : tr('Loading prices…', 'Chargement des cours…')}
            </p>
            <ul className="mt-1">
              {wl.items.map((it) => {
                const q = quotes.data?.quotes.find((x) => x.id === it.instrumentId);
                const qErr = (quotes.data?.errors as Record<string, string> | undefined)?.[it.instrumentId];
                return (
                  <li key={it.instrumentId} className="flex items-center gap-1 border-t border-sq-line/60 pr-2 first:border-t-0">
                    <Link to={instrumentPath(it.instrumentId)} className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3 px-4 py-2.5 hover:bg-sq-bg/60" data-testid="watch-row">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] text-sq-ink">{q?.name ?? it.name ?? it.instrumentId}</span>
                        <span className="block text-[12px] text-sq-muted">
                          {q?.symbol ?? it.symbol ?? it.instrumentId.slice(3)}
                          {q && ` · ${kindLabel(q.kind)} · ${q.currency}`}
                        </span>
                        {q && (
                          <span className={cx('block text-[11px]', q.stale ? 'text-sq-warn' : 'text-sq-muted')}>
                            {delayLabel(q)} · {tr('as of', 'à')} {zurichTime(q.asOf)}
                            {q.stale && ` · ${tr('stale', 'périmé')}`}
                          </span>
                        )}
                      </span>
                      {q ? (
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="num whitespace-nowrap text-[15px] text-sq-ink">
                            {fmt(q.price, q.price < 1 ? 4 : 2)}
                            <span className="ml-1 text-[12px]">{q.currency}</span>
                          </span>
                          {q.changePct !== null ? <ChangeBadge value={q.changePct} className="min-w-[56px] py-0.5 text-[12px]" /> : <span className="text-[12px] text-sq-muted">—</span>}
                        </span>
                      ) : qErr ? (
                        <span className="shrink-0 text-[12px] text-sq-muted">{tr('Price unavailable', 'Cours indisponible')}</span>
                      ) : quotes.error ? (
                        <span className="shrink-0 text-[12px] text-sq-muted">{tr('Price unavailable', 'Cours indisponible')}</span>
                      ) : (
                        <Skeleton className="h-8 w-20" />
                      )}
                      <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-sq-muted" aria-hidden />
                    </Link>
                    <Link
                      to={`/sq/markets?tab=alerts&new=${encodeURIComponent(it.instrumentId)}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-sq-muted hover:bg-sq-chip/60 hover:text-sq-ink"
                      aria-label={tr(`Create an alert for ${q?.name ?? it.instrumentId}`, `Créer une alerte pour ${q?.name ?? it.instrumentId}`)}
                      title={tr('Create alert', 'Créer une alerte')}
                    >
                      <Bell size={18} strokeWidth={1.75} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void act(it.instrumentId, () => wl.remove(it.instrumentId))}
                      disabled={busy === it.instrumentId}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-sq-muted hover:bg-sq-chip/60 hover:text-sq-down disabled:opacity-40"
                      aria-label={tr(`Remove ${q?.name ?? it.instrumentId} from watchlist`, `Retirer ${q?.name ?? it.instrumentId} de la watchlist`)}
                      title={tr('Remove', 'Retirer')}
                    >
                      {busy === it.instrumentId ? <Spinner /> : <Trash2 size={18} strokeWidth={1.75} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {empty && <Discover addButton={addButton} />}
    </section>
  );
}

function Discover({ addButton }: { addButton: (id: string) => React.ReactNode }) {
  const quotes = useQuotes(DISCOVER.map((d) => d.id));
  const groups: { id: (typeof DISCOVER)[number]['group']; label: string }[] = [
    { id: 'index', label: tr('Indices', 'Indices') },
    { id: 'equity', label: tr('Shares', 'Actions') },
    { id: 'etf', label: 'ETF' },
    { id: 'crypto', label: tr('Crypto', 'Crypto') },
  ];
  return (
    <Card className="px-0 pb-1 pt-4">
      <div className="px-5">
        <h2 className="text-[17px] font-semibold">{tr('Discover', 'Découvrir')}</h2>
        <p className="mt-1 text-[13px] text-sq-muted">
          {tr(
            'Suggestions of well-known instruments to get started — not a selection you made and not a recommendation. Add the ones you want to follow.',
            'Suggestions d’instruments connus pour démarrer — ce n’est pas une sélection de votre part ni une recommandation. Ajoutez ceux que vous voulez suivre.',
          )}
        </p>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="mt-3">
          <h3 className="px-5 text-[12px] font-semibold uppercase tracking-wide text-sq-muted">{g.label}</h3>
          <ul>
            {DISCOVER.filter((d) => d.group === g.id).map((d) => {
              const q = quotes.data?.quotes.find((x) => x.id === d.id);
              return (
                <li key={d.id} className="flex min-h-14 items-center gap-3 px-5 py-2">
                  <Link to={instrumentPath(d.id)} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-[15px] text-sq-ink">{d.name}</span>
                    <span className="block text-[12px] text-sq-muted">
                      {d.symbol}
                      {q && (
                        <>
                          {' · '}
                          <span className="num">
                            {fmt(q.price)} {q.currency}
                          </span>
                          {q.changePct !== null && ` · ${q.changePct >= 0 ? '+' : '−'}${Math.abs(q.changePct).toFixed(2)} %`}
                        </>
                      )}
                    </span>
                  </Link>
                  {addButton(d.id)}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {quotes.data && (
        <p className="num px-5 pb-3 pt-2 text-[11px] text-sq-muted">
          {tr('Prices: Yahoo Finance / CoinGecko, fetched', 'Cours : Yahoo Finance / CoinGecko, récupérés')} {ageLabel(quotes.data.quotes[0]?.fetchedAt ?? new Date().toISOString(), Date.now(), getLang())}
        </p>
      )}
    </Card>
  );
}
