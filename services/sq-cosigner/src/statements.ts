// Documents: annual statement (help for the Swiss tax return — NOT an official tax certificate) and CSV export of
// the wallet's transactions. Method, sources and limits: docs/COMPLIANCE.md (section 17).
//
// Annual statement: quantities REALLY held at 31.12 23:59:59 Europe/Zurich, read from the chain state at the last
// block whose timestamp is ≤ that instant (binary search by timestamp; eth_getBalance / balanceOf with a historical
// blockTag on an archive-capable Sepolia RPC). Never derived from the current balance. If no RPC can serve the
// historical state, the balance is reconstructed from the wallet's transaction records and flagged incomplete.
// Valuation: official ESTV year-end rate when one is configured below (none verified yet) — otherwise the CoinGecko
// CHF daily price of 01.01 00:00 UTC (= 01:00 Zurich, one hour after the cut-off), flagged "estimated". Sepolia test
// tokens have no market value: any CHF figure is illustrative only.

import { Contract, JsonRpcProvider, Network, formatEther, formatUnits, getAddress } from 'ethers';
import type { Express, Request, RequestHandler, Response } from 'express';
import { CHAIN_ID, CHAIN_NAME, ERC20_ABI, RPC_URLS, SERVICE_URLS, USDC_ADDRESS, USDC_DECIMALS, decodeSafeTx, parseLang, pick } from '@sq/shared';
import { fetchWalletRates, reqLang } from '@sq/shared/server';
import { db, getClient, HttpError, type Client, type TxRequest } from './db';
import type { WalletTx } from './walletTx';

export const TZ = 'Europe/Zurich';
export type Asset = 'ETH' | 'USDC';
export const ASSETS: Asset[] = ['ETH', 'USDC'];
const CG_ID: Record<Asset, string> = { ETH: 'cg:ethereum', USDC: 'cg:usd-coin' };

/**
 * Official ESTV year-end tax values (Kursliste, https://www.ictax.admin.ch/extern/en.html#/ratelist) that we could
 * actually verify, per year and asset: { chf, source }. EMPTY on purpose: the ICTax rate list is a JavaScript
 * application we could not query reliably on 2026-10-10, so no value is claimed. Add a value only with its source.
 */
export const OFFICIAL_YEAR_END_RATES: Record<number, Partial<Record<Asset, { chf: number; source: string }>>> = {};

// ───────────────────────────── Time zone helpers (Europe/Zurich, DST-aware via Intl) ─────────────────────────────

/** Offset of Europe/Zurich from UTC at a given instant, in minutes (+60 in winter, +120 in summer). */
export function zurichOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Europe/Zurich wall-clock time → the UTC instant (for times that exist; DST gaps resolve forward). */
export function zurichToUtc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = zurichOffsetMinutes(new Date(guess));
  off = zurichOffsetMinutes(new Date(guess - off * 60_000));
  return new Date(guess - off * 60_000);
}

/** Cut-off of the annual statement: 31 December 23:59:59 Europe/Zurich of `year`, as a UTC instant. */
export const yearEndCutoff = (year: number) => zurichToUtc(year, 12, 31, 23, 59, 59);
/** First instant of the year in Zurich (CSV period start). */
export const yearStart = (year: number) => zurichToUtc(year, 1, 1, 0, 0, 0);

/** "2025-12-31 23:59:59 +01:00" — explicit local time with its offset. */
export function formatZurich(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const off = zurichOffsetMinutes(at);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ───────────────────────────── Block by timestamp ─────────────────────────────

/** Largest block number whose timestamp is ≤ target (seconds). null if even block `lo` is later. Pure binary search. */
export async function findBlockAtOrBefore(targetSec: number, latest: number, tsOf: (n: number) => Promise<number>, lo = 0): Promise<number | null> {
  if ((await tsOf(lo)) > targetSec) return lo === 0 ? null : findBlockAtOrBefore(targetSec, latest, tsOf, 0);
  let hi = latest;
  if ((await tsOf(hi)) <= targetSec) return hi;
  // invariant: ts(lo) ≤ target < ts(hi)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await tsOf(mid)) <= targetSec) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ───────────────────────────── Reconstruction from records (fallback) ─────────────────────────────

export interface Reconstruction {
  quantities: Record<Asset, string>; // decimal strings
  counted: number;
  /** Always true: the records do not capture every incoming transfer (see docs). */
  incomplete: true;
  pendingAtCutoff: number;
}

const DEC: Record<Asset, number> = { ETH: 18, USDC: USDC_DECIMALS };
const toUnits = (amount: string, a: Asset): bigint => {
  const [i, f = ''] = amount.split('.');
  if (!/^\d+$/.test(i || '0') || !/^\d*$/.test(f)) return 0n;
  return BigInt(i || '0') * 10n ** BigInt(DEC[a]) + BigInt((f + '0'.repeat(DEC[a])).slice(0, DEC[a]) || '0');
};
const fromUnits = (v: bigint, a: Asset) => (a === 'ETH' ? formatEther(v) : formatUnits(v, USDC_DECIMALS));

/** Balance at cut-off from the wallet's own records (confirmed, non-simulated). Flagged incomplete by construction. */
export function reconstructFromRecords(txs: WalletTx[], cutoff: Date): Reconstruction {
  const sum: Record<Asset, bigint> = { ETH: 0n, USDC: 0n };
  let counted = 0;
  let pendingAtCutoff = 0;
  for (const t of txs) {
    if (t.simulated) continue;
    const when = new Date(t.confirmedAt ?? t.createdAt).getTime();
    if (when > cutoff.getTime()) continue;
    if (t.status !== 'confirmed') {
      if (t.status !== 'failed') pendingAtCutoff++;
      continue;
    }
    const v = toUnits(t.amount, t.asset);
    if (t.kind === 'receive') sum[t.asset] += v;
    else if (t.kind === 'send') sum[t.asset] -= v;
    counted++;
  }
  return { quantities: { ETH: fromUnits(sum.ETH, 'ETH'), USDC: fromUnits(sum.USDC, 'USDC') }, counted, incomplete: true, pendingAtCutoff };
}

// ───────────────────────────── CSV ─────────────────────────────

export const CSV_COLUMNS = [
  'date_iso_utc',
  'date_local',
  'type',
  'network',
  'asset',
  'quantity',
  'direction',
  'fee_amount',
  'fee_currency',
  'from_address',
  'to_address',
  'tx_hash',
  'status',
  'chf_value',
  'chf_method',
] as const;
export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

/** RFC 4180 cell + spreadsheet formula-injection protection (leading = + - @ TAB CR are neutralised with '). */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export interface CsvSource {
  walletTxs: WalletTx[];
  /** Executed Safe transactions that are not transfers (approvals, other contract calls). */
  txRequests: TxRequest[];
  safeAddress?: string;
  deployTxHash?: string;
  deployedAt?: string | null;
}

/** All operations of the client in [from, to] (inclusive), oldest first. Valuation is filled in later. */
export function collectCsvRows(src: CsvSource, from: Date, to: Date): (CsvRow & { _asset: Asset | ''; _at: string })[] {
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from.getTime() && t <= to.getTime();
  };
  const rows: (CsvRow & { _asset: Asset | ''; _at: string })[] = [];
  const net = `${CHAIN_NAME} (chain id ${CHAIN_ID}, testnet)`;
  const hashes = new Set<string>();
  for (const t of src.walletTxs) {
    const at = t.confirmedAt ?? t.createdAt;
    if (!inRange(at)) continue;
    if (t.txHash) hashes.add(t.txHash.toLowerCase());
    rows.push({
      _asset: t.asset,
      _at: at,
      date_iso_utc: new Date(at).toISOString(),
      date_local: formatZurich(new Date(at)),
      type: t.kind,
      network: t.simulated ? 'none (demo simulation, not on-chain)' : net,
      asset: t.asset,
      quantity: /^\d+(\.\d+)?$/.test(t.amount) ? t.amount : '',
      direction: t.kind === 'receive' ? 'in' : t.kind === 'send' ? 'out' : 'n/a',
      fee_amount: t.simulated ? '0' : t.feesSponsored ? '0' : t.kind === 'receive' ? '0' : '',
      fee_currency: t.simulated ? 'none' : t.feesSponsored ? 'sponsored' : t.kind === 'receive' ? 'paid by sender' : 'unknown',
      from_address: t.from ?? '',
      to_address: t.to ?? '',
      tx_hash: t.txHash ?? '',
      status: t.simulated ? `${t.status} (simulated demo)` : t.status,
      chf_value: '',
      chf_method: '',
    });
  }
  for (const r of src.txRequests) {
    if (r.status !== 'executed' || !r.txHash || hashes.has(r.txHash.toLowerCase())) continue;
    if (!inRange(r.updatedAt)) continue;
    const d = decodeSafeTx(r.safeTx, r.safeAddress);
    rows.push({
      _asset: '',
      _at: r.updatedAt,
      date_iso_utc: new Date(r.updatedAt).toISOString(),
      date_local: formatZurich(new Date(r.updatedAt)),
      type: d.kind === 'erc20-approve' ? 'token-approval' : d.kind === 'swap-owner' ? 'key-rotation' : 'contract-interaction',
      network: net,
      asset: d.token ?? '',
      quantity: '',
      direction: 'n/a',
      fee_amount: '0',
      fee_currency: 'sponsored',
      from_address: r.safeAddress,
      to_address: getAddress(r.safeTx.to),
      tx_hash: r.txHash,
      status: 'confirmed',
      chf_value: '',
      chf_method: 'not applicable (no asset moved)',
    });
  }
  if (src.deployTxHash && src.deployedAt && inRange(src.deployedAt)) {
    rows.push({
      _asset: '',
      _at: src.deployedAt,
      date_iso_utc: new Date(src.deployedAt).toISOString(),
      date_local: formatZurich(new Date(src.deployedAt)),
      type: 'wallet-created',
      network: net,
      asset: '',
      quantity: '',
      direction: 'n/a',
      fee_amount: '0',
      fee_currency: 'sponsored',
      from_address: '',
      to_address: src.safeAddress ?? '',
      tx_hash: src.deployTxHash,
      status: 'confirmed',
      chf_value: '',
      chf_method: 'not applicable (no asset moved)',
    });
  }
  return rows.sort((a, b) => a._at.localeCompare(b._at));
}

// ───────────────────────────── Chain access (historical state) ─────────────────────────────

const network = Network.from(CHAIN_ID);
const archiveUrls = () => {
  const env = process.env.SEPOLIA_ARCHIVE_RPC_URLS ?? process.env.SEPOLIA_RPC_URLS;
  const list = env ? env.split(',') : ['https://sepolia.drpc.org', ...RPC_URLS]; // drpc served historical state on 2026-10-10; publicnode is pruned
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
};
const providers = new Map<string, JsonRpcProvider>();
const prov = (u: string) => {
  if (!providers.has(u)) providers.set(u, new JsonRpcProvider(u, network, { staticNetwork: network, batchMaxCount: 1 }));
  return providers.get(u)!;
};

/** Runs fn on each RPC in turn until one answers (historical queries fail on pruned nodes). */
async function onArchive<T>(fn: (p: JsonRpcProvider) => Promise<T>): Promise<{ value: T; rpc: string }> {
  let last: unknown;
  for (const u of archiveUrls()) {
    try {
      return { value: await fn(prov(u)), rpc: new URL(u).host };
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error('No RPC available');
}

const blockTsCache = new Map<number, number>();
async function blockTs(n: number): Promise<number> {
  if (blockTsCache.has(n)) return blockTsCache.get(n)!;
  const { value } = await onArchive(async (p) => {
    const b = await p.getBlock(n);
    if (!b) throw new Error(`block ${n} not found`);
    return b.timestamp;
  });
  if (blockTsCache.size > 5000) blockTsCache.clear();
  blockTsCache.set(n, value);
  return value;
}

const blockAtCache = new Map<number, number | null>();
/** Last block with timestamp ≤ the instant (cached for past instants: immutable). */
export async function blockAt(at: Date): Promise<{ number: number; timestamp: number } | null> {
  const target = Math.floor(at.getTime() / 1000);
  if (!blockAtCache.has(target)) {
    const { value: latest } = await onArchive((p) => p.getBlockNumber());
    // narrow the search with the ~12 s Sepolia slot time, then binary search (correct whatever the guess)
    const latestTs = await blockTs(latest);
    const guess = Math.max(0, latest - Math.ceil((latestTs - target) / 12) - 50_000);
    const n = await findBlockAtOrBefore(target, latest, blockTs, guess);
    if (target < Date.now() / 1000 - 600) blockAtCache.set(target, n);
    else return n === null ? null : { number: n, timestamp: await blockTs(n) };
  }
  const n = blockAtCache.get(target)!;
  return n === null ? null : { number: n, timestamp: await blockTs(n) };
}

const deployedAtCache = new Map<string, string | null>();
/** Creation time of the wallet = timestamp of its deployment transaction's block (null if unknown). */
export async function walletCreatedAt(c: Client): Promise<string | null> {
  if (!c.deployTxHash) return null;
  if (deployedAtCache.has(c.deployTxHash)) return deployedAtCache.get(c.deployTxHash)!;
  try {
    const { value } = await onArchive(async (p) => {
      const r = await p.getTransactionReceipt(c.deployTxHash!);
      if (!r) throw new Error('receipt not found');
      return new Date((await blockTs(r.blockNumber)) * 1000).toISOString();
    });
    deployedAtCache.set(c.deployTxHash, value);
    return value;
  } catch {
    return null;
  }
}

async function balancesAt(address: string, block: number) {
  return onArchive(async (p) => {
    const [eth, usdc] = await Promise.all([p.getBalance(address, block), new Contract(USDC_ADDRESS, ERC20_ABI, p).balanceOf(address, { blockTag: block }) as Promise<bigint>]);
    return { ETH: formatEther(eth), USDC: formatUnits(usdc, USDC_DECIMALS) } as Record<Asset, string>;
  });
}

// ───────────────────────────── Valuation ─────────────────────────────

const MARKET = () => process.env.MARKET_URL ?? SERVICE_URLS.market;

export interface Valuation {
  chf: number | null;
  kind: 'official' | 'estimated' | 'provisional-market' | 'missing';
  source: string;
  rateDate: string | null;
}

export async function priceOn(asset: Asset, isoDate: string): Promise<{ chf: number; method: string } | null> {
  try {
    const r = await fetch(`${MARKET()}/price-on/${CG_ID[asset]}?date=${isoDate}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { priceChf?: number; method?: string };
    return typeof j.priceChf === 'number' && j.priceChf > 0 ? { chf: j.priceChf, method: j.method ?? 'CoinGecko daily price' } : null;
  } catch {
    return null;
  }
}

async function yearEndValuation(asset: Asset, year: number, closed: boolean): Promise<Valuation> {
  const off = OFFICIAL_YEAR_END_RATES[year]?.[asset];
  if (off) return { chf: off.chf, kind: 'official', source: `ESTV Kursliste ${year} — ${off.source}`, rateDate: `${year}-12-31` };
  if (closed) {
    const d = `${year + 1}-01-01`;
    const p = await priceOn(asset, d);
    return p
      ? { chf: p.chf, kind: 'estimated', source: `CoinGecko CHF daily price, ${d} 00:00 UTC (01:00 Europe/Zurich) — estimated, not the official ESTV rate`, rateDate: `${d}T00:00:00Z` }
      : { chf: null, kind: 'missing', source: 'No official ESTV value configured and the market price could not be fetched', rateDate: null };
  }
  const r = (await fetchWalletRates())[asset];
  return r
    ? { chf: r.chf, kind: 'provisional-market', source: `${r.provider} indicative CHF market price${r.stale ? ' (stale)' : ''} — provisional, not a year-end tax rate`, rateDate: r.asOf }
    : { chf: null, kind: 'missing', source: 'Market price unavailable', rateDate: null };
}

// ───────────────────────────── Statement ─────────────────────────────

export interface StatementLine {
  asset: Asset;
  network: string;
  quantity: string | null;
  valuation: Valuation;
  valueChf: number | null;
}

export async function buildStatement(c: Client, year: number, now = new Date(), lang: 'en' | 'fr' = 'en') {
  const t = (en: string, fr: string) => pick(lang, en, fr);
  const cutoff = yearEndCutoff(year);
  const closed = now.getTime() > cutoff.getTime();
  const asOf = closed ? cutoff : now;
  const createdAt = await walletCreatedAt(c);
  const warnings: string[] = [];
  const base = {
    account: { clientId: c.clientId, name: c.name },
    year,
    closed,
    cutoff: { utc: cutoff.toISOString(), local: formatZurich(cutoff), timeZone: TZ },
    asOf: { utc: asOf.toISOString(), local: formatZurich(asOf) },
    generatedAt: now.toISOString(),
    walletsCovered: c.safeAddress ? [{ label: 'My Wall (Safe 2-of-3)', address: c.safeAddress, network: CHAIN_NAME }] : [],
    walletCreatedAt: createdAt,
    excluded: [
      t('Your Swissquote account and any other wallet (including external wallets you verified) are not covered.', 'Votre compte Swissquote et tout autre wallet (y compris les wallets externes vérifiés) ne sont pas couverts.'),
      t('Simulated demo receptions are not holdings and are excluded.', 'Les réceptions simulées (démo) ne sont pas des avoirs et sont exclues.'),
    ],
    testnetNotice: t('Ethereum Sepolia is a test network: these test tokens have no market value. CHF values use mainnet prices for illustration only.', 'Ethereum Sepolia est un réseau de test : ces jetons de test n’ont aucune valeur de marché. Les valeurs en CHF utilisent les prix du réseau principal, à titre d’illustration uniquement.'),
    disclaimer: t('Help for your tax return — not an official Swissquote tax certificate. Check the values with the official ESTV Kursliste (ICTax) and your cantonal tax authority.', 'Aide à la déclaration d’impôt — pas une attestation fiscale officielle de Swissquote. Vérifiez les valeurs avec la liste des cours officielle de l’AFC (ICTax) et votre administration fiscale cantonale.'),
  };
  const empty = (why: string) => ({ ...base, held: false, notHeldReason: why, block: null, method: 'none', lines: ASSETS.map((a) => ({ asset: a, network: CHAIN_NAME, quantity: '0', valuation: { chf: null, kind: 'missing', source: 'not applicable', rateDate: null }, valueChf: 0 })), totalChf: 0, totalComplete: true, warnings });
  if (!c.safeAddress) return empty(t('No wallet was opened for this account.', 'Aucun wallet n’a été ouvert pour ce compte.'));
  if (createdAt && new Date(createdAt).getTime() > asOf.getTime()) return empty(t(`Wallet created on ${formatZurich(new Date(createdAt))}: it was not held at that date (quantities are a real zero).`, `Wallet créé le ${formatZurich(new Date(createdAt))} : il n’était pas détenu à cette date (quantités réellement nulles).`));
  if (!createdAt) warnings.push(t('The wallet creation date could not be read from the chain.', 'La date de création du wallet n’a pas pu être lue sur la blockchain.'));

  let quantities: Record<Asset, string> | null = null;
  let method = '';
  let block: { number: number; timestamp: number; rpc?: string } | null = null;
  try {
    const b = await blockAt(asOf);
    if (!b) throw new Error('no block before the cut-off');
    const r = await balancesAt(c.safeAddress, b.number);
    quantities = r.value;
    block = { ...b, rpc: r.rpc };
    method = t(`On-chain state at block ${b.number} (${new Date(b.timestamp * 1000).toISOString()}, last block ≤ cut-off), read via ${r.rpc}`, `État de la blockchain au bloc ${b.number} (${new Date(b.timestamp * 1000).toISOString()}, dernier bloc ≤ date de coupure), lu via ${r.rpc}`);
  } catch {
    const rec = reconstructFromRecords(
      Object.values(db.data.walletTxs ?? {}).filter((t) => t.clientId === c.clientId),
      asOf,
    );
    quantities = rec.quantities;
    method = t(`Reconstructed from the wallet's transaction records (${rec.counted} confirmed operations) — historical chain state unavailable`, `Reconstitué à partir des transactions enregistrées du wallet (${rec.counted} opérations confirmées) — état historique de la blockchain indisponible`);
    warnings.push(t('INCOMPLETE: no RPC could serve the historical chain state; the balance was rebuilt from My Wall records, which do not capture every incoming transfer (e.g. sent directly from another wallet). Verify on the block explorer.', 'INCOMPLET : aucun nœud RPC n’a pu fournir l’état historique ; le solde a été reconstitué à partir des enregistrements My Wall, qui ne couvrent pas toutes les réceptions (p. ex. envoyées directement depuis un autre wallet). Vérifiez sur l’explorateur de blocs.'));
    if (rec.pendingAtCutoff) warnings.push(t(`${rec.pendingAtCutoff} operation(s) were still pending at the cut-off and are not counted.`, `${rec.pendingAtCutoff} opération(s) encore en attente à la date de coupure, non comptée(s).`));
  }

  const lines: StatementLine[] = [];
  for (const a of ASSETS) {
    const valuation = await yearEndValuation(a, year, closed);
    const q = quantities![a];
    lines.push({ asset: a, network: CHAIN_NAME, quantity: q, valuation, valueChf: valuation.chf === null ? null : Math.round(Number(q) * valuation.chf * 100) / 100 });
  }
  const totalComplete = lines.every((l) => l.valueChf !== null);
  const totalChf = Math.round(lines.reduce((n, l) => n + (l.valueChf ?? 0), 0) * 100) / 100;
  if (!totalComplete) warnings.push(t('Some values are missing: the total only includes the assets that could be valued.', 'Certaines valeurs manquent : le total ne comprend que les actifs valorisés.'));
  if (lines.some((l) => l.valuation.kind === 'estimated')) warnings.push(t('Estimated valuation: no official ESTV year-end rate is configured for these assets; a CoinGecko CHF price is used instead.', 'Valorisation estimée : aucun cours officiel de fin d’année de l’AFC n’est configuré pour ces actifs ; un prix CHF CoinGecko est utilisé à la place.'));
  if (!closed) warnings.push(t(`Year ${year} is not closed yet: provisional statement as of ${formatZurich(asOf)}.`, `L’année ${year} n’est pas encore close : relevé provisoire au ${formatZurich(asOf)}.`));
  return { ...base, held: true, notHeldReason: null, block, method, lines, totalChf, totalComplete, warnings };
}

// ───────────────────────────── CSV export with valuation ─────────────────────────────

export async function buildCsv(c: Client, from: Date, to: Date) {
  const deployedAt = await walletCreatedAt(c);
  const rows = collectCsvRows(
    {
      walletTxs: Object.values(db.data.walletTxs ?? {}).filter((t) => t.clientId === c.clientId),
      txRequests: Object.values(db.data.txRequests).filter((r) => r.clientId === c.clientId),
      safeAddress: c.safeAddress,
      deployTxHash: c.deployTxHash,
      deployedAt,
    },
    from,
    to,
  );
  const memo = new Map<string, Promise<{ chf: number; method: string } | null>>();
  let lookups = 0;
  for (const r of rows) {
    if (!r._asset || !r.quantity) {
      if (!r.chf_method) r.chf_method = r.quantity ? '' : 'unavailable (amount unknown)';
      continue;
    }
    const day = r.date_iso_utc.slice(0, 10);
    const key = `${r._asset}:${day}`;
    if (!memo.has(key)) {
      if (lookups >= 120) memo.set(key, Promise.resolve(null));
      else {
        lookups++;
        memo.set(key, priceOn(r._asset, day));
      }
    }
    const p = await memo.get(key)!;
    if (p) {
      r.chf_value = (Number(r.quantity) * p.chf).toFixed(2);
      r.chf_method = `estimate: CoinGecko CHF daily price ${day} 00:00 UTC; testnet asset, no real market value`;
    } else r.chf_method = 'unavailable (no market price)';
  }
  const clean: CsvRow[] = rows.map(({ _asset, _at, ...r }) => r);
  return { rows: clean, csv: toCsv(clean) };
}

// ───────────────────────────── Routes ─────────────────────────────

type Route = (fn: (req: Request, res: Response) => unknown) => RequestHandler;

const parseYear = (v: unknown) => {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2015 || y > new Date().getUTCFullYear()) throw new HttpError(400, pick(reqLang(), 'Invalid year', 'Année invalide'));
  return y;
};

export function registerStatementRoutes(app: Express, route: Route) {
  app.get(
    '/clients/:id/statements/years',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const created = await walletCreatedAt(c);
      const now = new Date();
      const nowYear = Number(formatZurich(now).slice(0, 4));
      const firstYear = created ? Number(formatZurich(new Date(created)).slice(0, 4)) : nowYear;
      const years = [];
      for (let y = nowYear; y >= firstYear; y--) years.push({ year: y, closed: now.getTime() > yearEndCutoff(y).getTime(), cutoff: yearEndCutoff(y).toISOString() });
      return { walletCreatedAt: created, years };
    }),
  );

  app.get(
    '/clients/:id/statements/:year',
    route(async (req) => buildStatement(getClient(String(req.params.id)), parseYear(req.params.year), new Date(), parseLang(req.header('x-lang')))),
  );

  /** CSV of every operation of the year (Europe/Zurich calendar year). JSON wrapper by default (auth-friendly). */
  app.get(
    '/clients/:id/exports/transactions/:year',
    route(async (req, res) => {
      const c = getClient(String(req.params.id));
      const year = parseYear(req.params.year);
      const lang = parseLang(req.header('x-lang'));
      const { rows, csv } = await buildCsv(c, yearStart(year), new Date(yearEndCutoff(year).getTime() + 999));
      const filename = `mywall-transactions-${c.clientId}-${year}.csv`;
      if (req.query.format === 'csv') {
        res.setHeader('content-type', 'text/csv; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('cache-control', 'no-store');
        res.send(csv);
        return;
      }
      res.setHeader('cache-control', 'no-store');
      return { filename, mime: 'text/csv;charset=utf-8', count: rows.length, csv, note: pick(lang, 'Generated from My Wall records; see docs for coverage limits.', 'Généré à partir des enregistrements My Wall ; voir la documentation pour les limites.') };
    }),
  );
}
