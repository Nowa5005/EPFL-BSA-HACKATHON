// Minimal responsive SVG line chart (one series, 2 px line, recessive axes, crosshair + tooltip, optional
// event markers). Used for the personal portfolio history and for public market-price charts.
// Personal charts are NEVER rendered while amounts are masked (the caller shows a neutral placeholder instead),
// so no shape, axis value or tooltip can leak.

import { useEffect, useRef, useState } from 'react';
import { locale, tr } from '../lib/i18n';

export interface ChartPoint {
  t: number;
  v: number | null; // null = no value (gap)
}
export interface ChartMarker {
  t: number;
  kind: 'in' | 'out';
  label: string;
}

const H = 200;
const PAD = { l: 56, r: 12, t: 12, b: 26 };

const fmtV = (v: number, unit: string) => `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 4 : 2 }).format(v)} ${unit}`;
const fmtT = (t: number, spanMs: number) =>
  new Date(t).toLocaleString(locale(), { timeZone: 'Europe/Zurich', ...(spanMs <= 2 * 864e5 ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short' }) });
const fmtFull = (t: number) => new Date(t).toLocaleString(locale(), { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function LineChart({ points, unit = 'CHF', markers = [], label, from, to }: { points: ChartPoint[]; unit?: string; markers?: ChartMarker[]; label: string; from?: number; to?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valued = points.filter((p) => p.v !== null) as { t: number; v: number }[];
  if (!valued.length) return null;
  const t0 = from ?? points[0].t;
  const t1 = Math.max(to ?? points[points.length - 1].t, t0 + 1);
  let lo = Math.min(...valued.map((p) => p.v));
  let hi = Math.max(...valued.map((p) => p.v));
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) * 0.01 || 1;
    lo -= d;
    hi += d;
  }
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (w - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  // segments: a null value breaks the line (missing price → no invented value)
  const segs: string[] = [];
  let cur = '';
  for (const p of points) {
    if (p.v === null) {
      if (cur) segs.push(cur);
      cur = '';
      continue;
    }
    cur += `${cur ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  }
  if (cur) segs.push(cur);

  const valueAt = (t: number) => {
    let best = valued[0];
    for (const p of valued) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return best;
  };
  const ticks = [hi, (hi + lo) / 2, lo];
  // enough decimals for the three ticks to differ (e.g. a 227.5–228.3 range needs 2)
  const span = hi - lo;
  const tickDecimals = span >= 30 ? 0 : span >= 3 ? 1 : span >= 0.03 ? 2 : 4;
  const h = hover !== null ? valueAt(hover) : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={label}
        className="block touch-none"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          setHover(t0 + ((px - PAD.l) / (w - PAD.l - PAD.r)) * (t1 - t0));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-sq-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-sq-muted)" className="num">
              {new Intl.NumberFormat(locale(), { maximumFractionDigits: tickDecimals }).format(v)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize={11} fill="var(--color-sq-muted)">
          {fmtT(t0, t1 - t0)}
        </text>
        <text x={w - PAD.r} y={H - 6} textAnchor="end" fontSize={11} fill="var(--color-sq-muted)">
          {fmtT(t1, t1 - t0)}
        </text>
        {segs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--color-sq-chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {valued.length === 1 && <circle cx={x(valued[0].t)} cy={y(valued[0].v)} r={4} fill="var(--color-sq-chart)" />}
        {markers
          .filter((m) => m.t >= t0 && m.t <= t1)
          .map((m, i) => {
            const cx = x(m.t);
            const cy = y(valueAt(m.t).v);
            const d = m.kind === 'in' ? `M${cx},${cy - 6} L${cx + 5},${cy + 4} L${cx - 5},${cy + 4} Z` : `M${cx},${cy + 6} L${cx + 5},${cy - 4} L${cx - 5},${cy - 4} Z`;
            return (
              <path key={i} d={d} fill={m.kind === 'in' ? 'var(--color-sq-up)' : 'var(--color-sq-ink)'} stroke="white" strokeWidth={2}>
                <title>{m.label}</title>
              </path>
            );
          })}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-sq-muted)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(h.t)} cy={y(h.v)} r={4} fill="var(--color-sq-chart)" stroke="white" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-[8px] border border-sq-line bg-white px-2 py-1 text-[12px] shadow-sm"
          style={{ left: Math.min(Math.max(x(h.t) - 70, 0), w - 150) }}
          role="status"
        >
          <div className="text-sq-muted">{fmtFull(h.t)}</div>
          <div className="num font-semibold">{fmtV(h.v, unit)}</div>
        </div>
      )}
      <span className="sr-only">
        {tr('Range', 'Plage')}: {fmtV(lo, unit)} – {fmtV(hi, unit)}
      </span>
    </div>
  );
}
