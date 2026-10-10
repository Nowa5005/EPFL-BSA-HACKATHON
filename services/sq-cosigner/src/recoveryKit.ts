// Recovery kit — part ② of the recovery key K3 (no cloud backup).
//
// Swissquote (this co-signer service) stores the CIPHERTEXT of share ② when the client protects it with a
// physical security key (WebAuthn PRF): without that key, present and touched, the record is unreadable.
// Why here and not at the recovery partner: the partner holds share ③; holding share ② as well — even
// encrypted — would concentrate two of the three parts at one party. Swissquote holds K2, which is not a K3 share.
// The offline-file fallback (password-encrypted) is NEVER stored by Swissquote (that would allow offline
// password guessing): only the fact that the client chose it.
//
// Storage: own JSON file (data/recoverykit.json, git-ignored); all routes are under /clients/:id/... so the shared
// auth guard restricts them to the client's own session.

import type { Express, Request, Response } from 'express';
import { Contract, ZeroAddress, getAddress, isAddress } from 'ethers';
import { JsonStore, internalHeaders, nowIso, t } from '@sq/shared/server';
import { SERVICE_URLS, both, explorerTx, parseShare2Record, type SafeTx, type SecurityKeyShare } from '@sq/shared';
import { db, getClient, HttpError, logActivity, notify } from './db';
import { DATA_DIR } from './paths';
import { checkedSafeTxHash, cosignAndExecute, provider, recoverSigner, safeState, shortErr } from './chain';
import { validateSafeTx } from './validate';
import { DELAY_ABI, SAFE_MULTISEND_CALL_ONLY, readProtection } from '@sq/shared/protection';
import { MODULE_SENTINEL, buildRecoveryKeyRotation, type RotationProtection } from './recoveryRotation';
import { authOptionsForHash, verifyAssertion } from './webauthn';

const PARTNER_URL = process.env.PARTNER_URL ?? SERVICE_URLS.partner;
const ROTATION_TTL_MS = 10 * 60_000;

type Route = (fn: (req: Request, res: Response) => unknown) => any;

export type Share2Entry =
  | { method: 'security-key'; safeAddress: string; record: SecurityKeyShare; storedAt: string }
  | { method: 'offline-password'; safeAddress: string; storedAt: string };

interface PendingRotation {
  safeTx: SafeTx;
  safeTxHash: string;
  oldRecoveryAddress: string;
  newRecoveryAddress: string;
  /** Batch (protected wallet) or plain swapOwner. */
  protected?: boolean;
  expiresAt: string;
}
interface KitDb {
  clients: Record<
    string,
    {
      share2?: Share2Entry;
      rotation?: PendingRotation;
      /** Partner share ③ staged for the new recovery key, still to be activated (retry after a partner outage). */
      partnerPending?: { stageId: string; safeAddress: string };
      rotations?: { at: string; txHash: string; oldRecoveryAddress: string; newRecoveryAddress: string }[];
    }
  >;
}

export const kitStore = new JsonStore<KitDb>(DATA_DIR, 'recoverykit', () => ({ clients: {} }));

/** Validates what the client sends for part ②: a security-key ciphertext record, or the offline-file choice only. */
export function parseShare2Entry(body: any, safeAddress: string): Share2Entry {
  if (body?.method === 'offline-password') return { method: 'offline-password', safeAddress: getAddress(safeAddress), storedAt: nowIso() };
  let record;
  try {
    record = parseShare2Record(body?.record);
  } catch {
    throw new HttpError(400, t('Invalid recovery-key part ② record', 'Partie ② de la clé de secours invalide'));
  }
  if (record.method !== 'security-key') throw new HttpError(400, t('The offline backup file is never sent to Swissquote', "Le fichier de sauvegarde hors ligne n'est jamais envoyé à Swissquote"));
  if (getAddress(record.safeAddress) !== getAddress(safeAddress)) throw new HttpError(400, t('This part ② belongs to another wallet', 'Cette partie ② appartient à un autre wallet'));
  return { method: 'security-key', safeAddress: getAddress(safeAddress), record, storedAt: nowIso() };
}

/** The client's current part ② entry — ignored when it belongs to another (e.g. reset demo) wallet. */
export function currentShare2(clientId: string): Share2Entry | undefined {
  const c = db.data.clients[clientId];
  const e = kitStore.data.clients[clientId]?.share2;
  if (!e || !c?.safeAddress || getAddress(e.safeAddress ?? '0x0000000000000000000000000000000000000000') !== getAddress(c.safeAddress)) return undefined;
  return e;
}

export const share2View = (e?: Share2Entry) => (!e ? null : e.method === 'security-key' ? { method: e.method, storedAt: e.storedAt, record: e.record } : { method: e.method, storedAt: e.storedAt });

export function registerRecoveryKitRoutes(app: Express, route: Route) {
  /** The client's own part ② (ciphertext only) — needed on a new device to decrypt it with the security key. */
  app.get(
    '/clients/:id/recovery-kit',
    route((req) => {
      const c = getClient(String(req.params.id));
      const e = currentShare2(c.clientId);
      return { safeAddress: c.safeAddress ?? null, recoveryAddress: c.owners?.recovery ?? null, share2: share2View(e) };
    }),
  );

  /** First registration of part ② (wallet creation). Replacing it later goes through the recovery-key rotation. */
  app.post(
    '/clients/:id/recovery-kit/share2',
    route((req) => {
      const c = getClient(String(req.params.id));
      if (!c.safeAddress) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
      if (currentShare2(c.clientId))
        throw new HttpError(409, t('Part ② is already registered. Use “Replace my recovery kit” in Security.', 'La partie ② est déjà enregistrée. Utilisez « Remplacer mon kit de récupération » dans Sécurité.'));
      const entry = parseShare2Entry(req.body, c.safeAddress);
      kitStore.update((d) => (d.clients[c.clientId] = { ...d.clients[c.clientId], share2: entry }));
      logActivity({
        clientId: c.clientId,
        actor: 'client',
        type: 'recovery-kit.share2',
        message:
          entry.method === 'security-key'
            ? { en: 'Recovery key part ② protected by your security key (Swissquote stores only unreadable ciphertext)', fr: 'Partie ② de la clé de secours protégée par votre clé de sécurité (Swissquote ne stocke qu’un chiffré illisible)' }
            : { en: 'Recovery key part ② saved as an offline encrypted file (kept by you, never sent to Swissquote)', fr: 'Partie ② de la clé de secours enregistrée en fichier chiffré hors ligne (conservé par vous, jamais envoyé à Swissquote)' },
      });
      return { stored: true, share2: share2View(entry) };
    }),
  );

  // ───────────── Replace the recovery kit (and retire the former cloud backup) ─────────────
  // Re-splitting K3 alone would NOT retire old shares: the old paper code + old part ② would still rebuild the same
  // K3. So the client generates a NEW recovery key K3′ on the device, splits it (new paper code, new security-key
  // part, new partner share), and the wallet's owner K3 → K3′ is swapped ON-CHAIN by device key K1 + Swissquote K2
  // (the normal immediate combination). Every old share, file or code then rebuilds a key that owns nothing.

  /** Step 1: the exact swapOwner(K3 → K3′) transaction, and a passkey challenge bound to its hash. */
  app.post(
    '/clients/:id/recovery-kit/rotation/prepare',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      if (!c.safeAddress || !c.owners) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
      if (c.frozen) throw new HttpError(423, t('Co-signing is frozen for this wallet', 'La co-signature est gelée pour ce wallet'));
      const newRec = String(req.body?.newRecoveryAddress ?? '');
      if (!isAddress(newRec) || getAddress(newRec) === ZeroAddress) throw new HttpError(400, t('Invalid new recovery key', 'Nouvelle clé de secours invalide'));
      if (Object.values(db.data.recoveries).some((r) => r.clientId === c.clientId && ['pending-delay', 'executing'].includes(r.status)))
        throw new HttpError(409, t('A recovery is in progress: finish or cancel it first.', 'Une récupération est en cours : terminez-la ou annulez-la d’abord.'));
      const state = await safeState(c.safeAddress);
      const oldRec = getAddress(c.owners.recovery);
      const next = getAddress(newRec);
      if (!state.owners.includes(oldRec)) throw new HttpError(409, t('The recovery key on the blockchain does not match our records', 'La clé de secours sur la blockchain ne correspond pas à nos données'));
      if (state.owners.includes(next)) throw new HttpError(400, t('This key is already an owner of the wallet', 'Cette clé est déjà propriétaire du wallet'));
      const prot = await readProtection(provider, c.safeAddress);
      if (prot.guard && !prot.config) throw new HttpError(409, t('Unknown guard on this wallet: replacement refused', 'Guard inconnu sur ce wallet : remplacement refusé'));
      let protection: RotationProtection | null = null;
      if (prot.config) {
        const d2Modules = prot.config.d2 && getAddress(prot.config.d2) !== ZeroAddress ? [...((await new Contract(prot.config.d2, DELAY_ABI, provider).getModulesPaginated(MODULE_SENTINEL, 20)) as [string[], string])[0]] : [];
        protection = { guard: prot.guard!, config: prot.config, d2Modules };
      }
      let safeTx: SafeTx;
      try {
        safeTx = buildRecoveryKeyRotation({ safe: c.safeAddress, owners: state.owners, oldK3: oldRec, newK3: next, nonce: state.nonce, protection });
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      const safeTxHash = await checkedSafeTxHash(c.safeAddress, safeTx);
      const rotation: PendingRotation = { safeTx, safeTxHash, oldRecoveryAddress: oldRec, newRecoveryAddress: next, protected: !!prot.config, expiresAt: new Date(Date.now() + ROTATION_TTL_MS).toISOString() };
      kitStore.update((d) => (d.clients[c.clientId] = { ...d.clients[c.clientId], rotation }));
      return { safeTx, safeTxHash, authOptions: c.headless ? null : await authOptionsForHash(c, safeTxHash) };
    }),
  );

  /** Step 2: passkey + K1 signature → K2 co-signs and the relayer executes; then part ② and the partner share are activated. */
  app.post(
    '/clients/:id/recovery-kit/rotation/submit',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const rot = kitStore.data.clients[c.clientId]?.rotation;
      if (!c.safeAddress || !c.owners || !rot) throw new HttpError(400, t('Nothing to confirm: start again.', 'Rien à confirmer : recommencez.'));
      if (new Date(rot.expiresAt) < new Date()) throw new HttpError(410, t('This confirmation expired: start again.', 'Cette confirmation a expiré : recommencez.'));
      const { signatureK1, webauthn, share2, partnerStageId } = req.body as { signatureK1: string; webauthn?: any; share2: unknown; partnerStageId: string };
      // 1. Passkey bound to this exact transaction, then the device key's signature.
      await verifyAssertion(c.clientId, webauthn, { hash: rot.safeTxHash });
      // The transaction was built by this service at /prepare and never comes from the client; re-check the plain case.
      if (!rot.protected) {
        const intent = validateSafeTx(rot.safeTx, c.safeAddress, { allowOwnerChange: true });
        if (intent.kind !== 'swap-owner' || intent.oldOwner !== rot.oldRecoveryAddress || intent.newOwner !== rot.newRecoveryAddress)
          throw new HttpError(409, t('The wallet changed in the meantime: start again.', 'Le wallet a changé entre-temps : recommencez.'));
      } else if (getAddress(rot.safeTx.to) !== getAddress(SAFE_MULTISEND_CALL_ONLY) || rot.safeTx.operation !== 1) throw new HttpError(409, t('Invalid batch', 'Lot invalide'));
      if (getAddress(c.owners.recovery) !== rot.oldRecoveryAddress) throw new HttpError(409, t('The wallet changed in the meantime: start again.', 'Le wallet a changé entre-temps : recommencez.'));
      let signer: string;
      try {
        signer = recoverSigner(c.safeAddress, rot.safeTx, String(signatureK1 ?? ''));
      } catch {
        throw new HttpError(401, t('Invalid device-key signature', 'Signature de la clé de l’appareil invalide'));
      }
      if (signer !== getAddress(c.owners.device)) throw new HttpError(401, t('Must be signed by this wallet’s device key', 'Doit être signé par la clé d’appareil de ce wallet'));
      // 2. The new part ② and the partner's staged share must be ready BEFORE anything changes on-chain.
      const entry = parseShare2Entry(share2, c.safeAddress);
      if (typeof partnerStageId !== 'string' || !partnerStageId) throw new HttpError(400, t('The new partner share is missing', 'La nouvelle part du partenaire manque'));
      const staged = await fetch(`${PARTNER_URL}/shares/${encodeURIComponent(c.clientId)}/staged/${encodeURIComponent(partnerStageId)}`, { headers: internalHeaders() }).catch(() => null);
      if (!staged?.ok) throw new HttpError(409, t('The recovery partner does not have the new share: start again.', 'Le partenaire de récupération n’a pas la nouvelle part : recommencez.'));
      // 3. K1 + K2 → swapOwner(K3 → K3′), executed immediately by the relayer.
      kitStore.update((d) => delete d.clients[c.clientId].rotation);
      const { txHash } = await cosignAndExecute(c.clientId, c.safeAddress, rot.safeTx, { signer, signature: signatureK1 }).catch((e) => {
        throw new HttpError(502, t(`Execution failed: ${shortErr(e)}`, `L'exécution a échoué : ${shortErr(e)}`));
      });
      db.update((d) => (d.clients[c.clientId].owners!.recovery = rot.newRecoveryAddress));
      kitStore.update((d) => {
        const k = d.clients[c.clientId];
        k.share2 = entry;
        k.partnerPending = { stageId: partnerStageId, safeAddress: c.safeAddress! };
        (k.rotations ??= []).push({ at: nowIso(), txHash, oldRecoveryAddress: rot.oldRecoveryAddress, newRecoveryAddress: rot.newRecoveryAddress });
      });
      const partnerCommitted = await commitPartner(c.clientId);
      logActivity({
        clientId: c.clientId,
        actor: 'client',
        type: 'recovery-kit.replaced',
        message: both(
          'Recovery kit replaced: new recovery key on the blockchain (device key + Swissquote). Old paper code, old part ② and old backup files are now useless.',
          'Kit de récupération remplacé : nouvelle clé de secours sur la blockchain (clé de l’appareil + Swissquote). L’ancien code papier, l’ancienne partie ② et les anciens fichiers de sauvegarde sont désormais inutiles.',
        ),
        txHash,
      });
      notify({
        clientId: c.clientId,
        channel: 'email',
        subject: both('Your recovery kit was replaced', 'Votre kit de récupération a été remplacé'),
        body: both(
          `Your wallet's recovery key was replaced on the blockchain (${explorerTx(txHash)}). If this wasn't you, contact Swissquote immediately.`,
          `La clé de secours de votre wallet a été remplacée sur la blockchain (${explorerTx(txHash)}). Si ce n'est pas vous, contactez Swissquote immédiatement.`,
        ),
      });
      return { txHash, explorer: explorerTx(txHash), recoveryAddress: rot.newRecoveryAddress, partnerCommitted };
    }),
  );

  /** Retry activating the partner's new share ③ (if the partner was unreachable right after the rotation). */
  app.post(
    '/clients/:id/recovery-kit/partner-commit',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      return { partnerCommitted: await commitPartner(c.clientId) };
    }),
  );
}

/** Activates the staged partner share (internal call). True when nothing is pending anymore. */
async function commitPartner(clientId: string): Promise<boolean> {
  const p = kitStore.data.clients[clientId]?.partnerPending;
  if (!p) return true;
  const res = await fetch(`${PARTNER_URL}/shares/${encodeURIComponent(clientId)}/commit`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({ stageId: p.stageId, safeAddress: p.safeAddress }),
  }).catch(() => null);
  if (!res?.ok) return false;
  kitStore.update((d) => delete d.clients[clientId].partnerPending);
  return true;
}
