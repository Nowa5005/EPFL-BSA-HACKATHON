// Portfolio value widget: total wallet value or one position, over 24h / 7d / 1M / 1Y.
// History = REAL snapshots recorded by the co-signer (on-chain balances × the indicative price recorded at that
// time, see services/sq-cosigner/src/snapshots.ts). Nothing is back-filled: without enough snapshots the widget
// says so, and can show the asset's MARKET price chart instead (clearly titled — not the client's portfolio).
// Values include deposits and withdrawals: this is a valuation, never presented as a performance/return.

import { useState } from 'react';
import { cosigner } from '../lib/api';
import { usePoll, useWalletTxs, type WalletTxView } from '../lib/hooks';
import { useHistory, type Range } from '../lib/market';
import { tr } from '../lib/i18n';
import { Card, cx, dateTime, Pill, Skeleton } from '../components/ui';
import { LineChart, type ChartMarker } from './LineChart';
import { assetColor } from '../lib/assetColors';

type SnapRange = '24h' | '7d' | '1M' | '1Y';
type View = 'total' | 'ETH' | 'USDC';
const RANGES: { id: SnapRange; label: () => string; market: Range }[] = [
  { id: '24h', label: () => tr('24h', '24 h'), market: '1D' },
  { id: '7d', label: () => tr('7d', '7 j'), market: '1W' },
  { id: '1M', label: () => tr('1M', '1 mois'), market: '1M' },
  { id: '1Y', label: () => tr('1Y', '1 an'), market: '1Y' },
];
const MARKET_ID: Record<'ETH' | 'USDC', string> = { ETH: 'cg:ethereum', USDC: 'cg:usd-coin' };

interface SnapPoint {
  t: number;
  at: string;
  total: number | null;
  assets: Record<'ETH' | 'USDC', { qty: number; value: number | null }>;
}
interface SnapSeries {
  range: SnapRange;
  from: string;
  to: string;
  recordingSince: string | null;
  points: SnapPoint[];
  enough: boolean;
  partial: boolean;
  intervalMinutes: number;
}

/** Deposits / withdrawals that change the value without being a market gain or loss (real, confirmed only). */
export function transferMarkers(txs: WalletTxView[], view: View): ChartMarker[] {
  return txs
    .filter((t) => t.status === 'confirmed' && !t.simulated && (view === 'total' || t.asset === view) && (t.kind === 'receive' || t.kind === 'send'))
    .map((t) => ({
      t: new Date(t.confirmedAt ?? t.createdAt).getTime(),
      kind: t.kind === 'receive' ? ('in' as const) : ('out' as const),
      label: `${t.kind === 'receive' ? tr('Deposit', 'Dépôt') : tr('Withdrawal', 'Retrait')} · ${t.amount} ${t.asset} · ${dateTime(t.confirmedAt ?? t.createdAt)}`,
    }));
}

export function PortfolioChart({ clientId, initialView = 'total', lockView }: { clientId: string; initialView?: View; lockView?: boolean }) {
  const [range, setRange] = useState<SnapRange>('7d');
  const [view, setView] = useState<View>(initialView);
  const snaps = usePoll<SnapSeries>(() => cosigner.get(`/clients/${clientId}/snapshots?range=${range}`), 60_000, [clientId, range]);
  const txs = useWalletTxs(15_000);
  const marketAsset: 'ETH' | 'USDC' = view === 'USDC' ? 'USDC' : 'ETH';
  const r = RANGES.find((x) => x.id === range)!;
  const s = snaps.data;
  const showMarket = !!s && !s.enough;
  const market = useHistory(showMarket ? MARKET_ID[marketAsset] : null, r.market);

  const title = view === 'total' ? tr('Wallet value', 'Valeur du wallet') : tr(`${view} position value`, `Valeur de la position ${view}`);
  const points = (s?.points ?? []).map((p) => ({ t: p.t, v: view === 'total' ? p.total : p.assets[view].value }));
  const markers = transferMarkers(txs.data ?? [], view);

  return (
    <Card className="min-w-0 space-y-3" as="section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {!lockView && (
          <div className="flex gap-1" role="group" aria-label={tr('Asset', 'Actif')}>
            {(['total', 'ETH', 'USDC'] as View[]).map((v) => (
              <Pill key={v} active={view === v} onClick={() => setView(v)}>
                {v === 'total' ? tr('Total', 'Total') : v}
              </Pill>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1" role="group" aria-label={tr('Period', 'Période')}>
        {RANGES.map((x) => (
          <Pill key={x.id} active={range === x.id} onClick={() => setRange(x.id)}>
            {x.label()}
          </Pill>
        ))}
      </div>

      {snaps.loading && !s ? (
        <Skeleton className="h-[200px]" />
      ) : snaps.error && !s ? (
        <p className="py-6 text-center text-[13px] text-sq-down">{tr('History unavailable', 'Historique indisponible')}: {snaps.error}</p>
      ) : !s?.enough ? (
        <div className="rounded-[10px] bg-sq-bg px-3 py-3 text-[13px] text-sq-ink-2" data-testid="history-not-enough">
          {s?.recordingSince
            ? tr(
                `History is being recorded since ${dateTime(s.recordingSince)} — not enough data for this period yet.`,
                `L’historique est enregistré depuis le ${dateTime(s.recordingSince)} — pas encore assez de données pour cette période.`,
              )
            : tr('History recording starts now (a snapshot every ~15 min) — no data for this period yet.', 'L’enregistrement de l’historique commence maintenant (un instantané toutes les ~15 min) — pas encore de données pour cette période.')}
        </div>
      ) : (
        <div data-testid="chart-personal">
          <LineChart points={points} markers={markers} unit="CHF" color={view === 'total' ? undefined : assetColor(view)?.fg} label={`${title}, ${r.label()}`} from={new Date(s.from).getTime()} to={new Date(s.to).getTime()} />
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-sq-muted">
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" aria-hidden><path d="M5,0 L10,9 L0,9 Z" fill="var(--color-sq-up)" /></svg> {tr('Deposit', 'Dépôt')}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" aria-hidden><path d="M5,10 L10,1 L0,1 Z" fill="var(--color-sq-ink)" /></svg> {tr('Withdrawal', 'Retrait')}
            </span>
            {s.partial && s.recordingSince && <span>{tr(`Recorded since ${dateTime(s.recordingSince)}`, `Enregistré depuis le ${dateTime(s.recordingSince)}`)}</span>}
          </div>
        </div>
      )}

      <p className="text-[12px] text-sq-muted">
        {tr(
          'Valuation of recorded snapshots (on-chain balances × indicative price recorded at that time). Deposits and withdrawals change the value: this is not a performance or return.',
          'Valorisation d’instantanés enregistrés (soldes on-chain × cours indicatif enregistré à ce moment). Dépôts et retraits modifient la valeur : ce n’est ni une performance ni un rendement.',
        )}
      </p>

      {showMarket && (
        <div className="border-t border-sq-line pt-3" data-testid="market-chart">
          <h3 className="text-[14px] font-semibold">{tr(`${marketAsset} market price (not your portfolio)`, `Cours de marché ${marketAsset} (pas votre portefeuille)`)}</h3>
          {market.data && market.data.points.length ? (
            <>
              <LineChart points={market.data.points} unit={market.data.currency} color={assetColor(marketAsset)?.fg} label={tr(`${marketAsset} market price, ${r.label()}`, `Cours ${marketAsset}, ${r.label()}`)} />
              <p className={cx('text-[12px]', market.data.stale ? 'text-sq-warn' : 'text-sq-muted')}>
                {market.data.provider} · {tr('updated', 'mis à jour')} {dateTime(market.data.fetchedAt)}
                {market.data.stale && ` · ${tr('last known data', 'dernières données connues')}`}
              </p>
            </>
          ) : market.error ? (
            <p className="text-[12px] text-sq-down">{tr('Market price unavailable', 'Cours indisponible')}: {market.error}</p>
          ) : (
            <Skeleton className="h-[200px]" />
          )}
        </div>
      )}
    </Card>
  );
}
