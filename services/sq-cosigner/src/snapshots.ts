// Portfolio history = REAL recorded snapshots only. Each snapshot stores, for one client's Safe, the on-chain
// quantities read at that time and the indicative CHF rates used then (with their own timestamp/provider).
// The chart values each snapshot at the price recorded at that time. We never rebuild history by multiplying
// today's quantities by past prices: before the first snapshot there is simply no personal history.
//
// Recording: every SNAPSHOT_INTERVAL_MS (default 15 min) while the co-signer runs, for every client with a
// Safe, and opportunistically when /clients/:id/onchain is read (at most once every 5 min per client).
// Retention (keeps the JSON db small): full resolution for 48 h, then 1 per hour up to 35 days, then 1 per day,
// nothing older than 400 days. Simulated demo receptions are NOT part of the history (not on-chain).

import type { Express, Request } from 'express';
import { formatEther, formatUnits } from 'ethers';
import { USDC_DECIMALS, parseLang, pick } from '@sq/shared';
import { fetchWalletRates, type WalletRates } from '@sq/shared/server';
import { db, getClient, HttpError, type Client } from './db';
import { balancesOf } from './chain';

export type SnapAsset = 'ETH' | 'USDC';
export const SNAP_ASSETS: SnapAsset[] = ['ETH', 'USDC'];

export interface Snapshot {
  at: string; // ISO time the balances were read
  quantities: Record<SnapAsset, string>; // decimal strings, on-chain
  rates: Partial<Record<SnapAsset, { chf: number; asOf: string; provider: string; stale: boolean }>>;
}

export type SnapRange = '24h' | '7d' | '1M' | '1Y';
export const SNAP_RANGES: Record<SnapRange, number> = { '24h': 864e5, '7d': 7 * 864e5, '1M': 30 * 864e5, '1Y': 365 * 864e5 };
/** A period is shown only when the recorded points span at least this share of it. */
export const MIN_COVERAGE = 0.1;
export const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 15 * 60_000);
export const OPPORTUNISTIC_MIN_GAP_MS = 5 * 60_000;

// ─────────────── pure logic (unit-tested) ───────────────

export function makeSnapshot(at: Date, quantities: Record<SnapAsset, string>, rates: WalletRates): Snapshot {
  const r: Snapshot['rates'] = {};
  for (const a of SNAP_ASSETS) {
    const x = rates[a];
    if (x && Number.isFinite(x.chf) && x.chf > 0) r[a] = { chf: x.chf, asOf: x.asOf, provider: x.provider, stale: x.stale };
  }
  return { at: at.toISOString(), quantities, rates: r };
}

/** Value of one snapshot at ITS recorded prices. A held asset without a recorded rate is null (never guessed). */
export function valueSnapshot(s: Snapshot) {
  const assets = {} as Record<SnapAsset, { qty: number; value: number | null }>;
  let total: number | null = 0;
  for (const a of SNAP_ASSETS) {
    const qty = Number(s.quantities[a] ?? 0);
    const rate = s.rates[a]?.chf;
    const value = qty === 0 ? 0 : typeof rate === 'number' ? qty * rate : null;
    assets[a] = { qty, value };
    total = total === null || value === null ? null : total + value;
  }
  return { t: new Date(s.at).getTime(), at: s.at, total, assets };
}

export function shouldRecord(last: Snapshot | undefined, now: number, minGapMs: number) {
  return !last || now - new Date(last.at).getTime() >= minGapMs;
}

/** Downsampling: everything < 48 h, then one per hour (< 35 d), then one per day (< 400 d). Input sorted by time. */
export function compact(snaps: Snapshot[], now: number): Snapshot[] {
  const out: Snapshot[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    const t = new Date(s.at).getTime();
    const age = now - t;
    if (age > 400 * 864e5) continue;
    if (age <= 48 * 3600e3) {
      out.push(s);
      continue;
    }
    const bucket = age <= 35 * 864e5 ? `h${Math.floor(t / 3600e3)}` : `d${Math.floor(t / 864e5)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    out.push(s);
  }
  return out;
}

/** Series for a period, from recorded snapshots only, with an explicit "not enough data" state. */
export function seriesFor(snaps: Snapshot[], range: SnapRange, now: number) {
  const span = SNAP_RANGES[range];
  const from = now - span;
  const points = snaps.filter((s) => new Date(s.at).getTime() >= from).map(valueSnapshot);
  const recordingSince = snaps[0]?.at ?? null;
  const valued = points.filter((p) => p.total !== null);
  const covered = valued.length >= 2 ? valued[valued.length - 1].t - valued[0].t : 0;
  return {
    range,
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    recordingSince,
    points,
    enough: valued.length >= 2 && covered >= span * MIN_COVERAGE,
    /** true when recording started after the beginning of the period (part of the period has no data) */
    partial: !recordingSince || new Date(recordingSince).getTime() > from,
  };
}

// ─────────────── recording ───────────────

function append(clientId: string, s: Snapshot) {
  db.update((d) => {
    d.snapshots ??= {};
    const list = (d.snapshots[clientId] ??= []);
    list.push(s);
    d.snapshots[clientId] = compact(list, Date.now());
  });
}

export async function recordSnapshot(c: Client, bal?: { eth: bigint; usdc: bigint }) {
  if (!c.safeAddress) return null;
  const b = bal ?? (await balancesOf(c.safeAddress));
  const rates = await fetchWalletRates();
  const s = makeSnapshot(new Date(), { ETH: formatEther(b.eth), USDC: formatUnits(b.usdc, USDC_DECIMALS) }, rates);
  append(c.clientId, s);
  return s;
}

const inflight = new Set<string>();
/** Called when balances were just read anyway (GET /clients/:id/onchain): rate-limited, never blocks the caller. */
export function recordOpportunistic(c: Client, bal: { eth: bigint; usdc: bigint }) {
  const list = db.data.snapshots?.[c.clientId];
  if (inflight.has(c.clientId) || !shouldRecord(list?.[list.length - 1], Date.now(), OPPORTUNISTIC_MIN_GAP_MS)) return;
  inflight.add(c.clientId);
  void recordSnapshot(c, bal)
    .catch((e) => console.warn(`[snapshots] ${c.clientId}: ${String(e?.message ?? e)}`))
    .finally(() => inflight.delete(c.clientId));
}

let running = false;
async function recordAll() {
  if (running) return;
  running = true;
  try {
    for (const c of Object.values(db.data.clients)) {
      if (!c.safeAddress) continue;
      const list = db.data.snapshots?.[c.clientId];
      // a snapshot taken opportunistically a moment ago is enough
      if (!shouldRecord(list?.[list.length - 1], Date.now(), Math.min(SNAPSHOT_INTERVAL_MS, OPPORTUNISTIC_MIN_GAP_MS))) continue;
      await recordSnapshot(c).catch((e) => console.warn(`[snapshots] ${c.clientId}: ${String(e?.message ?? e)}`));
    }
  } finally {
    running = false;
  }
}

export function startSnapshotTimer() {
  setTimeout(() => void recordAll(), 10_000);
  setInterval(() => void recordAll(), SNAPSHOT_INTERVAL_MS);
}

type Route = (fn: (req: Request) => unknown) => any;
export function registerSnapshotRoutes(app: Express, route: Route) {
  app.get(
    '/clients/:id/snapshots',
    route((req) => {
      const c = getClient(String(req.params.id));
      const range = String(req.query.range ?? '7d') as SnapRange;
      const lang = parseLang(req.header('x-lang'));
      if (!(range in SNAP_RANGES)) throw new HttpError(400, pick(lang, 'Invalid range (24h, 7d, 1M, 1Y)', 'Période invalide (24h, 7d, 1M, 1Y)'));
      return {
        ...seriesFor(db.data.snapshots?.[c.clientId] ?? [], range, Date.now()),
        method: 'recorded-snapshots',
        intervalMinutes: Math.round(SNAPSHOT_INTERVAL_MS / 60_000),
        note: pick(
          lang,
          'Valuation of real recorded snapshots (on-chain balances × indicative price recorded at that time). Includes deposits and withdrawals: not a performance figure.',
          'Valorisation d’instantanés réellement enregistrés (soldes on-chain × cours indicatif enregistré à ce moment). Inclut dépôts et retraits : ce n’est pas une performance.',
        ),
      };
    }),
  );
}
