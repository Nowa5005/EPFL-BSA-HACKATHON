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
import { getAddress } from 'ethers';
import { JsonStore, nowIso, t } from '@sq/shared/server';
import { parseShare2Record, type SecurityKeyShare } from '@sq/shared';
import { db, getClient, HttpError, logActivity } from './db';
import { DATA_DIR } from './paths';

type Route = (fn: (req: Request, res: Response) => unknown) => any;

export type Share2Entry =
  | { method: 'security-key'; safeAddress: string; record: SecurityKeyShare; storedAt: string }
  | { method: 'offline-password'; safeAddress: string; storedAt: string };

interface KitDb {
  clients: Record<string, { share2?: Share2Entry }>;
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
}
