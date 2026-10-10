// Per-asset colours (N8): ONE definition, used by the wallet lists, charts, Trade rows and instrument pages, on
// phone and desktop. The values are CSS variables (index.css, `--asset-*`) with light and dark nuances, so a given
// asset is always the same identifiable colour in both modes. Unknown assets fall back to a neutral tone; stocks and
// indices keep the Swissquote orange avatar of the Trade lists.

import type { CSSProperties } from 'react';
// (no import from components/ui: keeps this module dependency-free and unit-testable)
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export type AssetKey = 'eth' | 'usdc' | 'btc' | 'other';

const ALIASES: Record<string, AssetKey> = {
  eth: 'eth',
  weth: 'eth',
  ether: 'eth',
  ethereum: 'eth',
  'cg:ethereum': 'eth',
  usdc: 'usdc',
  'usd coin': 'usdc',
  'cg:usd-coin': 'usdc',
  btc: 'btc',
  bitcoin: 'btc',
  'cg:bitcoin': 'btc',
};

/** Asset key from a symbol ("ETH"), a name ("Bitcoin") or a market-data id ("cg:bitcoin"). */
export function assetKey(symbolOrId: string | undefined | null): AssetKey | null {
  if (!symbolOrId) return null;
  const k = symbolOrId.trim().toLowerCase();
  return ALIASES[k] ?? (k.startsWith('cg:') ? 'other' : null);
}

/** Foreground (text, line, dot) and tinted background for an asset; null for non-crypto instruments. */
export function assetColor(symbolOrId: string | undefined | null): { fg: string; bg: string; key: AssetKey } | null {
  const key = assetKey(symbolOrId);
  if (!key) return null;
  return { key, fg: `var(--asset-${key})`, bg: `var(--asset-${key}-bg)` };
}

/** Round avatar with the asset ticker, in the asset colour (same on phone and desktop). */
export function AssetAvatar({ symbol, id, size = 40, className }: { symbol: string; id?: string; size?: number; className?: string }) {
  const c = assetColor(id ?? symbol) ?? assetColor('cg:other')!;
  const style: CSSProperties = { width: size, height: size, background: c.bg, color: c.fg, fontSize: size >= 36 ? 12 : 11 };
  return (
    <span aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold', className)} style={style} data-asset={c.key}>
      {symbol.length > 4 ? symbol.slice(0, 4) : symbol}
    </span>
  );
}

/** Small colour dot identifying an asset next to its name. */
export function AssetDot({ symbol, className }: { symbol: string; className?: string }) {
  const c = assetColor(symbol);
  if (!c) return null;
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: c.fg }} />;
}
