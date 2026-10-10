// On-chain indexer (#3, #19): every INDEXER_POLL_MS (15 s) it reads, for every known Safe,
//   • ERC-20 / ERC-721 `Transfer(address,address,uint256)` logs with `to` = Safe, for ALL token contracts
//     (topic filter on `to`, no address filter) → receipts of whitelisted tokens become history rows; anything else
//     is an "unrecognised token" sighting (never valued, never interacted with);
//   • `Transfer` logs with `from` = Safe and value 0 → address-poisoning attempts (a third party can emit those
//     without any signature; the Safe never sends 0 itself);
//   • `SafeReceived(address indexed sender, uint256 value)` emitted by the Safe v1.4.1 receive() → incoming ETH
//     (event checked against the official safe_l2.json 1.4.1 ABI from @safe-global/safe-deployments).
// Per-Safe block cursor (persisted in db.json), confirmation depth INDEXER_CONFIRMATIONS (default CONFIRMATIONS),
// idempotency key `txHash:logIndex`, reconciliation with rows created by the app's own flows (same txHash), small
// getLogs ranges (public RPC limits) and exponential backoff on RPC errors.
//
// Extension hook (CHAIN package): registerIndexerEvent({ id, topics, addresses, handle }) adds an event to the same
// polling loop, with the same cursor, idempotency and confirmation depth — e.g. Zodiac Delay `TransactionAdded`
// on each Safe's D1/D2 module. See docs at registerIndexerEvent below.

import { AbiCoder, Contract, formatEther, formatUnits, getAddress, id as keccakId, zeroPadValue, type Log } from 'ethers';
import { KNOWN_TOKENS, RPC_URLS, biField, both, inertTokenLabel, isLookalike, makeProvider, short } from '@sq/shared';
import { internalHeaders, nowIso } from '@sq/shared/server';
import { db, logActivity, notify, type Client } from './db';
import { CONFIRMATIONS, provider, relayerAddress } from './chain';
import { confirmWalletTx, upsertWalletTx, type WalletTx } from './walletTx';
import { fetchOwnWallets } from './travelRule';

export const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
export const SAFE_RECEIVED_TOPIC = keccakId('SafeReceived(address,uint256)');

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 15_000);
export const INDEXER_CONFIRMATIONS = Math.max(1, Number(process.env.INDEXER_CONFIRMATIONS ?? CONFIRMATIONS));
/** Max blocks per eth_getLogs. Public RPCs cap queries WITHOUT an address filter (needed to catch every token):
 *  publicnode refuses them, drpc's free tier accepts ~100 blocks, Tenderly's public gateway more. */
const MAX_RANGE = Number(process.env.INDEXER_MAX_RANGE ?? 100);
/** Chunks per Safe group and poll while catching up (bounded work per tick). */
const MAX_CHUNKS = Number(process.env.INDEXER_MAX_CHUNKS ?? 8);
/** Logs further than this behind the head are "backfilled": history row + receipt, but no notification. */
const LIVE_WINDOW_BLOCKS = 300; // ≈ 1 h on Sepolia
/** Safes per topic OR-list. */
const SAFES_PER_QUERY = 40;
/** Dust: incoming amounts below these are flagged (common bait for address poisoning). */
const DUST = { USDC: 10_000n /* 0.01 USDC */, ETH: 10_000_000_000_000n /* 0.00001 ETH */ };

// ───────────────────────────── Types ─────────────────────────────

export interface IndexerState {
  /** Last block fully processed AND confirmed, per Safe (lower-case address). */
  cursors: Record<string, number>;
  /** Idempotency: `txHash:logIndex` (lower-case hash) → wallet-tx id, or a marker ('token:<addr>', 'ignored', 'hook:<id>'). */
  seen: Record<string, string>;
  /** Receipts seen in blocks not yet deep enough. */
  pending: Record<string, { safe: string; blockNumber: number; walletTxId?: string }>;
  initializedAt?: string;
  lastPollAt?: string;
  lastHead?: number;
  lastError?: string;
}

export interface TokenSighting {
  token: string; // checksummed contract address
  standard: 'erc20' | 'erc721';
  label?: string; // inert, truncated symbol as claimed by the contract (untrusted)
  decimals?: number;
  firstSeen: string;
  lastSeen: string;
  hidden?: boolean; // "Ignore" in the UI — signs nothing
  transfers: { key: string; txHash: string; direction: 'in' | 'out'; from: string; to: string; valueRaw: string; blockNumber: number; lookalikeOf?: { name?: string; address: string } }[];
}

/** A log normalised by parseIndexerLog. */
export interface ChainEvent {
  key: string; // txHash:logIndex
  safe: string; // checksummed
  txHash: string;
  logIndex: number;
  blockNumber: number;
  kind: 'token-in' | 'nft-in' | 'eth-in' | 'zero-out';
  token?: string; // checksummed contract (token-in / nft-in / zero-out)
  from: string;
  to: string;
  valueRaw: string; // amount (ERC-20 / ETH) or tokenId (ERC-721)
}

type RawLog = Pick<Log, 'address' | 'topics' | 'data' | 'transactionHash' | 'blockNumber'> & { index?: number; logIndex?: number };

const coder = AbiCoder.defaultAbiCoder();
const topicAddr = (t: string) => getAddress(`0x${t.slice(26)}`);
export const keyOf = (txHash: string, logIndex: number) => `${txHash.toLowerCase()}:${logIndex}`;

/**
 * Pure: turns a raw log into a ChainEvent for one of `safes` (lower-case set), or null if irrelevant.
 * ERC-20 Transfer = 3 topics + 32-byte data; ERC-721 Transfer = 4 topics (tokenId indexed).
 */
export function parseIndexerLog(log: RawLog, safes: Set<string>): ChainEvent | null {
  const logIndex = log.index ?? log.logIndex;
  if (logIndex === undefined || !log.transactionHash || log.blockNumber == null) return null;
  const base = { txHash: log.transactionHash.toLowerCase(), logIndex, blockNumber: Number(log.blockNumber), key: keyOf(log.transactionHash, logIndex) };
  const t0 = log.topics[0]?.toLowerCase();
  try {
    if (t0 === SAFE_RECEIVED_TOPIC && log.topics.length === 2) {
      const safe = getAddress(log.address);
      if (!safes.has(safe.toLowerCase())) return null;
      const [value] = coder.decode(['uint256'], log.data);
      return { ...base, kind: 'eth-in', safe, from: topicAddr(log.topics[1]), to: safe, valueRaw: (value as bigint).toString() };
    }
    if (t0 === TRANSFER_TOPIC && (log.topics.length === 3 || log.topics.length === 4)) {
      const from = topicAddr(log.topics[1]);
      const to = topicAddr(log.topics[2]);
      const token = getAddress(log.address);
      const nft = log.topics.length === 4;
      const valueRaw = nft ? BigInt(log.topics[3]).toString() : (coder.decode(['uint256'], log.data)[0] as bigint).toString();
      if (safes.has(to.toLowerCase())) return { ...base, kind: nft ? 'nft-in' : 'token-in', safe: to, token, from, to, valueRaw };
      if (safes.has(from.toLowerCase()) && !nft && valueRaw === '0') return { ...base, kind: 'zero-out', safe: from, token, from, to, valueRaw };
    }
  } catch {
    return null; // malformed log (non-standard token): ignored
  }
  return null;
}

// ───────────────────────────── Extension hook (CHAIN package) ─────────────────────────────

export interface IndexerEventRegistration {
  /** Unique id, used in the idempotency key (`hook:<id>`). */
  id: string;
  /** eth_getLogs topics filter, e.g. [keccakId('TransactionAdded(uint256,bytes32,address,uint256,bytes,uint8)')]. */
  topics: (string | string[] | null)[];
  /** Contract addresses to watch for these Safes (e.g. the Safe's Delay modules). Empty → skipped. */
  addresses: (safes: { safe: string; clientId: string }[]) => string[];
  /** Called once per CONFIRMED log (idempotent: never twice for the same txHash:logIndex). */
  handle: (log: Log, ctx: { backfilled: boolean }) => void | Promise<void>;
}
const hooks: IndexerEventRegistration[] = [];
/**
 * Registers an extra on-chain event in the indexer loop (same per-Safe cursor, confirmation depth, small ranges,
 * backoff and txHash:logIndex idempotency). Call it once at start-up, before or after startIndexer().
 */
export function registerIndexerEvent(reg: IndexerEventRegistration) {
  if (hooks.some((h) => h.id === reg.id)) throw new Error(`indexer hook ${reg.id} already registered`);
  hooks.push(reg);
}

// ───────────────────────────── Naming & classification ─────────────────────────────

export interface KnownParty {
  address: string;
  name?: string;
  nameFr?: string;
  /** contact | own (verified wallet) | swissquote (treasury / relayer) | history (past recipient, name unknown) */
  source: 'contact' | 'own' | 'swissquote' | 'history';
}

/** Parties the client knows, with a name only when it is really known (never invented). */
export function knownPartiesOf(c: Client, ownWallets: { address: string; label?: string; kind?: string }[] | null, txs: WalletTx[]): KnownParty[] {
  const out: KnownParty[] = [];
  for (const k of c.contacts ?? []) out.push({ address: getAddress(k.address.toLowerCase()), name: k.name, source: 'contact' });
  for (const w of ownWallets ?? []) {
    if (w.kind === 'swissquote-account') out.push({ address: w.address, name: 'Your Swissquote account', nameFr: 'Votre compte Swissquote', source: 'swissquote' });
    else out.push({ address: w.address, name: w.label ? `My wallet — ${w.label}` : 'My verified wallet', nameFr: w.label ? `Mon wallet — ${w.label}` : 'Mon wallet vérifié', source: 'own' });
  }
  out.push({ address: getAddress(relayerAddress), name: 'Swissquote (network fees)', nameFr: 'Swissquote (frais de réseau)', source: 'swissquote' });
  for (const t of txs) if (t.kind === 'send' && !t.flags?.length && /^0x[0-9a-fA-F]{40}$/.test(t.to)) out.push({ address: getAddress(t.to.toLowerCase()), name: t.counterpartyName, nameFr: t.counterpartyNameFr, source: 'history' });
  return out;
}

export function nameFor(address: string, parties: KnownParty[]): KnownParty | undefined {
  return parties.find((p) => p.address.toLowerCase() === address.toLowerCase() && p.name);
}

/** #19 — look-alike of a known party (same first 4 AND last 4 hex characters, different address). */
export function lookalikeFor(address: string, parties: KnownParty[]): KnownParty | undefined {
  if (parties.some((p) => p.address.toLowerCase() === address.toLowerCase())) return undefined;
  return parties.find((p) => isLookalike(address, p.address));
}

// ───────────────────────────── Applying events ─────────────────────────────

interface ApplyCtx {
  clientId: string;
  confirmed: boolean;
  backfilled: boolean;
  parties: KnownParty[];
}

const state = (): IndexerState => (db.data.indexer ??= { cursors: {}, seen: {}, pending: {} });

/** Idempotent: a key already applied as confirmed is a no-op. Returns what happened (for tests / logs). */
export function applyEvent(ev: ChainEvent, ctx: ApplyCtx): 'duplicate' | 'reconciled' | 'pending' | 'recorded' | 'token-sighting' | 'ignored' {
  const st = state();
  if (st.seen[ev.key] && !st.pending[ev.key]) return 'duplicate';

  // Unrecognised token (any contract not in the whitelist) or NFT → sighting only, never a valued history row.
  const known = ev.token ? KNOWN_TOKENS[ev.token.toLowerCase()] : undefined;
  if (ev.kind === 'nft-in' || ((ev.kind === 'token-in' || ev.kind === 'zero-out') && !known)) {
    if (!ctx.confirmed) return 'pending';
    recordSighting(ev, ctx);
    db.update((d) => {
      d.indexer!.seen[ev.key] = `token:${ev.token!.toLowerCase()}`;
    });
    return 'token-sighting';
  }

  const asset: WalletTx['asset'] = ev.kind === 'eth-in' ? 'ETH' : 'USDC';
  const amount = asset === 'ETH' ? formatEther(ev.valueRaw) : formatUnits(ev.valueRaw, known!.decimals);
  const counterparty = ev.kind === 'zero-out' ? ev.to : ev.from;

  // Reconciliation with a row created by the app's own flow (e.g. account → wallet transfer tracked by txHash).
  const existing = Object.values(db.data.walletTxs ?? {}).find(
    (t) => t.clientId === ctx.clientId && t.txHash?.toLowerCase() === ev.txHash && t.kind === (ev.kind === 'zero-out' ? 'send' : 'receive') && t.logIndex === undefined && t.asset === asset,
  );
  if (existing && !st.seen[ev.key]) {
    db.update((d) => {
      d.indexer!.seen[ev.key] = existing.id;
      delete d.indexer!.pending[ev.key];
    });
    return 'reconciled';
  }

  const flags: NonNullable<WalletTx['flags']> = [];
  const look = lookalikeFor(counterparty, ctx.parties);
  if (look) flags.push('lookalike');
  const raw = BigInt(ev.valueRaw);
  if (raw === 0n) flags.push('zero-value');
  else if (raw < DUST[asset] && !nameFor(counterparty, ctx.parties)) flags.push('dust');
  const named = look ? undefined : nameFor(counterparty, ctx.parties);
  // Several receipts of the same asset in one transaction: distinct receipts (docId suffix by log index).
  const sameTx = Object.values(db.data.walletTxs ?? {}).some((t) => t.clientId === ctx.clientId && t.txHash?.toLowerCase() === ev.txHash && t.kind === 'receive' && t.logIndex !== ev.logIndex);
  const rowId = st.seen[ev.key] && st.seen[ev.key] !== 'pending' ? st.seen[ev.key] : `chain-${ev.txHash.slice(2)}-${ev.logIndex}`;

  const row = upsertWalletTx({
    id: rowId,
    clientId: ctx.clientId,
    kind: ev.kind === 'zero-out' ? 'send' : 'receive',
    status: 'pending',
    asset,
    amount,
    from: ev.from,
    to: ev.to,
    txHash: ev.txHash,
    logIndex: ev.logIndex,
    docSuffix: sameTx ? `:${ev.logIndex}` : undefined,
    source: named?.source === 'swissquote' && named.name === 'Your Swissquote account' ? 'swissquote-account' : 'external',
    counterpartyName: named?.name,
    counterpartyNameFr: named?.nameFr,
    feesSponsored: false,
    backfilled: ctx.backfilled || undefined,
    flags: flags.length ? flags : undefined,
    lookalikeOf: look ? { name: look.name, address: look.address } : undefined,
    ...(ev.kind === 'zero-out'
      ? { note: 'Not sent by you: a third party triggered this zero-value transfer (address poisoning).', noteFr: 'Pas envoyé par vous : un tiers a déclenché ce transfert de valeur nulle (empoisonnement d’adresse).' }
      : {}),
  });

  if (!ctx.confirmed) {
    db.update((d) => {
      d.indexer!.seen[ev.key] = row.id;
      d.indexer!.pending[ev.key] = { safe: ev.safe.toLowerCase(), blockNumber: ev.blockNumber, walletTxId: row.id };
    });
    return 'pending';
  }

  confirmWalletTx(row.id);
  db.update((d) => {
    d.indexer!.seen[ev.key] = row.id;
    delete d.indexer!.pending[ev.key];
  });
  notifyReceipt(row, ctx, look);
  return 'recorded';
}

function notifyReceipt(t: WalletTx, ctx: ApplyCtx, look?: KnownParty) {
  if (look) {
    const who = look.name ?? short(look.address);
    logActivity({ clientId: ctx.clientId, actor: 'system', type: 'indexer.lookalike', message: both(
        `Look-alike address — possible scam: ${short(t.kind === 'send' ? t.to : t.from)} imitates ${who}. Never copy an address from your history.`,
        `Adresse sosie — arnaque possible : ${short(t.kind === 'send' ? t.to : t.from)} imite ${who}. Ne copiez jamais une adresse depuis l’historique.`,
      ), txHash: t.txHash, data: { walletTxId: t.id } });
    if (!ctx.backfilled)
      notify({ clientId: ctx.clientId, channel: 'app', subject: both('Look-alike address — possible scam', 'Adresse sosie — arnaque possible'), body: both(
          `An address that looks like ${who} appeared in your history. Do not send anything to it; always pick recipients from your contacts.`,
          `Une adresse qui ressemble à ${who} est apparue dans votre historique. N’y envoyez rien ; choisissez toujours vos destinataires dans vos contacts.`,
        ) });
    return;
  }
  if (ctx.backfilled || t.kind !== 'receive' || t.flags?.includes('zero-value')) return;
  const fromEn = t.counterpartyName ? ` from ${t.counterpartyName}` : ` from ${short(t.from)}`;
  const fromFr = t.counterpartyName ? ` depuis ${t.counterpartyNameFr ?? t.counterpartyName}` : ` depuis ${short(t.from)}`;
  notify({ clientId: ctx.clientId, channel: 'app', subject: both('Receipt confirmed', 'Réception confirmée'), body: both(`${t.amount} ${t.asset} received${fromEn}.`, `${t.amount} ${t.asset} reçus${fromFr}.`) });
}

function recordSighting(ev: ChainEvent, ctx: ApplyCtx) {
  const token = ev.token!;
  const counterparty = ev.kind === 'zero-out' ? ev.to : ev.from;
  const look = lookalikeFor(counterparty, ctx.parties);
  let isNew = false;
  db.update((d) => {
    const byClient = ((d.tokenSightings ??= {})[ctx.clientId] ??= {});
    const s = (byClient[token.toLowerCase()] ??= ((isNew = true), { token, standard: ev.kind === 'nft-in' ? 'erc721' : 'erc20', firstSeen: nowIso(), lastSeen: nowIso(), transfers: [] }));
    s.lastSeen = nowIso();
    if (!s.transfers.some((x) => x.key === ev.key)) {
      s.transfers.unshift({ key: ev.key, txHash: ev.txHash, direction: ev.kind === 'zero-out' ? 'out' : 'in', from: ev.from, to: ev.to, valueRaw: ev.valueRaw, blockNumber: ev.blockNumber, ...(look ? { lookalikeOf: { name: look.name, address: look.address } } : {}) });
      s.transfers.splice(20);
    }
  });
  if (isNew) {
    void fetchTokenLabel(ctx.clientId, token);
    logActivity({ clientId: ctx.clientId, actor: 'system', type: 'indexer.unrecognised-token', message: both(
        `Unrecognised token ${short(token)} received — hidden, not valued. Do not interact: unknown tokens are often scams.`,
        `Jeton non reconnu ${short(token)} reçu — masqué, non valorisé. N’interagissez pas : les jetons inconnus sont souvent des arnaques.`,
      ), txHash: ev.txHash });
  }
}

async function fetchTokenLabel(clientId: string, token: string) {
  const c = new Contract(token, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], provider);
  const [sym, dec] = await Promise.all([c.symbol().catch(() => undefined), c.decimals().catch(() => undefined)]);
  db.update((d) => {
    const s = d.tokenSightings?.[clientId]?.[token.toLowerCase()];
    if (!s) return;
    if (sym !== undefined) s.label = inertTokenLabel(sym);
    if (dec !== undefined && Number(dec) <= 36) s.decimals = Number(dec);
  });
}

// ───────────────────────────── Polling ─────────────────────────────

let backoffMs = 0;
let backoffUntil = 0;
let running = false;
const deployBlockCache = new Map<string, number>();

function knownSafes(): { safe: string; clientId: string; deployTxHash?: string }[] {
  return Object.values(db.data.clients)
    .filter((c) => c.safeAddress)
    .map((c) => ({ safe: c.safeAddress!.toLowerCase(), clientId: c.clientId, deployTxHash: c.deployTxHash }));
}

async function initialCursor(s: { safe: string; deployTxHash?: string }, head: number): Promise<number> {
  if (deployBlockCache.has(s.safe)) return deployBlockCache.get(s.safe)!;
  let block = head;
  if (s.deployTxHash) {
    const rc = await provider.getTransactionReceipt(s.deployTxHash).catch(() => null);
    if (rc?.blockNumber) block = rc.blockNumber - 1;
  }
  deployBlockCache.set(s.safe, block);
  return block;
}

/** getLogs endpoints, tried in order (an RPC error from one → next one). INDEXER_RPC_URLS overrides. */
const LOG_RPCS = (process.env.INDEXER_RPC_URLS ? process.env.INDEXER_RPC_URLS.split(',') : ['https://sepolia.gateway.tenderly.co', ...[...RPC_URLS].reverse()]).map((u) => u.trim()).filter(Boolean);
const logProviders = LOG_RPCS.map((u) => makeProvider([u]));

/** eth_getLogs with sequential fallback over several public RPCs (FallbackProvider would return the first error). */
export async function indexerGetLogs(filter: { address?: string | string[]; topics: (string | string[] | null)[]; fromBlock: number; toBlock: number }): Promise<Log[]> {
  let last: unknown;
  for (const p of logProviders) {
    try {
      return await p.getLogs(filter);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const getLogsSafe = indexerGetLogs;

/** One indexer pass over every known Safe. Exported for tests / scripts. */
export async function pollOnce(): Promise<{ head: number; processed: number }> {
  const head = await provider.getBlockNumber();
  const depth = INDEXER_CONFIRMATIONS;
  const confirmedHead = head - depth + 1;
  const safes = knownSafes();
  const st = state();

  // First run ever: Safes that already exist start at the current head (no silent history rewrite);
  // Safes created afterwards start at their deployment block (their full history is indexed).
  if (!st.initializedAt) {
    db.update((d) => {
      const s = (d.indexer ??= { cursors: {}, seen: {}, pending: {} });
      for (const x of safes) s.cursors[x.safe] ??= confirmedHead;
      s.initializedAt = nowIso();
    });
  }
  for (const x of safes) {
    if (st.cursors[x.safe] === undefined) {
      const c = await initialCursor(x, confirmedHead);
      db.update((d) => (d.indexer!.cursors[x.safe] ??= c));
    }
  }

  // Group Safes by cursor so that a single getLogs covers many Safes (topic OR-list).
  const groups = new Map<number, typeof safes>();
  for (const x of safes) {
    const c = state().cursors[x.safe];
    if (c >= head) continue;
    const g = groups.get(c) ?? [];
    g.push(x);
    groups.set(c, g);
  }

  let processed = 0;
  const partiesCache = new Map<string, KnownParty[]>();
  const partiesOf = async (clientId: string) => {
    if (!partiesCache.has(clientId)) {
      const c = db.data.clients[clientId];
      const own = await fetchOwnWallets(clientId, c.safeAddress, internalHeaders());
      partiesCache.set(clientId, knownPartiesOf(c, own, Object.values(db.data.walletTxs ?? {}).filter((t) => t.clientId === clientId)));
    }
    return partiesCache.get(clientId)!;
  };

  for (const [cursor, all] of groups) {
    for (let i = 0; i < all.length; i += SAFES_PER_QUERY) {
      const group = all.slice(i, i + SAFES_PER_QUERY);
      const set = new Set(group.map((g) => g.safe));
      const clientOf = new Map(group.map((g) => [g.safe, g.clientId]));
      const padded = group.map((g) => zeroPadValue(g.safe, 32));
      let from = cursor + 1;
      for (let chunk = 0; chunk < MAX_CHUNKS && from <= head; chunk++) {
        const to = Math.min(from + MAX_RANGE - 1, head);
        const [inLogs, outLogs, ethLogs] = await Promise.all([
          getLogsSafe({ topics: [TRANSFER_TOPIC, null, padded], fromBlock: from, toBlock: to }),
          getLogsSafe({ topics: [TRANSFER_TOPIC, padded], fromBlock: from, toBlock: to }),
          getLogsSafe({ address: group.map((g) => getAddress(g.safe)), topics: [SAFE_RECEIVED_TOPIC], fromBlock: from, toBlock: to }),
        ]);
        const events = [...inLogs, ...outLogs, ...ethLogs]
          .map((l) => parseIndexerLog(l, set))
          .filter((e): e is ChainEvent => !!e)
          .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
        const confirmedKeys = new Set<string>();
        for (const ev of events) {
          const clientId = clientOf.get(ev.safe.toLowerCase())!;
          const confirmed = ev.blockNumber <= confirmedHead;
          const r = applyEvent(ev, { clientId, confirmed, backfilled: head - ev.blockNumber > LIVE_WINDOW_BLOCKS, parties: await partiesOf(clientId) });
          if (confirmed) confirmedKeys.add(ev.key);
          if (r !== 'duplicate') processed++;
        }
        // Extension hooks (CHAIN package): confirmed logs only, once per key.
        for (const h of hooks) {
          const addresses = h.addresses(group.map((g) => ({ safe: getAddress(g.safe), clientId: g.clientId })));
          if (!addresses.length) continue;
          const logs = await getLogsSafe({ address: addresses, topics: h.topics, fromBlock: from, toBlock: Math.min(to, confirmedHead) });
          for (const l of logs) {
            const k = `hook:${h.id}:${keyOf(l.transactionHash, l.index)}`;
            if (state().seen[k]) continue;
            await h.handle(l, { backfilled: head - l.blockNumber > LIVE_WINDOW_BLOCKS });
            db.update((d) => (d.indexer!.seen[k] = 'hook'));
          }
        }
        const newCursor = Math.min(to, confirmedHead);
        db.update((d) => {
          for (const g of group) if ((d.indexer!.cursors[g.safe] ?? -1) < newCursor) d.indexer!.cursors[g.safe] = newCursor;
          // Reorg: a receipt seen as pending in a block now confirmed-scanned, but no longer there → failed.
          for (const [k, p] of Object.entries(d.indexer!.pending)) {
            if (!set.has(p.safe) || p.blockNumber > newCursor || p.blockNumber < from || confirmedKeys.has(k)) continue;
            delete d.indexer!.pending[k];
            const w = p.walletTxId ? d.walletTxs?.[p.walletTxId] : undefined;
            if (w && w.status !== 'confirmed') Object.assign(w, { status: 'failed', error: 'Dropped by a chain reorganisation', updatedAt: nowIso() });
          }
        });
        if (newCursor < to) break; // the remaining blocks are not deep enough yet
        from = to + 1;
      }
    }
  }
  db.update((d) => Object.assign(d.indexer!, { lastPollAt: nowIso(), lastHead: head, lastError: undefined }));
  return { head, processed };
}

async function tick() {
  if (running || Date.now() < backoffUntil) return;
  running = true;
  try {
    await pollOnce();
    backoffMs = 0;
  } catch (e) {
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : POLL_MS, 5 * 60_000);
    backoffUntil = Date.now() + backoffMs;
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    db.update((d) => ((d.indexer ??= { cursors: {}, seen: {}, pending: {} }).lastError = msg));
    console.warn(`[indexer] RPC error — retry in ${Math.round(backoffMs / 1000)} s: ${msg}`);
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | undefined;
export function startIndexer() {
  if (timer || process.env.INDEXER === 'off') return;
  console.log(`[indexer] watching known Safes every ${POLL_MS / 1000} s (confirmations: ${INDEXER_CONFIRMATIONS}, max range: ${MAX_RANGE} blocks)`);
  timer = setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 2000);
}

// ───────────────────────────── Routes ─────────────────────────────

type Route = (fn: (req: any, res: any) => unknown) => any;

export function registerIndexerRoutes(app: { get: any; post: any }, route: Route) {
  /** #19 — unrecognised tokens received by this client's wallet: never valued; "Ignore" only hides (signs nothing). */
  app.get('/clients/:id/unrecognised-tokens', route((req) => {
    const all = Object.values(db.data.tokenSightings?.[String(req.params.id)] ?? {});
    const includeHidden = req.query?.all === '1';
    return all
      .filter((s) => includeHidden || !s.hidden)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .map((s) => ({
        ...s,
        transfers: s.transfers.map((x) => ({ ...x, amount: s.standard === 'erc20' && s.decimals !== undefined ? formatUnits(x.valueRaw, s.decimals) : undefined })),
        ...biField('warning', 'Do not interact: unknown tokens are often scams.', 'N’interagissez pas : les jetons inconnus sont souvent des arnaques.'),
      }));
  }));
  app.post('/clients/:id/unrecognised-tokens/hide', route((req) => {
    const token = String(req.body?.token ?? '').toLowerCase();
    const s = db.data.tokenSightings?.[String(req.params.id)]?.[token];
    if (!s) return { hidden: false };
    db.update((d) => (d.tokenSightings![String(req.params.id)][token].hidden = true));
    return { hidden: true };
  }));
  /** Indexer status for this client's wallet (cursor vs chain head) — used by the app and the e2e run. */
  app.get('/clients/:id/indexer-status', route((req) => {
    const c = db.data.clients[String(req.params.id)];
    const st = db.data.indexer;
    return {
      cursor: c?.safeAddress ? (st?.cursors[c.safeAddress.toLowerCase()] ?? null) : null,
      head: st?.lastHead ?? null,
      lastPollAt: st?.lastPollAt ?? null,
      confirmations: INDEXER_CONFIRMATIONS,
      error: st?.lastError ? true : false,
    };
  }));
}

/** Unrecognised token contracts this client has received (policy: any call to them is refused). */
export function unrecognisedTokensOf(clientId: string): string[] {
  return Object.keys(db.data.tokenSightings?.[clientId] ?? {});
}
