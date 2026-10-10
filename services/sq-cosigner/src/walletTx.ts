// Wallet transactions as the client sees them (détectée → en attente → confirmée / échouée) and the
// receipt (justificatif) index. A receipt is DERIVED from a transaction: docId = kind:txHash (or the
// simulated id) and is upserted idempotently — confirming twice never creates a duplicate.

import { getAddress, formatUnits, Interface } from 'ethers';
import { ERC20_ABI, USDC_ADDRESS, USDC_DECIMALS } from '@sq/shared';
import { fetchWalletRates, newId, nowIso } from '@sq/shared/server';
import { both } from '@sq/shared';
import { db, logActivity, notify } from './db';
import { CONFIRMATIONS, provider } from './chain';

export type WalletTxStatus = 'detected' | 'pending' | 'confirmed' | 'failed';
export type WalletTxKind = 'receive' | 'send' | 'swap';

export interface WalletTx {
  id: string;
  clientId: string;
  kind: WalletTxKind;
  status: WalletTxStatus;
  asset: 'USDC' | 'ETH';
  amount: string; // human units
  from: string;
  to: string;
  counterpartyName?: string; // only when known (address book, own Swissquote account) — never inferred
  counterpartyNameFr?: string; // French twin of a generic name ("Compte Swissquote"), localised on read
  txHash?: string;
  simulated?: boolean;
  source: 'wallet' | 'swissquote-account' | 'simulation' | 'external';
  note?: string;
  noteFr?: string;
  feesSponsored: boolean;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  error?: string;
  /** Indicative CHF price captured when the tx was confirmed (market-data service). Absent = not captured:
   *  receipts then say "CHF value unavailable" instead of applying today's price to an old transaction. */
  valuation?: { chf: number; asOf: string; provider: string };
}

export interface DocumentEntry {
  docId: string;
  walletTxId: string;
  clientId: string;
  reference: string;
  createdAt: string;
}

export const docIdOf = (t: WalletTx) => `${t.kind}:${t.txHash ?? t.id}`;
export const referenceOf = (t: WalletTx) => {
  const d = (t.confirmedAt ?? t.createdAt).slice(0, 10).replace(/-/g, '');
  const tag = (t.txHash ?? t.id).replace(/^0x/, '').replace(/-/g, '').slice(0, 8);
  return `MW-${d}-${tag}`;
};

export function upsertWalletTx(t: Partial<WalletTx> & { id?: string; clientId: string }): WalletTx {
  return db.update((d) => {
    d.walletTxs ??= {};
    // idempotency on the on-chain hash
    const existing = t.id ? d.walletTxs[t.id] : t.txHash ? Object.values(d.walletTxs).find((x) => x.clientId === t.clientId && x.txHash?.toLowerCase() === t.txHash!.toLowerCase() && (!t.kind || x.kind === t.kind)) : undefined;
    const now = nowIso();
    const merged: WalletTx = existing
      ? { ...existing, ...stripUndefined(t), id: existing.id, updatedAt: now }
      : ({ id: t.id ?? newId(), createdAt: now, updatedAt: now, feesSponsored: false, source: 'wallet', status: 'detected', ...stripUndefined(t) } as WalletTx);
    if (merged.status === 'confirmed' && !merged.confirmedAt) merged.confirmedAt = now;
    d.walletTxs[merged.id] = merged;
    if (merged.status === 'confirmed') upsertDocument(d, merged);
    if (merged.status === 'confirmed' && !merged.valuation && !merged.simulated) void captureValuation(merged.id);
    return merged;
  });
}

/** Records the indicative CHF price at confirmation time (only a price at most 1 h away from the confirmation). */
async function captureValuation(id: string) {
  try {
    const t = db.data.walletTxs?.[id];
    if (!t) return;
    const r = (await fetchWalletRates())[t.asset];
    const at = new Date(t.confirmedAt ?? t.updatedAt).getTime();
    if (!r || Math.abs(new Date(r.asOf).getTime() - at) > 3600e3) return;
    db.update((d) => {
      const x = d.walletTxs?.[id];
      if (x && !x.valuation) x.valuation = { chf: r.chf, asOf: r.asOf, provider: r.provider };
    });
  } catch {
    /* no valuation: the receipt states it explicitly */
  }
}

function upsertDocument(d: any, t: WalletTx) {
  d.documents ??= {};
  const docId = docIdOf(t);
  if (!d.documents[docId]) d.documents[docId] = { docId, walletTxId: t.id, clientId: t.clientId, reference: referenceOf(t), createdAt: nowIso() } satisfies DocumentEntry;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const labelEn = (t: WalletTx) => `${t.kind === 'receive' ? 'Receipt' : 'Payment'} of ${t.amount} ${t.asset}`;
const labelFr = (t: WalletTx) => `${t.kind === 'receive' ? 'Réception' : 'Envoi'} de ${t.amount} ${t.asset}`;

export function confirmWalletTx(id: string) {
  const t = upsertWalletTx({ id, clientId: db.data.walletTxs![id].clientId, status: 'confirmed' });
  logActivity({ clientId: t.clientId, actor: 'system', type: 'wallet-tx.confirmed', message: both(
      `${labelEn(t)} confirmed${t.simulated ? ' (simulated)' : ''} — receipt available`,
      `${labelFr(t)} ${t.kind === 'receive' ? 'confirmée' : 'confirmé'}${t.simulated ? ' (simulée)' : ''} — justificatif disponible`,
    ), txHash: t.txHash, data: { walletTxId: t.id } });
  return t;
}

/** Demo-only: a fictitious incoming payment (no blockchain transaction), clearly flagged as simulated. */
export function simulateReceive(clientId: string, safeAddress: string, amount = '250') {
  const t = upsertWalletTx({
    clientId,
    kind: 'receive',
    status: 'pending',
    asset: 'USDC',
    amount,
    from: '0x0000000000000000000000000000000000000000',
    to: safeAddress,
    simulated: true,
    source: 'simulation',
    feesSponsored: false,
    note: 'Simulated receipt (demo)',
    noteFr: 'Réception simulée (démo)',
  });
  logActivity({ clientId, actor: 'system', type: 'wallet-tx.pending', message: both(`Simulated receipt of ${amount} USDC detected — awaiting confirmation`, `Réception simulée de ${amount} USDC détectée — en attente de confirmation`), data: { walletTxId: t.id } });
  setTimeout(() => confirmWalletTx(t.id), 3000);
  return t;
}

const erc20 = new Interface(ERC20_ABI);

/** Tracks an incoming on-chain USDC transfer to the client's Safe (e.g. from the Swissquote account). */
export function trackIncoming(clientId: string, safeAddress: string, txHash: string, source: WalletTx['source'], fromName?: string, amountHint?: string, fromNameFr?: string) {
  const t = upsertWalletTx({ clientId, kind: 'receive', status: 'pending', asset: 'USDC', amount: amountHint ?? '?', from: '', to: safeAddress, txHash, source, counterpartyName: fromName, counterpartyNameFr: fromName ? fromNameFr : undefined, feesSponsored: source === 'swissquote-account' });
  void (async () => {
    try {
      const rc = await provider.waitForTransaction(txHash, CONFIRMATIONS, 180_000);
      if (!rc || rc.status !== 1) throw new Error('Transaction failed on-chain');
      let amount = 0n;
      let from = '';
      for (const l of rc.logs) {
        if (l.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
        const p = erc20.parseLog(l);
        if (p?.name === 'Transfer' && getAddress(p.args[1]) === getAddress(safeAddress)) {
          amount += p.args[2] as bigint;
          from = getAddress(p.args[0]);
        }
      }
      if (amount === 0n) throw new Error('No USDC transfer to this wallet in that transaction');
      upsertWalletTx({ id: t.id, clientId, amount: formatUnits(amount, USDC_DECIMALS), from });
      confirmWalletTx(t.id);
      const amt = formatUnits(amount, USDC_DECIMALS);
      notify({
        clientId,
        channel: 'app',
        subject: both('Receipt confirmed', 'Réception confirmée'),
        body: both(`${amt} USDC received${fromName ? ` from ${fromName}` : ''}.`, `${amt} USDC reçus${fromName ? ` depuis ${fromNameFr || fromName}` : ''}.`),
      });
    } catch (e) {
      upsertWalletTx({ id: t.id, clientId, status: 'failed', error: (e as Error).message });
      logActivity({ clientId, actor: 'system', type: 'wallet-tx.failed', message: both(`Receipt failed: ${(e as Error).message}`, `Réception échouée : ${(e as Error).message}`), txHash, data: { walletTxId: t.id } });
    }
  })();
  return t;
}
