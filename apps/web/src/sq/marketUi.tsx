// Small presentation helpers shared by Trade, the instrument page, search and the home "Markets" section.
// Values always come from lib/market.ts (market-data service) — nothing here invents a price.

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cx, fmt } from '../components/ui';
import { locale, tr } from '../lib/i18n';
import type { History, Kind, Quote } from '../lib/market';

/** Price with sensible precision (sub-unit crypto prices keep 4 decimals). */
export const fmtPrice = (v: number) => fmt(v, Math.abs(v) < 1 ? 4 : 2);

/** Change in % with an arrow and a sign, so it never relies on colour alone. */
export function ChangeTag({ pct, className, label }: { pct: number | null | undefined; className?: string; label?: string }) {
  if (pct == null || !Number.isFinite(pct))
    return <span className={cx('num inline-flex min-w-[72px] shrink-0 justify-center rounded-[4px] bg-sq-chip px-1.5 py-1.5 text-[13px] text-sq-muted', className)}>n/a</span>;
  const flat = Math.abs(pct) < 0.005;
  const up = pct > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = `${up ? '+' : flat ? '' : '−'}${Math.abs(pct).toFixed(2)} %`;
  return (
    <span
      className={cx('num inline-flex min-w-[72px] shrink-0 items-center justify-center gap-0.5 rounded-[4px] px-1.5 py-1.5 text-[13px] font-medium', flat ? 'bg-sq-chip text-sq-ink-2' : up ? 'bg-sq-up-solid text-white' : 'bg-sq-down-solid text-white', className)}
      aria-label={`${label ? label + ' ' : ''}${flat ? tr('unchanged', 'inchangé') : up ? tr('up', 'en hausse de') : tr('down', 'en baisse de')} ${Math.abs(pct).toFixed(2)} %`}
    >
      <Icon size={14} strokeWidth={2.25} aria-hidden />
      {text}
    </span>
  );
}

/** Time of a price in the exchange's own timezone, e.g. "09.10.2026, 17:30 CEST". */
export function exchangeTime(iso: string, timeZone: string, withDate = true) {
  try {
    return new Date(iso).toLocaleString(locale(), {
      timeZone,
      ...(withDate ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return new Date(iso).toISOString();
  }
}

/** Short freshness of one quote for a list row: time today, otherwise date + time (exchange timezone). */
export function rowTime(q: Quote) {
  const tz = q.timezone || 'UTC';
  const sameDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const today = sameDay(new Date()) === sameDay(new Date(q.asOf));
  return new Date(q.asOf).toLocaleString(locale(), { timeZone: tz, ...(today ? {} : { day: '2-digit', month: '2-digit' }), hour: '2-digit', minute: '2-digit' });
}

export function delayLabel(d: Quote['delay']) {
  return d === 'realtime' ? tr('Live (aggregated)', 'En direct (agrégé)') : d === 'delayed' ? tr('Delayed', 'Différé') : d === 'close' ? tr('Last close', 'Dernière clôture') : tr('Unknown delay', 'Délai inconnu');
}

export function marketStateLabel(s: Quote['marketState']) {
  return s === 'open' ? tr('Market open', 'Marché ouvert') : s === 'closed' ? tr('Market closed', 'Marché fermé') : tr('Trades 24/7', 'Négocié 24 h/24, 7 j/7');
}

export function kindLabel(k: Kind) {
  return k === 'equity' ? tr('Share', 'Action') : k === 'etf' ? 'ETF' : k === 'index' ? tr('Index', 'Indice') : tr('Crypto-asset', 'Crypto-actif');
}

const RANGE_FMT: Record<History['range'], Intl.DateTimeFormatOptions> = {
  '1D': { hour: '2-digit', minute: '2-digit' },
  '1W': { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
  '1M': { day: '2-digit', month: '2-digit', year: 'numeric' },
  '6M': { day: '2-digit', month: '2-digit', year: 'numeric' },
  '1Y': { day: '2-digit', month: '2-digit', year: 'numeric' },
  '5Y': { day: '2-digit', month: '2-digit', year: 'numeric' },
};
export const pointTime = (t: number, range: History['range'], timeZone: string) => new Date(t).toLocaleString(locale(), { ...RANGE_FMT[range], timeZone });

/**
 * Line chart of a REAL price history (hand-made SVG like the rest of the app). Hover / touch shows the date and value;
 * the chart is focusable and the ← → Home End keys move between points (the value is announced).
 */
export function PriceChart({ history, timeZone, label, className }: { history: History; timeZone: string; label: string; className?: string }) {
  const pts = history.points;
  const [idx, setIdx] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const w = 600;
  const h = 180;
  const { path, coords, min, max } = useMemo(() => {
    const vs = pts.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const coords = pts.map((p, i) => [(i / Math.max(1, pts.length - 1)) * w, h - 12 - ((p.v - min) / (max - min || 1)) * (h - 30)] as const);
    return { path: coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '), coords, min, max };
  }, [pts]);
  if (pts.length < 2) return <p className="py-10 text-center text-[14px] text-sq-muted">{tr('Not enough data points for this period.', 'Pas assez de points pour cette période.')}</p>;
  const up = (history.last ?? 0) >= (history.first ?? 0);
  const color = up ? 'var(--color-sq-up, #1f9d55)' : 'var(--color-sq-down, #d64545)';
  const sel = idx != null ? pts[idx] : null;

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setIdx(Math.round(f * (pts.length - 1)));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = idx ?? pts.length - 1;
    const step = e.shiftKey ? Math.max(1, Math.round(pts.length / 10)) : 1;
    let n: number | null = null;
    if (e.key === 'ArrowLeft') n = Math.max(0, cur - step);
    else if (e.key === 'ArrowRight') n = Math.min(pts.length - 1, cur + step);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = pts.length - 1;
    else if (e.key === 'Escape') return setIdx(null);
    if (n != null) {
      e.preventDefault();
      setIdx(n);
    }
  };

  return (
    <div className={cx('relative', className)}>
      <div className="flex min-h-[40px] items-end justify-between gap-2 text-[13px]" aria-live="polite">
        {sel ? (
          <>
            <span className="text-sq-ink-2">{pointTime(sel.t, history.range, timeZone)}</span>
            <span className="num font-semibold text-sq-ink">
              {fmtPrice(sel.v)} {history.currency}
            </span>
          </>
        ) : (
          <span className="text-sq-muted">
            {tr('Hover, touch or focus the chart and use ← → to read values', 'Survolez, touchez ou sélectionnez le graphique (← →) pour lire les valeurs')}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-44 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sq-orange"
        role="img"
        tabIndex={0}
        aria-label={`${label}. ${tr('Range', 'Plage')} ${fmtPrice(min)}–${fmtPrice(max)} ${history.currency}. ${tr('Use the left and right arrow keys to read each point.', 'Utilisez les flèches gauche et droite pour lire chaque point.')}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setIdx(null)}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
        data-first={history.first ?? ''}
        data-last={history.last ?? ''}
        data-points={pts.length}
      >
        <defs>
          <linearGradient id={`pc${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L${w},${h} L0,${h} Z`} fill={`url(#pc${gid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {idx != null && (
          <>
            <line x1={coords[idx][0]} x2={coords[idx][0]} y1={0} y2={h} stroke="var(--color-sq-muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <circle cx={coords[idx][0]} cy={coords[idx][1]} r="4" fill={color} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-sq-muted">
        <span>{pointTime(pts[0].t, history.range, timeZone)}</span>
        <span>{pointTime(pts[pts.length - 1].t, history.range, timeZone)}</span>
      </div>
    </div>
  );
}
