// On-chain protection (SECURITY_GAPS_FIX §3 — MyWallGuard + Zodiac Delay D1/D2) on the co-signer side:
//  • setup / "Upgrade wallet security": the co-signer builds the canonical K1 + K2 batch, K1 signs it (passkey for an
//    existing wallet), K2 co-signs it after re-checking it byte for byte, the relayer pays the gas;
//  • emergency gas reserve: deposited once on the recovery key K3's address (see docs/ONCHAIN_PROTECTION.md);
//  • veto (setTxNonce, K1 + K2 + passkey), execution of ready queued operations (relayer pays), queue reading;
//  • device recovery on a protected wallet: swapOwner queued in D1 (K3 + K2), executed after the on-chain cooldown
//    AND the server delay (complement), by the relayer (executeNextTx).
// Data kept here (data/protection.json): tx hashes and the queued recovery calls — the chain is the source of truth.

import type { Express, Request, Response, NextFunction } from 'express';
import { Contract, formatEther, getAddress, parseEther, type TransactionReceipt } from 'ethers';
import { both, explorerTx, short, type SafeTx } from '@sq/shared';
import {
  DELAY_ABI,
  MYWALL_GUARD_ADDRESS,
  PROTECTION_DEMO_DELAYS,
  PROTECTION_EVENTS,
  PROTECTION_PROD_DELAYS,
  batchSafeTx,
  delayIface,
  planProtectionSetup,
  readDelayQueue,
  readProtection,
  vetoSafeTx,
  type InnerTx,
  type ProtectionDelays,
} from '@sq/shared/protection';
import { JsonStore, newId, nowIso, t } from '@sq/shared/server';
import { db, getClient, HttpError, logActivity, notify, type Client, type RecoveryRequest } from './db';
import { DATA_DIR } from './paths';
import { CONFIRMATIONS, checkedSafeTxHash, cosignAndExecute, provider, recoverSigner, relayer, relayerTask, safeState, shortErr } from './chain';
import { createPreview, consumePreview } from './previews';
import { validateProtectionBatch, validateRecoveryQueue, validateVeto } from './validate';
import { authOptionsForHash, verifyAssertion } from './webauthn';
import { verifyBackupCode } from './backupCode';
import { registerIndexerEvent } from './indexer';

const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
/** Demo delays (env-overridable). Production: D1 48 h / 7 d, D2 30 d / 30 d, D3 ~6 months (PROTECTION_PROD_DELAYS). */
export const DELAYS: ProtectionDelays = {
  d1: { cooldown: num('PROTECTION_D1_COOLDOWN_SEC', PROTECTION_DEMO_DELAYS.d1.cooldown), expiration: num('PROTECTION_D1_EXPIRATION_SEC', PROTECTION_DEMO_DELAYS.d1.expiration) },
  d2: { cooldown: num('PROTECTION_D2_COOLDOWN_SEC', PROTECTION_DEMO_DELAYS.d2.cooldown), expiration: num('PROTECTION_D2_EXPIRATION_SEC', PROTECTION_DEMO_DELAYS.d2.expiration) },
  d3: { cooldown: num('PROTECTION_D3_COOLDOWN_SEC', PROTECTION_DEMO_DELAYS.d3.cooldown), expiration: num('PROTECTION_D3_EXPIRATION_SEC', PROTECTION_DEMO_DELAYS.d3.expiration) },
};
export const PROTECTION_AVAILABLE = !!MYWALL_GUARD_ADDRESS && process.env.PROTECTION_ENABLED !== 'false';
/** Emergency gas reserve deposited on K3's address at setup (demo 0.002 ETH; 0 disables it). */
const GAS_RESERVE_WEI = parseEther(process.env.PROTECTION_GAS_RESERVE_ETH ?? '0.002');
/** Sponsoring cap for the setup batch (deploys two module proxies). */
const SETUP_MAX_GAS = BigInt(num('PROTECTION_SETUP_MAX_GAS', 8_000_000));
/** A wallet opened less than this ago may be protected right after deployment without a new passkey prompt. */
const FRESH_WALLET_SEC = 15 * 60;

interface WalletRecord {
  safeAddress: string;
  d1: string;
  d2: string;
  d3?: string | null;
  setupTxHash: string;
  protectedAt: string;
  reserveTxHash?: string;
  reserveWei?: string;
  /** block of the setup: lower bound for event queries */
  fromBlock?: number;
}
interface RecoveryOnchain {
  recoveryId: string;
  d1: string;
  index: number;
  inner: { to: string; value: string; data: string; operation: number };
  queueTxHash: string;
  executableAt: string; // on-chain cooldown end
}
const store = new JsonStore<{ wallets: Record<string, WalletRecord>; recoveries: Record<string, RecoveryOnchain> }>(DATA_DIR, 'protection', () => ({ wallets: {}, recoveries: {} }));

type Route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => void;

// ───────────────────────────── reading ─────────────────────────────

export async function protectionOf(safeAddress: string) {
  return readProtection(provider, safeAddress, MYWALL_GUARD_ADDRESS);
}

/** True when the wallet's guard is MyWallGuard with a configuration (new path: everything but K1 + K2 goes through D1). */
export async function isProtectedWallet(c: Client): Promise<boolean> {
  if (!c.safeAddress || !PROTECTION_AVAILABLE) return false;
  return (await protectionOf(c.safeAddress)).protected;
}

const view = (rec?: WalletRecord) =>
  rec ? { setupTx: rec.setupTxHash, setupExplorer: explorerTx(rec.setupTxHash), protectedAt: rec.protectedAt, reserveTx: rec.reserveTxHash ?? null, reserveEth: rec.reserveWei ? formatEther(rec.reserveWei) : null } : null;

async function walletProtection(c: Client) {
  if (!c.safeAddress || !c.owners) return { available: PROTECTION_AVAILABLE, deployed: false };
  const st = await protectionOf(c.safeAddress);
  const rec = store.data.wallets[c.clientId];
  const [queues, reserve] = await Promise.all([
    st.config
      ? Promise.all([readDelayQueue(provider, st.config.d1, { withTxs: true, fromBlock: rec?.fromBlock }), readDelayQueue(provider, st.config.d2, { withTxs: true, fromBlock: rec?.fromBlock })])
      : Promise.resolve(null),
    provider.getBalance(c.owners.recovery).catch(() => null),
  ]);
  return {
    available: PROTECTION_AVAILABLE,
    deployed: true,
    protected: st.protected,
    guard: st.guard,
    modules: st.modules,
    config: st.config,
    queues: queues ? { d1: queues[0], d2: queues[1] } : null,
    delays: { demo: DELAYS, production: PROTECTION_PROD_DELAYS },
    emergencyReserve: { address: c.owners.recovery, eth: reserve === null ? null : formatEther(reserve), note: 'Emergency gas reserve — used only if Swissquote is unavailable' },
    record: view(rec),
    events: PROTECTION_EVENTS,
  };
}

// ───────────────────────────── setup ─────────────────────────────

async function setupPlan(c: Client) {
  if (!PROTECTION_AVAILABLE) throw new HttpError(503, t('On-chain protection is not available (guard not deployed)', 'Protection on-chain indisponible (guard non déployé)'));
  if (!c.safeAddress || !c.owners) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
  const st = await protectionOf(c.safeAddress);
  if (st.protected) throw new HttpError(409, t('This wallet is already protected on-chain', 'Ce wallet est déjà protégé on-chain'), { code: 'already-protected' });
  if (st.guard) throw new HttpError(409, t('This wallet already has another guard', 'Ce wallet a déjà un autre guard'));
  const base = { safe: c.safeAddress, k2: c.owners.cosigner, k3: c.owners.recovery, guard: MYWALL_GUARD_ADDRESS, delays: DELAYS };
  const first = planProtectionSetup(base);
  // A proxy already deployed with the same initializer (e.g. by a third party) is reused: it is owned by the Safe.
  const [c1, c2] = await Promise.all([provider.getCode(first.d1.address), provider.getCode(first.d2.address)]);
  const plan = planProtectionSetup({ ...base, deployed: { D1: c1 !== '0x', D2: c2 !== '0x' } });
  const state = await safeState(c.safeAddress);
  return { plan, state, safeTx: batchSafeTx(plan.data, state.nonce) };
}

const isFresh = (c: Client) => {
  const ev = db.data.activity.find((e) => e.clientId === c.clientId && e.type === 'wallet.deployed');
  return !!ev && Date.now() - new Date(ev.ts).getTime() < FRESH_WALLET_SEC * 1000;
};

async function depositReserve(c: Client) {
  if (GAS_RESERVE_WEI === 0n || !c.owners) return null;
  const k3 = c.owners.recovery;
  const bal = await provider.getBalance(k3);
  if (bal >= GAS_RESERVE_WEI) return null;
  return relayerTask(async () => {
    const sent = await relayer.sendTransaction({ to: k3, value: GAS_RESERVE_WEI - bal });
    const rc = await sent.wait(CONFIRMATIONS);
    if (!rc || rc.status !== 1) throw new Error('reserve transfer failed');
    return { txHash: sent.hash, wei: (GAS_RESERVE_WEI - bal).toString() };
  });
}

/** After a recovery-key rotation (K3 → K3′): the reserve is deposited again on K3′ (best effort, logged). */
export async function refundReserveAfterRotation(clientId: string) {
  try {
    const c = getClient(clientId);
    if (!store.data.wallets[clientId]) return; // only wallets that received a reserve at protection time
    const r = await depositReserve(c);
    if (!r) return;
    store.update((d) => Object.assign(d.wallets[clientId], { reserveTxHash: r.txHash, reserveWei: r.wei }));
    logActivity({ clientId, actor: 'swissquote', type: 'protection.reserve', message: both(`Emergency gas reserve (${formatEther(r.wei)} ETH) deposited on your new recovery key's address`, `Réserve de gas d’urgence (${formatEther(r.wei)} ETH) déposée sur l’adresse de votre nouvelle clé de secours`), txHash: r.txHash });
  } catch (e) {
    console.warn(`[protection] reserve refund after rotation failed: ${shortErr(e)}`);
  }
}

// ───────────────────────────── recovery (protected wallets) ─────────────────────────────

export function isProtectedRecovery(id: string) {
  return !!store.data.recoveries[id];
}

/** Recovery request on a protected wallet: queued in D1 right away (K3 + K2), executed after both delays. */
export async function protectedRecoveryRequest(p: {
  c: Client;
  riskScore: number;
  safeTx: SafeTx;
  signatureK3: string;
  partnerAttestationId: string;
  newCredentialId?: string;
  serverDelaySec: number;
}): Promise<RecoveryRequest> {
  const { c, safeTx } = p;
  const st = await protectionOf(c.safeAddress!);
  if (!st.config) throw new HttpError(409, t('Wallet not protected', 'Wallet non protégé'));
  const intent = validateRecoveryQueue(safeTx, c.safeAddress!, st.config.d1);
  if (intent.oldOwner !== getAddress(c.owners!.device)) throw new HttpError(400, t('Only the device key can be replaced', "Seule la clé de l'appareil peut être remplacée"));
  if ([c.owners!.cosigner, c.owners!.recovery].some((k) => getAddress(k) === intent.newOwner)) throw new HttpError(400, t('This key cannot be used', 'Cette clé ne peut pas être utilisée'));
  const state = await safeState(c.safeAddress!);
  if (BigInt(safeTx.nonce) !== state.nonce) throw new HttpError(409, t('Outdated operation, please start again', 'Opération périmée, recommencez'));
  const hash = await checkedSafeTxHash(c.safeAddress!, safeTx);
  if (recoverSigner(c.safeAddress!, safeTx, p.signatureK3) !== getAddress(c.owners!.recovery)) throw new HttpError(401, t('Not signed by the recovery key', 'Non signé par la clé de secours'));
  if (Object.values(db.data.recoveries).some((r) => r.clientId === c.clientId && (r.status === 'pending-delay' || r.status === 'executing')))
    throw new HttpError(409, t('A recovery is already in progress', 'Une récupération est déjà en cours'));

  // K2 co-signs the QUEUEING only; the swap itself runs later from D1 (no signature at execution time).
  const { txHash, receipt } = await cosignAndExecute(c.clientId, c.safeAddress!, safeTx, { signer: c.owners!.recovery, signature: p.signatureK3 });
  const added = queuedFrom(receipt, st.config.d1);
  const block = await provider.getBlock(receipt.blockNumber);
  const cooldown = Number(await new Contract(st.config.d1, DELAY_ABI, provider).txCooldown());
  const executableAt = new Date(((block?.timestamp ?? Math.floor(Date.now() / 1000)) + cooldown) * 1000);
  const serverAt = new Date(Date.now() + p.serverDelaySec * 1000);
  const executeAfter = new Date(Math.max(executableAt.getTime(), serverAt.getTime()) + 5000).toISOString();
  const [, , data] = delayIface.decodeFunctionData('execTransactionFromModule', safeTx.data);
  const r: RecoveryRequest & { onchain: unknown } = {
    id: newId(),
    clientId: c.clientId,
    safeAddress: c.safeAddress!,
    oldDevice: intent.oldOwner,
    newDevice: intent.newOwner,
    safeTx,
    safeTxHash: hash,
    signatureK3: p.signatureK3,
    partnerAttestationId: p.partnerAttestationId,
    riskScore: p.riskScore,
    newCredentialId: p.newCredentialId,
    status: 'pending-delay',
    executeAfter,
    createdAt: nowIso(),
    onchain: { d1: st.config.d1, index: added.index, queueTx: txHash, queueExplorer: explorerTx(txHash), executableAt: executableAt.toISOString(), cooldownSec: cooldown },
  };
  store.update((d) => {
    d.recoveries[r.id] = { recoveryId: r.id, d1: st.config!.d1, index: added.index, inner: { to: c.safeAddress!, value: '0', data: String(data), operation: 0 }, queueTxHash: txHash, executableAt: executableAt.toISOString() };
  });
  db.update((d) => (d.recoveries[r.id] = r));
  const hm = (iso: string, l: string) => new Date(iso).toLocaleTimeString(l, { timeZone: 'Europe/Zurich' });
  logActivity({
    clientId: c.clientId,
    actor: 'client',
    type: 'recovery.requested',
    message: both(
      `Recovery queued ON-CHAIN in the delay module D1: ${short(r.oldDevice)} → ${short(r.newDevice)}. Executable at ${hm(executeAfter, 'en-CH')}`,
      `Récupération mise en file ON-CHAIN dans le module de délai D1 : ${short(r.oldDevice)} → ${short(r.newDevice)}. Exécutable à ${hm(executeAfter, 'fr-CH')}`,
    ),
    txHash,
  });
  for (const channel of ['email', 'sms', 'app'] as const)
    notify({
      clientId: c.clientId,
      channel,
      subject: both('Wallet recovery queued on the blockchain', 'Récupération du wallet mise en file sur la blockchain'),
      body: both(
        `A recovery of your My Wall wallet was queued on-chain. It can complete at ${hm(executeAfter, 'en-CH')}. If this wasn't you, cancel it now from your device (on-chain veto: device key + Swissquote).`,
        `Une récupération de votre wallet My Wall a été mise en file on-chain. Elle peut aboutir à ${hm(executeAfter, 'fr-CH')}. Si ce n'est pas vous, annulez-la maintenant depuis votre appareil (veto on-chain : clé de l'appareil + Swissquote).`,
      ),
      action: { label: both("It wasn't me — cancel", "Ce n'est pas moi — annuler"), kind: 'cancel-recovery', id: r.id },
    });
  return r;
}

function queuedFrom(receipt: TransactionReceipt, delay: string) {
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== delay.toLowerCase() || l.topics[0] !== PROTECTION_EVENTS.TransactionAdded) continue;
    const ev = delayIface.parseLog(l)!;
    return { index: Number(ev.args.queueNonce), hash: ev.args.txHash as string };
  }
  throw new Error('No TransactionAdded event in the queueing receipt');
}

/** Called by the co-signer ticker once executeAfter is reached. */
export async function executeProtectedRecovery(id: string) {
  const r = db.data.recoveries[id];
  const o = store.data.recoveries[id];
  if (!r || !o || r.status !== 'pending-delay') return;
  const d = new Contract(o.d1, DELAY_ABI, provider);
  const txNonce = Number(await d.txNonce());
  if (txNonce > o.index) {
    db.update((x) => (x.recoveries[id].status = 'cancelled'));
    logActivity({ clientId: r.clientId, actor: 'client', type: 'recovery.vetoed', message: both('Recovery cancelled ON-CHAIN (veto in D1): the device key was not replaced', 'Récupération annulée ON-CHAIN (veto dans D1) : la clé de l’appareil n’a pas été remplacée') });
    return;
  }
  if (txNonce < o.index) {
    // an earlier queued operation must be executed, vetoed or expire first (Delay queues are FIFO)
    db.update((x) => (x.recoveries[id].executeAfter = new Date(Date.now() + 30_000).toISOString()));
    return;
  }
  db.update((x) => (x.recoveries[id].status = 'executing'));
  try {
    const inner = o.inner;
    const txHash = await relayerTask(async () => {
      const dr = new Contract(o.d1, DELAY_ABI, relayer);
      const sent = await dr.executeNextTx(inner.to, BigInt(inner.value), inner.data, inner.operation);
      const rc = await sent.wait(CONFIRMATIONS);
      if (!rc || rc.status !== 1) throw new Error('executeNextTx reverted');
      return sent.hash as string;
    });
    db.update((x) => {
      Object.assign(x.recoveries[id], { status: 'completed', txHash });
      const cl = x.clients[r.clientId];
      cl.owners!.device = r.newDevice;
      cl.devices = cl.devices.map((dev) => (dev.status === 'pending-recovery' ? { ...dev, status: 'active' } : dev.status === 'active' ? { ...dev, status: 'revoked' } : dev));
    });
    logActivity({
      clientId: r.clientId,
      actor: 'swissquote',
      type: 'recovery.completed',
      message: both(`Old device key ${short(r.oldDevice)} revoked on the blockchain (executed from the delay module D1), new key ${short(r.newDevice)} active`, `Ancienne clé d'appareil ${short(r.oldDevice)} révoquée sur la blockchain (exécutée depuis le module de délai D1), nouvelle clé ${short(r.newDevice)} active`),
      txHash,
    });
    notify({ clientId: r.clientId, channel: 'email', subject: both('Recovery complete', 'Récupération terminée'), body: both(`Your old device can no longer sign. ${explorerTx(txHash)}`, `Votre ancien appareil ne peut plus signer. ${explorerTx(txHash)}`) });
  } catch (e) {
    const msg = shortErr(e);
    // still in cooldown on-chain (clock skew between this server and the chain): try again shortly
    if (/cooldown/i.test(msg)) {
      db.update((x) => Object.assign(x.recoveries[id], { status: 'pending-delay', executeAfter: new Date(Date.now() + 10_000).toISOString() }));
      return;
    }
    db.update((x) => Object.assign(x.recoveries[id], { status: 'failed', error: msg }));
    logActivity({ clientId: r.clientId, actor: 'system', type: 'recovery.failed', message: both(`Recovery failed: ${msg}`, `Récupération échouée : ${msg}`) });
  }
}

/** Off-chain cancel of a queued (on-chain) recovery: the co-signer will not execute it, but only a veto makes it impossible. */
export function onRecoveryCancelled(id: string) {
  const r = db.data.recoveries[id];
  if (!r || !store.data.recoveries[id]) return;
  logActivity({
    clientId: r.clientId,
    actor: 'system',
    type: 'recovery.veto-required',
    message: both(
      'This recovery is queued on-chain: Swissquote will not execute it, and the on-chain veto (device key + Swissquote) cancels it for good.',
      'Cette récupération est en file on-chain : Swissquote ne l’exécutera pas, et le veto on-chain (clé de l’appareil + Swissquote) l’annule définitivement.',
    ),
  });
}

// ───────────────────────────── alerts (indexer) ─────────────────────────────

const clientOfDelay = (addr: string) => Object.entries(store.data.wallets).find(([, w]) => [w.d1, w.d2, w.d3].some((d) => d && d.toLowerCase() === addr.toLowerCase()));

/** Every queueing in D1/D2 → immediate alert to the client (veto) and to compliance; every module execution → review. */
function registerProtectionEvents() {
  registerIndexerEvent({
    id: 'delay-transaction-added',
    topics: [PROTECTION_EVENTS.TransactionAdded],
    addresses: (safes) => safes.flatMap(({ clientId }) => { const w = store.data.wallets[clientId]; return w ? [w.d1, w.d2, ...(w.d3 ? [w.d3] : [])] : []; }),
    handle: (log, ctx) => {
      const found = clientOfDelay(log.address);
      if (!found) return;
      const [clientId, w] = found;
      const module = log.address.toLowerCase() === w.d1.toLowerCase() ? 'D1' : log.address.toLowerCase() === w.d2.toLowerCase() ? 'D2' : 'D3';
      const index = Number(BigInt(log.topics[1]));
      logActivity({ clientId, actor: 'system', type: 'protection.queued', message: both(`Protected operation #${index} queued in ${module} — compliance review; the client can cancel it (veto)`, `Opération protégée n°${index} mise en file dans ${module} — revue conformité ; le client peut l’annuler (veto)`), txHash: log.transactionHash, data: { module, index, delay: log.address } });
      if (ctx.backfilled) return;
      for (const channel of ['email', 'app'] as const)
        notify({
          clientId,
          channel,
          subject: both('A protected operation is pending on your wallet', 'Une opération protégée est en attente sur votre wallet'),
          body: both(`An operation was queued in your wallet's delay module ${module}. If it wasn't you, cancel it now in Security (Cancel it). ${explorerTx(log.transactionHash)}`, `Une opération a été mise en file dans le module de délai ${module} de votre wallet. Si ce n'est pas vous, annulez-la maintenant dans Sécurité (L’annuler). ${explorerTx(log.transactionHash)}`),
        });
    },
  });
  registerIndexerEvent({
    id: 'safe-execution-from-module',
    topics: [PROTECTION_EVENTS.ExecutionFromModuleSuccess],
    addresses: (safes) => safes.filter(({ clientId }) => store.data.wallets[clientId]).map(({ safe }) => safe),
    handle: (log) => {
      const entry = Object.entries(store.data.wallets).find(([, w]) => w.safeAddress.toLowerCase() === log.address.toLowerCase());
      if (!entry) return;
      logActivity({ clientId: entry[0], actor: 'system', type: 'protection.module-executed', message: both('Operation executed from a delay module, without Swissquote co-signature at execution — compliance review', 'Opération exécutée depuis un module de délai, sans co-signature Swissquote à l’exécution — revue conformité'), txHash: log.transactionHash });
    },
  });
}

// ───────────────────────────── routes ─────────────────────────────

export function registerProtectionRoutes(app: Express, route: Route) {
  registerProtectionEvents();
  app.get('/clients/:id/protection', route(async (req) => walletProtection(getClient(String(req.params.id)))));

  /** Builds the canonical K1 + K2 setup batch (new wallet right after deployment, or "Upgrade wallet security"). */
  app.post(
    '/clients/:id/protection/setup/prepare',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const { plan, safeTx } = await setupPlan(c);
      const safeTxHash = await checkedSafeTxHash(c.safeAddress!, safeTx);
      const p = createPreview({ clientId: c.clientId, safeAddress: c.safeAddress!, safeTx, safeTxHash, intent: { kind: 'protection-setup' }, fee: { available: false, chf: null, eth: '0', gasUnits: '0', demo: false } });
      const passkeyRequired = !c.headless && !isFresh(c);
      return {
        previewId: p.id,
        expiresAt: p.expiresAt,
        safeTx,
        safeTxHash,
        passkeyRequired,
        authOptions: passkeyRequired ? await authOptionsForHash(c, p.challenge) : null,
        guard: plan.guard,
        d1: plan.d1.address,
        d2: plan.d2.address,
        delays: DELAYS,
        summary: t(
          `Activate on-chain protection: only device key + Swissquote is immediate; any other combination waits ${DELAYS.d1.cooldown} s (D1), the recovery key alone ${DELAYS.d2.cooldown} s (D2).`,
          `Activer la protection on-chain : seules la clé de l’appareil + Swissquote sont immédiates ; toute autre combinaison attend ${DELAYS.d1.cooldown} s (D1), la clé de secours seule ${DELAYS.d2.cooldown} s (D2).`,
        ),
      };
    }),
  );

  app.post(
    '/clients/:id/protection/setup/submit',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const { previewId, safeTx: submitted, signatureK1, webauthn, backupCode } = req.body as { previewId: string; safeTx: SafeTx; signatureK1: string; webauthn?: any; backupCode?: string };
      const p = consumePreview(previewId, c.clientId, submitted);
      const { plan, safeTx } = await setupPlan(c); // rebuilt independently: must be byte-for-byte the previewed batch
      validateProtectionBatch(p.safeTx, plan.data);
      if (BigInt(p.safeTx.nonce) !== BigInt(safeTx.nonce)) throw new HttpError(409, t('Outdated operation, please start again', 'Opération périmée, recommencez'));
      if (!c.headless && !isFresh(c)) {
        if (backupCode) verifyBackupCode(c.clientId, backupCode);
        else await verifyAssertion(c.clientId, webauthn, { hash: p.challenge });
      }
      const signer = recoverSigner(c.safeAddress!, p.safeTx, signatureK1);
      if (signer !== getAddress(c.owners!.device)) throw new HttpError(401, t('Must be signed by the device key', "Doit être signé par la clé de l'appareil"));
      const { txHash, gasUsed, receipt } = await cosignAndExecute(c.clientId, c.safeAddress!, p.safeTx, { signer, signature: signatureK1 }, undefined, { maxGas: SETUP_MAX_GAS });
      const st = await protectionOf(c.safeAddress!);
      if (!st.protected) throw new HttpError(502, t('Setup executed but the guard is not active', 'Lot exécuté mais le guard n’est pas actif'));
      store.update((d) => {
        d.wallets[c.clientId] = { safeAddress: c.safeAddress!, d1: plan.d1.address, d2: plan.d2.address, d3: null, setupTxHash: txHash, protectedAt: nowIso(), fromBlock: receipt.blockNumber };
      });
      logActivity({
        clientId: c.clientId,
        actor: 'swissquote',
        type: 'protection.enabled',
        message: both(
          `On-chain protection active: guard + delay modules D1 (${DELAYS.d1.cooldown} s) and D2 (${DELAYS.d2.cooldown} s). Only device key + Swissquote is immediate.`,
          `Protection on-chain active : guard + modules de délai D1 (${DELAYS.d1.cooldown} s) et D2 (${DELAYS.d2.cooldown} s). Seules la clé de l’appareil + Swissquote sont immédiates.`,
        ),
        txHash,
      });
      let reserve: { txHash: string; wei: string } | null = null;
      try {
        reserve = await depositReserve(c);
        if (reserve) {
          store.update((d) => Object.assign(d.wallets[c.clientId], { reserveTxHash: reserve!.txHash, reserveWei: reserve!.wei }));
          logActivity({
            clientId: c.clientId,
            actor: 'swissquote',
            type: 'protection.reserve',
            message: both(`Emergency gas reserve (${formatEther(reserve.wei)} ETH) deposited on your recovery key's address — used only if Swissquote is unavailable`, `Réserve de gas d’urgence (${formatEther(reserve.wei)} ETH) déposée sur l’adresse de votre clé de secours — utilisée seulement si Swissquote est indisponible`),
            txHash: reserve.txHash,
          });
        }
      } catch (e) {
        console.warn(`[protection] reserve deposit failed: ${shortErr(e)}`); // non-blocking: the protection itself is active
      }
      return { txHash, explorer: explorerTx(txHash), gasUsed, d1: plan.d1.address, d2: plan.d2.address, guard: plan.guard, reserveTx: reserve?.txHash ?? null };
    }),
  );

  /** Veto of pending operations of D1 / D2 (/ D3): setTxNonce, signed K1 + K2 (+ passkey), immediate. */
  app.post(
    '/clients/:id/protection/veto/prepare',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const { module = 'D1', upTo } = req.body as { module?: 'D1' | 'D2' | 'D3'; upTo?: number };
      const st = await protectionOf(c.safeAddress ?? '0x0000000000000000000000000000000000000000');
      const delay = st.config ? ({ D1: st.config.d1, D2: st.config.d2, D3: st.config.d3 } as const)[module] : null;
      if (!delay) throw new HttpError(400, t('No such delay module on this wallet', 'Pas de tel module de délai sur ce wallet'));
      const q = await readDelayQueue(provider, delay);
      if (q.txNonce >= q.queueNonce) throw new HttpError(409, t('Nothing is pending in this module', 'Rien n’est en attente dans ce module'));
      const newTxNonce = typeof upTo === 'number' ? upTo + 1 : q.queueNonce;
      if (newTxNonce <= q.txNonce || newTxNonce > q.queueNonce) throw new HttpError(400, t('Invalid queue position', 'Position de file invalide'));
      const state = await safeState(c.safeAddress!);
      const safeTx = vetoSafeTx(delay, newTxNonce, state.nonce);
      const safeTxHash = await checkedSafeTxHash(c.safeAddress!, safeTx);
      const p = createPreview({ clientId: c.clientId, safeAddress: c.safeAddress!, safeTx, safeTxHash, intent: { kind: 'protection-veto', module, newTxNonce }, fee: { available: false, chf: null, eth: '0', gasUnits: '0', demo: false } });
      return { previewId: p.id, expiresAt: p.expiresAt, safeTx, safeTxHash, authOptions: c.headless ? null : await authOptionsForHash(c, p.challenge), cancels: q.pending.filter((x) => x.index < newTxNonce) };
    }),
  );

  app.post(
    '/clients/:id/protection/veto/submit',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const { previewId, safeTx: submitted, signatureK1, webauthn, backupCode } = req.body as { previewId: string; safeTx: SafeTx; signatureK1: string; webauthn?: any; backupCode?: string };
      const p = consumePreview(previewId, c.clientId, submitted);
      const st = await protectionOf(c.safeAddress!);
      if (!st.config) throw new HttpError(409, t('Wallet not protected', 'Wallet non protégé'));
      const v = validateVeto(p.safeTx, [st.config.d1, st.config.d2, ...(st.config.d3 ? [st.config.d3] : [])]);
      if (backupCode) verifyBackupCode(c.clientId, backupCode);
      else await verifyAssertion(c.clientId, webauthn, { hash: p.challenge });
      const signer = recoverSigner(c.safeAddress!, p.safeTx, signatureK1);
      if (signer !== getAddress(c.owners!.device)) throw new HttpError(401, t('Must be signed by the device key', "Doit être signé par la clé de l'appareil"));
      const { txHash } = await cosignAndExecute(c.clientId, c.safeAddress!, p.safeTx, { signer, signature: signatureK1 });
      logActivity({ clientId: c.clientId, actor: 'client', type: 'protection.veto', message: both(`Pending protected operation(s) cancelled on-chain (veto, queue position < ${v.newTxNonce})`, `Opération(s) protégée(s) en attente annulée(s) on-chain (veto, position < ${v.newTxNonce})`), txHash });
      notify({ clientId: c.clientId, channel: 'app', subject: both('Pending operation cancelled', 'Opération en attente annulée'), body: both(`Your veto is recorded on the blockchain. ${explorerTx(txHash)}`, `Votre veto est inscrit sur la blockchain. ${explorerTx(txHash)}`) });
      return { txHash, explorer: explorerTx(txHash), delay: v.delay, newTxNonce: v.newTxNonce.toString() };
    }),
  );

  /** Executes a ready queued operation (anyone may; here the relayer pays the gas). */
  app.post(
    '/clients/:id/protection/execute',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const { module = 'D1', index } = req.body as { module?: 'D1' | 'D2' | 'D3'; index?: number };
      const st = await protectionOf(c.safeAddress ?? '0x0000000000000000000000000000000000000000');
      const delay = st.config ? ({ D1: st.config.d1, D2: st.config.d2, D3: st.config.d3 } as const)[module] : null;
      if (!delay) throw new HttpError(400, t('No such delay module on this wallet', 'Pas de tel module de délai sur ce wallet'));
      const q = await readDelayQueue(provider, delay, { withTxs: true, fromBlock: store.data.wallets[c.clientId]?.fromBlock });
      const next = q.pending[0];
      if (!next || (typeof index === 'number' && next.index !== index)) throw new HttpError(409, t('This operation is not next in the queue', 'Cette opération n’est pas la prochaine de la file'));
      if (next.status !== 'executable' || !next.tx) throw new HttpError(409, t('Not executable yet', 'Pas encore exécutable'), { executableAt: next.executableAt, status: next.status });
      const inner: InnerTx = { to: next.tx.to, value: BigInt(next.tx.value), data: next.tx.data, operation: next.tx.operation as 0 | 1 };
      const txHash = await relayerTask(async () => {
        const sent = await new Contract(delay, DELAY_ABI, relayer).executeNextTx(inner.to, inner.value, inner.data, inner.operation);
        const rc = await sent.wait(CONFIRMATIONS);
        if (!rc || rc.status !== 1) throw new Error('executeNextTx reverted');
        return sent.hash as string;
      });
      logActivity({ clientId: c.clientId, actor: 'system', type: 'protection.executed', message: both(`Protected operation #${next.index} executed from ${module} (no co-signature at execution — compliance review)`, `Opération protégée n°${next.index} exécutée depuis ${module} (sans co-signature à l’exécution — revue conformité)`), txHash });
      return { txHash, explorer: explorerTx(txHash) };
    }),
  );

  /** Compliance console: pending protected operations of every protected wallet. */
  app.get(
    '/admin/protection/pending',
    route(async () => {
      const out = [];
      for (const [clientId, w] of Object.entries(store.data.wallets)) {
        try {
          const [d1, d2] = await Promise.all([readDelayQueue(provider, w.d1, { withTxs: true, fromBlock: w.fromBlock }), readDelayQueue(provider, w.d2, { withTxs: true, fromBlock: w.fromBlock })]);
          if (d1.pending.length || d2.pending.length) out.push({ clientId, safeAddress: w.safeAddress, d1, d2, label: 'Compliance review' });
        } catch (e) {
          out.push({ clientId, safeAddress: w.safeAddress, error: shortErr(e) });
        }
      }
      return out;
    }),
  );
}
