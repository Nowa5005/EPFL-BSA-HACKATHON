// "My crypto" widget: every asset actually held (on-chain ETH and USDC on Sepolia, plus the demo-only simulated
// USDC, labelled as such), with quantity and position value (masked by default), unit market price and its 24 h
// change (public data, always visible). Prices: shared market-data layer (CoinGecko CHF, indicative).

import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { useMasked } from '../lib/prefs';
import { tr } from '../lib/i18n';
import { fmtChf, RateNote, valueOf, type Rates, type WalletAsset } from '../lib/valuation';
import { Card, cx, fmt, MockBadge } from '../components/ui';
import { UnrecognisedTokens } from './scam';

export interface Holding {
  key: string;
  asset: WalletAsset;
  name: string;
  qty: number;
  simulated?: boolean;
  decimals: number;
}

export function holdingsOf(onchain: any): Holding[] {
  const out: Holding[] = [];
  const eth = Number(onchain?.eth ?? 0);
  const usdc = Number(onchain?.usdc ?? 0);
  const sim = Number(onchain?.simulatedUsdc ?? 0);
  // always list the wallet's two supported assets (a zero balance is information too); simulated only when present
  out.push({ key: 'ETH', asset: 'ETH', name: 'Ether', qty: eth, decimals: 5 });
  out.push({ key: 'USDC', asset: 'USDC', name: 'USD Coin', qty: usdc, decimals: 2 });
  if (sim > 0) out.push({ key: 'USDC-sim', asset: 'USDC', name: tr('USD Coin — simulated receipts', 'USD Coin — réceptions simulées'), qty: sim, decimals: 2, simulated: true });
  return out;
}

export function Change({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return <span className="text-[12px] text-sq-muted">{tr('24h: n/a', '24 h : n.d.')}</span>;
  const flat = Math.abs(pct) < 0.005;
  const Icon = flat ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  const word = flat ? tr('unchanged', 'stable') : pct > 0 ? tr('up', 'en hausse') : tr('down', 'en baisse');
  return (
    <span className={cx('num inline-flex items-center gap-0.5 text-[12px] font-medium', flat ? 'text-sq-muted' : pct > 0 ? 'text-sq-up' : 'text-sq-down')} aria-label={`${word} ${fmt(Math.abs(pct))} % ${tr('over 24 h', 'sur 24 h')}`}>
      <Icon size={14} strokeWidth={2} aria-hidden />
      {pct > 0 && !flat ? '+' : pct < 0 && !flat ? '−' : ''}
      {fmt(Math.abs(pct))} % <span className="font-normal text-sq-muted">24h</span>
    </span>
  );
}

export function CryptoList({ onchain, rates, ratesLoading }: { onchain: any; rates: Rates; ratesLoading?: boolean }) {
  const masked = useMasked();
  const rows = holdingsOf(onchain);
  return (
    <Card className="min-w-0" as="section">
      <h2 className="mb-1 text-[17px] font-semibold">{tr('My crypto', 'Mes cryptos')}</h2>
      <p className="mb-2 text-[12px] text-sq-muted">
        <RateNote rates={rates} assets={['ETH', 'USDC']} loading={ratesLoading} />
      </p>
      <ul className="max-h-[320px] divide-y divide-sq-line overflow-y-auto overscroll-contain" aria-label={tr('Assets held', 'Actifs détenus')} data-testid="crypto-list">
        {rows.map((h) => {
          const r = rates[h.asset];
          const value = valueOf(h.qty, r);
          return (
            <li key={h.key}>
              <Link to={`/asset/${h.asset}`} className="flex min-h-[64px] items-center gap-3 py-2.5 hover:bg-sq-bg/50">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sq-bg text-[12px] font-semibold">{h.asset}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {h.name} {h.simulated && <MockBadge label={tr('Demo', 'Démo')} />}
                  </span>
                  <span className="block truncate text-[12px] text-sq-muted">
                    {h.asset} · {tr('Ethereum Sepolia (testnet)', 'Ethereum Sepolia (réseau de test)')}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-sq-ink-2">
                    <span className="num">{r ? `1 ${h.asset} = ${fmt(r.chf, r.chf < 10 ? 4 : 2)} CHF` : tr('Price unavailable', 'Cours indisponible')}</span>
                    {r && <Change pct={r.changePct24h} />}
                    {h.asset === 'USDC' && <span className="text-sq-muted">{tr('stablecoin (USD)', 'stablecoin (USD)')}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-right">
                  <span className="num text-[15px] font-semibold" aria-label={masked ? tr('Amount hidden', 'Montant masqué') : undefined}>
                    {masked ? '••••••' : value === null ? '—' : `${fmtChf(value)} CHF`}
                  </span>
                  <span className="num text-[12px] text-sq-muted" aria-label={masked ? tr('Quantity hidden', 'Quantité masquée') : undefined}>
                    {masked ? `•••• ${h.asset}` : `${h.qty > 0 && h.qty < 10 ** -h.decimals ? `< ${fmt(10 ** -h.decimals, h.decimals)}` : fmt(h.qty, h.decimals)} ${h.asset}`}
                  </span>
                  {!masked && value === null && <span className="text-[11px] text-sq-warn">{tr('CHF value unavailable', 'Contre-valeur indisponible')}</span>}
                </span>
                <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-sq-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      <UnrecognisedTokens />
      <p className="mt-2 text-[11px] text-sq-muted">
        {tr(
          'Testnet assets (no real value) are valued at the market price of the mainnet asset, for illustration. Arrows show the market price change over 24 h, not your return.',
          'Actifs de réseau de test (sans valeur réelle) valorisés au cours de marché de l’actif principal, à titre d’illustration. Les flèches indiquent la variation du cours sur 24 h, pas votre rendement.',
        )}
      </p>
    </Card>
  );
}
