// CHF valuation of the wallet: real, timestamped indicative market prices (market-data service → CoinGecko CHF)
// via useWalletRates(). There is NO fixed rate: a missing price means "CHF value unavailable", never a guess.
// These are indicative valuations, not executable quotes (the Swap quote is a separate, labelled demo).

import { useEffect, useState } from 'react';
import { ageLabel, useWalletRates, type WalletRate } from './market';
import { getLang, locale, tr } from './i18n';
import { cx, dateTime } from '../components/ui';

export type WalletAsset = 'ETH' | 'USDC';
export type Rates = Partial<Record<WalletAsset, WalletRate>>;

export function useRates() {
  const r = useWalletRates();
  return { rates: (r.data?.rates ?? {}) as Rates, loading: r.loading && !r.data, error: r.error, errors: r.data?.errors ?? {} };
}

/** qty × price, or null when the price is unknown (a zero quantity needs no price). */
export const valueOf = (qty: number, rate?: WalletRate | null): number | null => (qty === 0 ? 0 : rate ? qty * rate.chf : null);

/** Sum of values; null as soon as one held asset cannot be valued (never a partial total presented as the total). */
export const sumValues = (values: (number | null)[]) => values.reduce<number | null>((a, v) => (a === null || v === null ? null : a + v), 0);

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "Indicative valuation · CoinGecko · 22:35 (2 min ago)" — or why the CHF value is unavailable. */
export function RateNote({ rates, assets, loading, className }: { rates: Rates; assets: WalletAsset[]; loading?: boolean; className?: string }) {
  const now = useNow();
  const got = assets.map((a) => rates[a]).filter(Boolean) as WalletRate[];
  if (loading) return <span className={cx('text-sq-muted', className)}>{tr('Loading market prices…', 'Chargement des cours…')}</span>;
  if (got.length < assets.length)
    return (
      <span className={cx('text-sq-warn', className)}>
        {tr('CHF value unavailable: market price could not be loaded', 'Contre-valeur CHF indisponible : cours de marché non chargé')} ({assets.filter((a) => !rates[a]).join(', ')})
      </span>
    );
  const oldest = got.reduce((a, b) => (a.asOf < b.asOf ? a : b));
  const stale = got.some((r) => r.stale);
  return (
    <span className={cx(stale ? 'text-sq-warn' : 'text-sq-muted', className)} title={dateTime(oldest.asOf)}>
      {tr('Indicative valuation', 'Valorisation indicative')} · {oldest.provider} · {ageLabel(oldest.asOf, now, getLang())}
      {stale && ` · ${tr('last known price (provider unreachable)', 'dernier cours connu (fournisseur injoignable)')}`}
    </span>
  );
}

/** "≈ 12.34 CHF" + source/time for an amount being sent (indicative valuation, not an executable quote). */
export function ChfCounterValue({ asset, amount }: { asset: WalletAsset; amount: number }) {
  const { rates, loading } = useRates();
  const r = rates[asset];
  if (loading) return <span className="text-sq-muted">…</span>;
  if (!r) return <span className="text-sq-warn">{tr('CHF value unavailable', 'Contre-valeur CHF indisponible')}</span>;
  return (
    <span className="text-right text-sq-muted">
      <span className="num">≈ {fmtChf(amount * r.chf)} CHF</span>
      <span className="block text-[11px]">
        {tr('indicative', 'indicatif')} · {r.provider} · {dateTime(r.asOf)}
        {r.stale && ` · ${tr('last known price', 'dernier cours connu')}`}
      </span>
    </span>
  );
}

/** CHF amount with the "< 0.01" rule for tiny positive values. */
export const fmtChf = (v: number) => (v > 0 && v < 0.01 ? '< 0.01' : new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));
