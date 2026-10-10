// Pure alert evaluation (no I/O): rule + market data + previous state → new state (+ an optional trigger).
// The periodic evaluator in userdata.ts fetches the data and persists the result; this file only decides.
//
// No repeated notifications for the same crossing (hysteresis): a rule fires once when its condition becomes
// true, is then "disarmed", and is re-armed only after an evaluation where the condition is false again.
// Missing data never fires and never changes the arming: the status becomes "data-unavailable".

export const ZURICH = 'Europe/Zurich';
export type ChangePeriod = '1D' | '1W';
export const CHANGE_PERIODS: ChangePeriod[] = ['1D', '1W'];

export type AlertRule =
  | { type: 'price-above' | 'price-below'; instrumentId: string; threshold: number }
  | { type: 'change-pct'; instrumentId: string; period: ChangePeriod; direction: 'up' | 'down' | 'either'; pct: number }
  | { type: 'reminder'; instrumentId?: string; at: string /* Europe/Zurich wall-clock 'YYYY-MM-DDTHH:mm' */; note: string };

export interface EvalState {
  armed: boolean; // true = will fire on the next evaluation where the condition holds
  status: 'ok' | 'data-unavailable' | 'never-evaluated';
  lastCheckedAt?: string;
  lastValue?: number; // price (price rules) or % change (change rules) at the last successful check
}

export interface EvalInput {
  now: Date;
  /** Latest quote for the rule's instrument (null/undefined = unavailable). */
  quote?: { price: number; asOf: string } | null;
  /** Market-data history for the rule's period (change-pct rules only). The first point is the reference. */
  history?: { points: { t: number; v: number }[] } | null;
}

export interface EvalTrigger {
  value: number | null;
  detail: { en: string; fr: string };
  dataAsOf?: string;
}

export const initialState = (): EvalState => ({ armed: true, status: 'never-evaluated' });

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const f2 = (n: number) => (Math.abs(n) >= 1000 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(4));

/** % change of `price` vs the first point of the period's history, or null when it cannot be computed. */
export function changeOverPeriod(price: number, history?: EvalInput['history']): number | null {
  const first = history?.points?.find((p) => Number.isFinite(p.v) && p.v > 0);
  if (!first || !Number.isFinite(price)) return null;
  return ((price - first.v) / first.v) * 100;
}

export function evaluateRule(rule: AlertRule, input: EvalInput, prev: EvalState): { state: EvalState; trigger?: EvalTrigger } {
  const checkedAt = input.now.toISOString();
  const unavailable = () => ({ state: { ...prev, status: 'data-unavailable' as const, lastCheckedAt: checkedAt } });

  const step = (cond: boolean, value: number, trigger: () => EvalTrigger) => {
    const base: EvalState = { armed: prev.armed, status: 'ok', lastCheckedAt: checkedAt, lastValue: round(value) };
    if (cond && prev.armed) return { state: { ...base, armed: false }, trigger: trigger() };
    if (!cond && !prev.armed) return { state: { ...base, armed: true } };
    return { state: base };
  };

  switch (rule.type) {
    case 'price-above':
    case 'price-below': {
      const q = input.quote;
      if (!q || !Number.isFinite(q.price)) return unavailable();
      const above = rule.type === 'price-above';
      const cond = above ? q.price > rule.threshold : q.price < rule.threshold;
      return step(cond, q.price, () => ({
        value: q.price,
        dataAsOf: q.asOf,
        detail: above
          ? { en: `Price ${f2(q.price)} rose above ${f2(rule.threshold)}`, fr: `Le cours ${f2(q.price)} est passé au-dessus de ${f2(rule.threshold)}` }
          : { en: `Price ${f2(q.price)} fell below ${f2(rule.threshold)}`, fr: `Le cours ${f2(q.price)} est passé en dessous de ${f2(rule.threshold)}` },
      }));
    }
    case 'change-pct': {
      const q = input.quote;
      if (!q || !Number.isFinite(q.price)) return unavailable();
      const ch = changeOverPeriod(q.price, input.history);
      if (ch === null) return unavailable();
      const cond = rule.direction === 'up' ? ch >= rule.pct : rule.direction === 'down' ? ch <= -rule.pct : Math.abs(ch) >= rule.pct;
      const s = `${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(2)} %`;
      return step(cond, ch, () => ({
        value: round(ch),
        dataAsOf: q.asOf,
        detail: { en: `Change over ${rule.period}: ${s} (threshold ${rule.pct} %)`, fr: `Variation sur ${rule.period} : ${s} (seuil ${rule.pct} %)` },
      }));
    }
    case 'reminder': {
      const due = zurichLocalToUtc(rule.at);
      if (due === null) return unavailable();
      // One-shot: fires once when the time has come; re-armed only if the rule is edited (state reset).
      if (prev.armed && input.now.getTime() >= due.getTime())
        return {
          state: { armed: false, status: 'ok', lastCheckedAt: checkedAt },
          trigger: { value: null, detail: { en: `Reminder: ${rule.note || '—'}`, fr: `Rappel : ${rule.note || '—'}` } },
        };
      return { state: { ...prev, status: 'ok', lastCheckedAt: checkedAt } };
    }
  }
}

// ───────────── Europe/Zurich wall-clock time ↔ UTC (DST-aware, no library) ─────────────

const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: ZURICH, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Offset of Europe/Zurich from UTC at a given instant, in minutes (+60 in winter, +120 in summer). */
export function zurichOffsetMinutes(utcMs: number): number {
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * 'YYYY-MM-DDTHH:mm' read as Europe/Zurich wall-clock time → UTC instant.
 * Ambiguous times (the repeated hour when DST ends) resolve to the FIRST occurrence (summer time);
 * non-existent times (the skipped hour when DST starts) are moved forward by the gap (02:30 → 03:30 CEST).
 */
export function zurichLocalToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCDate() !== d) return null; // e.g. 31 February
  const valid = [120, 60].map((off) => wall - off * 60_000).filter((c) => zurichOffsetMinutes(c) * 60_000 === wall - c);
  if (valid.length) return new Date(Math.min(...valid));
  // In the gap: use the offset in force just before the transition.
  return new Date(wall - zurichOffsetMinutes(wall - 3 * 3600_000) * 60_000);
}

// ───────────── Validation (shared by the routes) ─────────────

export const INSTRUMENT_ID_RE = /^(yf:[A-Za-z0-9.^=\-]{1,20}|cg:[a-z0-9-]{1,64})$/;

export function parseRule(x: any): AlertRule | string {
  if (!x || typeof x !== 'object') return 'rule required';
  const id = typeof x.instrumentId === 'string' ? x.instrumentId : undefined;
  switch (x.type) {
    case 'price-above':
    case 'price-below': {
      const threshold = Number(x.threshold);
      if (!id || !INSTRUMENT_ID_RE.test(id)) return 'invalid instrumentId';
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1e12) return 'invalid threshold';
      return { type: x.type, instrumentId: id, threshold };
    }
    case 'change-pct': {
      const pct = Number(x.pct);
      if (!id || !INSTRUMENT_ID_RE.test(id)) return 'invalid instrumentId';
      if (!CHANGE_PERIODS.includes(x.period)) return 'invalid period';
      if (!['up', 'down', 'either'].includes(x.direction)) return 'invalid direction';
      if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return 'invalid pct';
      return { type: 'change-pct', instrumentId: id, period: x.period, direction: x.direction, pct };
    }
    case 'reminder': {
      if (id !== undefined && !INSTRUMENT_ID_RE.test(id)) return 'invalid instrumentId';
      if (typeof x.at !== 'string' || !zurichLocalToUtc(x.at)) return 'invalid date/time';
      const note = typeof x.note === 'string' ? x.note.trim().slice(0, 140) : '';
      return { type: 'reminder', ...(id ? { instrumentId: id } : {}), at: x.at, note };
    }
    default:
      return 'invalid rule type';
  }
}
