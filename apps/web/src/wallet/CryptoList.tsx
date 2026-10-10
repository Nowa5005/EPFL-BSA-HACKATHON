// "My crypto" widget: every asset actually held (on-chain ETH and USDC on Sepolia, plus the demo-only simulated
// USDC, labelled as such), with quantity and position value, unit market price and its 24 h
// change (public data, always visible). Prices: shared market-data layer (CoinGecko CHF, indicative).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus, Search, SlidersHorizontal } from 'lucide-react';
import { AssetAvatar, assetColor } from '../lib/assetColors';
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

export function CryptoList({ onchain, rates, ratesLoading, variant = 'list', onCustomize }: { onchain: any; rates: Rates; ratesLoading?: boolean; variant?: 'list' | 'cards'; onCustomize?: () => void }) {
  const rows = holdingsOf(onchain);
  if (variant === 'cards') return <CryptoCards rows={rows} rates={rates} ratesLoading={ratesLoading} onCustomize={onCustomize} />;
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
                <AssetAvatar symbol={h.asset} />
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
                  <span className="num text-[15px] font-semibold">
                    {value === null ? '—' : `${fmtChf(value)} CHF`}
                  </span>
                  <span className="num text-[12px] text-sq-muted">
                    {`${h.qty > 0 && h.qty < 10 ** -h.decimals ? `< ${fmt(10 ** -h.decimals, h.decimals)}` : fmt(h.qty, h.decimals)} ${h.asset}`}
                  </span>
                  {value === null && <span className="text-[11px] text-sq-warn">{tr('CHF value unavailable', 'Contre-valeur indisponible')}</span>}
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

const DISCLAIMER = () =>
  tr(
    'Testnet assets (no real value) are valued at the market price of the mainnet asset, for illustration. Arrows show the market price change over 24 h, not your return.',
    'Actifs de réseau de test (sans valeur réelle) valorisés au cours de marché de l’actif principal, à titre d’illustration. Les flèches indiquent la variation du cours sur 24 h, pas votre rendement.',
  );

/** N7 mobile variant: section title with small controls, rounded asset cards with a subtle per-asset tint
 *  (lib/assetColors.tsx), and a rounded search field at the bottom of the list. Same data as the list variant. */
function CryptoCards({ rows, rates, ratesLoading, onCustomize }: { rows: Holding[]; rates: Rates; ratesLoading?: boolean; onCustomize?: () => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? rows.filter((h) => `${h.asset} ${h.name}`.toLowerCase().includes(query)) : rows;
  return (
    <section aria-labelledby="mw-assets-title" className="min-w-0">
      <div className="mb-2 flex min-h-11 items-center gap-2 px-1">
        <h2 id="mw-assets-title" className="flex-1 text-[17px] font-semibold">
          {tr('My crypto', 'Mes cryptos')}
        </h2>
        {onCustomize && (
          <button type="button" onClick={onCustomize} aria-label={tr('Customize home', 'Personnaliser l’accueil')} title={tr('Customize home', 'Personnaliser l’accueil')} className="flex size-11 items-center justify-center rounded-full text-sq-ink-2 hover:bg-sq-chip/60">
            <SlidersHorizontal size={19} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <p className="mb-2.5 px-1 text-[12px] text-sq-muted">
        <RateNote rates={rates} assets={['ETH', 'USDC']} loading={ratesLoading} /> · {tr('Ethereum Sepolia (testnet)', 'Ethereum Sepolia (réseau de test)')}
      </p>
      <ul className="space-y-2.5" aria-label={tr('Assets held', 'Actifs détenus')} data-testid="crypto-list">
        {shown.map((h) => {
          const r = rates[h.asset];
          const value = valueOf(h.qty, r);
          const c = assetColor(h.asset);
          return (
            <li key={h.key}>
              <Link
                to={`/asset/${h.asset}`}
                className="mw-asset-card flex min-h-[76px] items-center gap-3 rounded-[18px] border border-sq-line px-3.5 py-3"
                style={{ background: c ? `color-mix(in srgb, ${c.bg} 60%, var(--color-sq-surface))` : undefined }}
              >
                <AssetAvatar symbol={h.asset} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">
                    {h.name} {h.simulated && <MockBadge label={tr('Demo', 'Démo')} />}
                  </span>
                  <span className="num block truncate text-[13px] text-sq-ink-2">{r ? `${fmt(r.chf, r.chf < 10 ? 4 : 2)} CHF` : tr('Price unavailable', 'Cours indisponible')}</span>
                  {r && <Change pct={r.changePct24h} />}
                </span>
                <span className="flex shrink-0 flex-col items-end text-right">
                  <span className="num text-[15px] font-semibold">
                    {`${h.qty > 0 && h.qty < 10 ** -h.decimals ? `< ${fmt(10 ** -h.decimals, h.decimals)}` : fmt(h.qty, h.decimals)} ${h.asset}`}
                  </span>
                  <span className="num text-[13px] text-sq-ink-2">{value === null ? '—' : `${fmtChf(value)} CHF`}</span>
                  {value === null && <span className="text-[11px] text-sq-warn">{tr('CHF value unavailable', 'Contre-valeur indisponible')}</span>}
                  {h.asset === 'USDC' && !h.simulated && <span className="text-[11px] text-sq-muted">{tr('stablecoin (USD)', 'stablecoin (USD)')}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-1 py-4 text-center text-[14px] text-sq-muted">{tr('No asset matches your search.', 'Aucun actif ne correspond à votre recherche.')}</li>}
      </ul>
      <label className="relative mt-3 block">
        <span className="sr-only">{tr('Search my assets', 'Rechercher dans mes actifs')}</span>
        <Search size={18} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sq-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Search my assets', 'Rechercher dans mes actifs')}
          className="min-h-12 w-full rounded-full border border-sq-line bg-sq-surface pl-11 pr-4 text-[15px] text-sq-ink outline-none placeholder:text-sq-muted focus:border-sq-ink/40"
          enterKeyHint="search"
        />
      </label>
      <div className="mt-2">
        <UnrecognisedTokens />
      </div>
      <p className="mt-2 px-1 text-[11px] text-sq-muted">{DISCLAIMER()}</p>
    </section>
  );
}
