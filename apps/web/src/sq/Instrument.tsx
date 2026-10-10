// Instrument page (/sq/instrument/:id): real quote + real history from the market-data service.
// The change shown next to the chart is computed from the history of the selected period (first → last point).

import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bell, ChevronLeft, Star, StarOff } from 'lucide-react';
import { bank } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { getLang, tr } from '../lib/i18n';
import { ageLabel, marketGet, RANGES, useHistory, type Quote, type Range } from '../lib/market';
import { Button, Card, cx, fmt, Notice, Skeleton, Spinner } from '../components/ui';
import { SqMobileTop } from './SqShell';
import { ChangeTag, delayLabel, exchangeTime, fmtPrice, kindLabel, marketStateLabel, PriceChart } from './marketUi';
import { OrderTicket } from './OrderTicket';
import { AssetAvatar, assetColor } from '../lib/assetColors';

/** Accepts the likely shapes of GET /clients/:id/watchlist (content package) and returns the instrument ids. */
function watchIds(r: any): string[] {
  const arr = Array.isArray(r) ? r : r?.items ?? r?.watchlist ?? r?.instruments ?? [];
  return Array.isArray(arr) ? arr.map((x: any) => (typeof x === 'string' ? x : x?.instrumentId ?? x?.id)).filter(Boolean) : [];
}

export default function InstrumentPage() {
  const { id: raw = '' } = useParams();
  const id = decodeURIComponent(raw);
  const nav = useNavigate();
  const { session } = useLocal();
  const [range, setRange] = useState<Range>('1M');
  const [ticket, setTicket] = useState<'buy' | 'sell' | null>(null);
  const quote = usePoll(() => marketGet<Quote>(`/quote/${encodeURIComponent(id)}`), 60_000, [id]);
  const hist = useHistory(id, range);
  const q = quote.data;
  const h = hist.data && hist.data.range === range && hist.data.id === id ? hist.data : null;

  const clientId = session?.clientId;
  const wl = usePoll(async () => (clientId ? watchIds(await bank.get(`/clients/${clientId}/watchlist`)) : []), 60_000, [clientId]);
  const inWatchlist = wl.data?.includes(id) ?? false;
  const [wlBusy, setWlBusy] = useState(false);
  const [wlMsg, setWlMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const toggleWatch = async () => {
    if (!clientId) return;
    setWlBusy(true);
    setWlMsg(null);
    try {
      await bank.post(`/clients/${clientId}/watchlist${inWatchlist ? '/remove' : ''}`, { instrumentId: id });
      await wl.reload();
      setWlMsg({ tone: 'ok', text: inWatchlist ? tr('Removed from your watchlist.', 'Retiré de votre watchlist.') : tr('Added to your watchlist.', 'Ajouté à votre watchlist.') });
    } catch (e: any) {
      setWlMsg({ tone: 'bad', text: `${tr('Watchlist unavailable', 'Watchlist indisponible')}: ${e.message}` });
    } finally {
      setWlBusy(false);
    }
  };

  const closeTicket = useCallback(() => setTicket(null), []);
  const tz = q?.timezone ?? 'Europe/Zurich';
  const symbol = q?.symbol ?? id.replace(/^(yf|cg):/, '');

  return (
    <div className="mx-auto max-w-[880px]">
      <SqMobileTop />
      <button type="button" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/sq/markets'))} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[15px] text-sq-ink-2 hover:text-sq-ink">
        <ChevronLeft size={20} strokeWidth={1.75} /> {tr('Back', 'Retour')}
      </button>

      {quote.error && !q ? (
        <Notice tone="bad" className="mt-3" title={quote.error === 'Unknown instrument' || quote.error === 'Invalid instrument id' ? tr('Instrument not found', 'Instrument introuvable') : tr('Quote unavailable', 'Cours indisponible')}>
          {tr('The market data provider did not return a price for', 'Le fournisseur de données n’a pas renvoyé de cours pour')} <span className="num">{id}</span> ({quote.error}). {tr('No price is shown rather than an invented one.', 'Aucun cours n’est affiché plutôt qu’un cours inventé.')}
          <div className="mt-3">
            <Button variant="secondary" className="w-auto" onClick={() => void quote.reload()}>
              {tr('Retry', 'Réessayer')}
            </Button>
          </div>
        </Notice>
      ) : (
        <>
          <header className="mt-1">
            <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-tight lg:text-[26px]">
              {assetColor(id) && <AssetAvatar symbol={symbol} id={id} size={32} />}
              {q?.name ?? <Skeleton className="h-7 w-48" />}
            </h1>
            <p className="num text-[13px] text-sq-muted">
              {symbol}
              {q && ` · ${kindLabel(q.kind)} · ${q.exchange || '—'} · ${q.currency}`}
            </p>
            {q ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="num text-[30px] font-semibold tracking-tight">
                  {fmtPrice(q.price)}
                  <span className="ml-1 text-[0.55em] font-normal">{q.currency}</span>
                </span>
                <ChangeTag pct={q.changePct} label={q.changePeriod === '24h' ? tr('24 h change', 'Variation 24 h') : tr('Change vs previous close', 'Variation vs clôture précédente')} />
                <span className="text-[13px] text-sq-ink-2">
                  {q.change != null && `${q.change >= 0 ? '+' : '−'}${fmt(Math.abs(q.change), q.price < 1 ? 4 : 2)} ${q.currency} `}
                  {q.changePeriod === '24h' ? tr('over 24 h', 'sur 24 h') : tr('vs previous close', 'vs clôture précédente')}
                </span>
              </div>
            ) : (
              <Skeleton className="mt-3 h-9 w-56" />
            )}
            {q && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-sq-ink-2">
                <span className="rounded-full bg-sq-chip px-2 py-0.5 font-medium">{delayLabel(q.delay)}</span>
                <span className="rounded-full bg-sq-chip px-2 py-0.5">{marketStateLabel(q.marketState)}</span>
                <span>
                  {tr('Price as of', 'Cours au')} {exchangeTime(q.asOf, tz)} ({tz})
                </span>
                {q.stale && <span className="rounded-full bg-sq-warn-50 px-2 py-0.5 font-medium text-sq-warn">{tr('Stale — provider unreachable, last known value', 'Périmé — fournisseur injoignable, dernière valeur connue')}</span>}
              </p>
            )}
          </header>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:max-w-[520px]">
            <Button onClick={() => setTicket('buy')} disabled={!q}>
              {tr('Buy', 'Acheter')}
            </Button>
            <Button variant="secondary" onClick={() => setTicket('sell')} disabled={!q}>
              {tr('Sell', 'Vendre')}
            </Button>
          </div>
          <p className="mt-1 text-[12px] text-sq-muted">{tr('Buy and Sell open a demo order ticket — no order is ever placed in this prototype.', 'Acheter et Vendre ouvrent un ticket d’ordre de démonstration — aucun ordre n’est jamais passé dans ce prototype.')}</p>

          <Card className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-semibold">{tr('Price history', 'Historique des cours')}</h2>
              <span className="flex items-center gap-2 text-[13px] text-sq-ink-2">
                {tr(`Change over ${range}`, `Variation sur ${range}`)}
                {h ? <ChangeTag pct={h.changePct} label={tr(`Change over ${range}`, `Variation sur ${range}`)} /> : <span className="inline-block w-[72px]" />}
              </span>
            </div>
            <div className="mt-3">
              {h ? (
                <PriceChart history={h} timeZone={q?.timezone ?? 'UTC'} label={tr(`${symbol} price, ${range}`, `Cours ${symbol}, ${range}`)} />
              ) : hist.error ? (
                <Notice tone="bad" title={tr('History unavailable', 'Historique indisponible')}>
                  {hist.error}
                  <div className="mt-2">
                    <Button variant="secondary" className="w-auto" onClick={() => void hist.reload()}>
                      {tr('Retry', 'Réessayer')}
                    </Button>
                  </div>
                </Notice>
              ) : (
                <div className="flex h-[236px] items-center justify-center text-sq-muted">
                  <Spinner />
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-6 rounded-full bg-sq-bg p-1" role="tablist" aria-label={tr('Period', 'Période')}>
              {RANGES.map((r) => (
                <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={cx('min-h-9 rounded-full text-[14px]', range === r ? 'bg-sq-surface font-semibold shadow-sm' : 'text-sq-ink-2')}>
                  {r}
                </button>
              ))}
            </div>
            {h && (
              <p className="mt-2 text-[12px] text-sq-muted">
                {tr(`Period change = last vs first point of the ${range} history`, `Variation de la période = dernier vs premier point de l’historique ${range}`)} ({fmtPrice(h.first ?? 0)} → {fmtPrice(h.last ?? 0)} {h.currency}). {tr('Data', 'Données')}: {h.provider}, {tr('fetched', 'récupéré')} {ageLabel(h.fetchedAt, Date.now(), getLang())}
                {h.stale && ` — ${tr('stale', 'périmé')}`}.
              </p>
            )}
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="text-[17px] font-semibold">{tr('Information', 'Informations')}</h2>
              <dl className="mt-2 divide-y divide-sq-line text-[14px]">
                {(
                  [
                    [tr('Identifier', 'Identifiant'), id],
                    [tr('Symbol', 'Symbole'), symbol],
                    [tr('Type', 'Type'), q ? kindLabel(q.kind) : '—'],
                    [tr('Listing', 'Place de cotation'), q?.exchange || '—'],
                    [tr('Currency', 'Devise'), q?.currency ?? '—'],
                    [tr('Exchange timezone', 'Fuseau de la place'), q?.timezone ?? '—'],
                    [tr('Previous close', 'Clôture précédente'), q?.previousClose != null ? `${fmtPrice(q.previousClose)} ${q.currency}` : '—'],
                    [tr('Data delay', 'Délai des données'), q?.delayNote ?? '—'],
                    [tr('Provider', 'Fournisseur'), q?.provider ?? '—'],
                    [tr('Fetched', 'Récupéré'), q ? `${ageLabel(q.fetchedAt, Date.now(), getLang())}${q.stale ? ` (${tr('stale', 'périmé')})` : ''}` : '—'],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2">
                    <dt className="text-sq-ink-2">{k}</dt>
                    <dd className="num text-right text-sq-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <h2 className="text-[17px] font-semibold">{tr('Follow this instrument', 'Suivre cet instrument')}</h2>
              <div className="mt-3 space-y-2">
                <Button variant="secondary" onClick={toggleWatch} disabled={wlBusy || !clientId || wl.loading}>
                  {wlBusy ? <Spinner /> : inWatchlist ? <StarOff size={18} strokeWidth={1.75} /> : <Star size={18} strokeWidth={1.75} />}
                  {inWatchlist ? tr('Remove from watchlist', 'Retirer de la watchlist') : tr('Add to watchlist', 'Ajouter à la watchlist')}
                </Button>
                <Link to={`/sq/markets?tab=alerts&new=${encodeURIComponent(id)}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-sq-line bg-sq-surface px-4 py-3 text-[15px] font-semibold text-sq-ink hover:border-sq-muted/60">
                  <Bell size={18} strokeWidth={1.75} /> {tr('Create an alert', 'Créer une alerte')}
                </Link>
              </div>
              {wlMsg && (
                <p role="status" className={cx('mt-2 text-[13px]', wlMsg.tone === 'ok' ? 'text-sq-up' : 'text-sq-down')}>
                  {wlMsg.text}
                </p>
              )}
              {wl.error && !wlMsg && <p className="mt-2 text-[12px] text-sq-muted">{tr('Watchlist status unavailable', 'Statut de la watchlist indisponible')} ({wl.error}).</p>}
            </Card>
          </div>
          <p className="mt-4 text-center text-[11px] text-sq-muted">
            {tr('Data: Yahoo Finance / CoinGecko (free public feeds, for information only — not executable prices).', 'Données : Yahoo Finance / CoinGecko (flux publics gratuits, à titre informatif — pas des cours exécutables).')}
            {q && ` ${tr('Quote fetched at', 'Cours récupéré à')} ${exchangeTime(q.fetchedAt, 'Europe/Zurich', false)}.`}
          </p>
        </>
      )}
      {ticket && q && <OrderTicket instrument={{ id, symbol, name: q.name, currency: q.currency }} quote={q} side={ticket} onClose={closeTicket} />}
    </div>
  );
}
