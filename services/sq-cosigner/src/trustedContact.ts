// #14 — Trusted contact (recovery key split 2-of-4) and recovery health check.
//
// Trusted contact. The client's device generates a NEW recovery key K3′, splits it 2-of-4 (paper · security key ·
// partner · contact) and swaps K3 → K3′ on-chain through the existing recovery-kit rotation (recoveryKit.ts, K1 + K2).
// Before the swap it registers here an INVITATION: the contact's part encrypted with a one-time key that only exists in
// the invitation link's #fragment (simulated e-mail, never sent to a server). Swissquote stores:
//   · the invitation ciphertext until the contact accepts (then deleted);
//   · after acceptance, only what the contact chose: their passkey-protected record (WebAuthn PRF ciphertext — the same
//     format as part ②; unreadable without the contact's authenticator) or just "offline file" (the passphrase file
//     stays with the contact: a passphrase ciphertext here would allow offline guessing by the service).
// The invitation is bound to K3′'s address: it is valid only while K3′ is the wallet's recovery owner — a kit replaced
// again later makes it "outdated" automatically. The contact page is reached with an unguessable token (only its
// SHA-256 is stored), listed as a public route.
//
// Recovery health check. Every 6 months (demo 24 h, RECOVERY_HEALTH_PERIOD_SEC) the client is reminded (in-app
// notification) to check: the paper code (typed, checksum-validated on the device, then only its SHA-256 is compared
// by the recovery partner, which already holds that commitment — the code is never revealed nor stored), part ② (security
// key touch, or offline file + backup password, same hash comparison), and the trusted contact. Score: Strong / Weak.

import type { Express, Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { JsonStore, internalHeaders, nowIso, t } from '@sq/shared/server';
import { RECOVERY_HEALTH_PERIOD_DEMO_MS, SERVICE_URLS, assessRecoveryHealth, both, parseShare2Record, type SecurityKeyShare } from '@sq/shared';
import { db, getClient, HttpError, logActivity, notify } from './db';
import { DATA_DIR } from './paths';
import { currentShare2, kitStore } from './recoveryKit';

const PARTNER_URL = process.env.PARTNER_URL ?? SERVICE_URLS.partner;
const INVITE_TTL_MS = 7 * 24 * 3600_000;
export const RECOVERY_HEALTH_PERIOD_MS = Number(process.env.RECOVERY_HEALTH_PERIOD_SEC) > 0 ? Number(process.env.RECOVERY_HEALTH_PERIOD_SEC) * 1000 : RECOVERY_HEALTH_PERIOD_DEMO_MS;

type Route = (fn: (req: Request, res: Response) => unknown) => any;

interface Contact {
  name: string;
  /** K3′ address this split belongs to: the contact's part is valid only while it is the wallet's recovery owner. */
  recoveryAddress: string;
  tokenHash: string;
  createdAt: string;
  invite?: { iv: string; ciphertext: string; expiresAt: string };
  acceptedAt?: string;
  method?: 'security-key' | 'offline-password';
  record?: SecurityKeyShare;
}
interface Health {
  paperVerifiedAt?: string;
  keyVerifiedAt?: string;
  contactConfirmedAt?: string;
  remindedFor?: string;
}
interface TcDb {
  clients: Record<string, { contact?: Contact; health?: Health }>;
  /** When reminders started: wallets older than this get their first reminder one period later, not at once. */
  remindersSince?: string;
}

export const tcStore = new JsonStore<TcDb>(DATA_DIR, 'trustedcontact', () => ({ clients: {}, remindersSince: nowIso() }));
if (!tcStore.data.remindersSince) tcStore.update((d) => (d.remindersSince = nowIso()));

const hashToken = (tok: string) => createHash('sha256').update(tok).digest('hex');
const HEX = (n: number) => new RegExp(`^0x[0-9a-fA-F]{${n}}$`);

export type ContactStatus = 'none' | 'invited' | 'accepted' | 'outdated';
function contactStatus(clientId: string): ContactStatus {
  const ct = tcStore.data.clients[clientId]?.contact;
  if (!ct) return 'none';
  const rec = db.data.clients[clientId]?.owners?.recovery;
  if (!rec || getAddress(rec) !== getAddress(ct.recoveryAddress)) return 'outdated';
  return ct.acceptedAt ? 'accepted' : 'invited';
}

const contactView = (clientId: string) => {
  const ct = tcStore.data.clients[clientId]?.contact;
  const status = contactStatus(clientId);
  if (!ct) return { status };
  return { status, name: ct.name, createdAt: ct.createdAt, acceptedAt: ct.acceptedAt ?? null, method: ct.method ?? null, inviteExpiresAt: ct.invite?.expiresAt ?? null };
};

function kitSince(clientId: string): string | null {
  const rots = kitStore.data.clients[clientId]?.rotations ?? [];
  if (rots.length) return rots[rots.length - 1].at;
  const devs = db.data.clients[clientId]?.devices ?? [];
  return devs.map((d) => d.createdAt).sort()[0] ?? null;
}

export function recoveryHealth(clientId: string, now = Date.now()) {
  const h = tcStore.data.clients[clientId]?.health ?? {};
  const s2 = currentShare2(clientId);
  return {
    ...assessRecoveryHealth(
      {
        paperVerifiedAt: h.paperVerifiedAt,
        keyVerifiedAt: h.keyVerifiedAt,
        contactConfirmedAt: h.contactConfirmedAt,
        share2Method: s2?.method ?? null,
        contact: contactStatus(clientId),
        partnerEnrolled: !!db.data.clients[clientId]?.safeAddress,
        kitSince: kitSince(clientId),
      },
      now,
      RECOVERY_HEALTH_PERIOD_MS,
    ),
    periodSec: Math.round(RECOVERY_HEALTH_PERIOD_MS / 1000),
    contact: contactView(clientId),
  };
}

/** Public-route lookup by token. */
function byToken(token: string): { clientId: string; ct: Contact } {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new HttpError(404, t('Unknown or expired link', 'Lien inconnu ou expiré'));
  const h = hashToken(token);
  for (const [clientId, v] of Object.entries(tcStore.data.clients)) if (v.contact?.tokenHash === h) return { clientId, ct: v.contact };
  throw new HttpError(404, t('Unknown or expired link', 'Lien inconnu ou expiré'));
}

const setHealth = (clientId: string, patch: Partial<Health>) => tcStore.update((d) => (d.clients[clientId] = { ...d.clients[clientId], health: { ...d.clients[clientId]?.health, ...patch } }));

export function registerTrustedContactRoutes(app: Express, route: Route) {
  app.get(
    '/clients/:id/trusted-contact',
    route((req) => contactView(getClient(String(req.params.id)).clientId)),
  );

  /**
   * Called by the device just BEFORE the on-chain rotation to K3′: stores the invitation (contact's part encrypted with
   * a key the server never sees). Valid only once K3′ is the wallet's recovery owner.
   */
  app.post(
    '/clients/:id/trusted-contact/invitation',
    route((req) => {
      const c = getClient(String(req.params.id));
      if (!c.safeAddress || !c.owners) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
      const name = String(req.body?.name ?? '').trim();
      const { recoveryAddress, iv, ciphertext } = req.body ?? {};
      if (name.length < 2 || name.length > 60 || /[<>]/.test(name)) throw new HttpError(400, t('Enter the name of your trusted contact (2 to 60 characters).', 'Saisissez le nom de votre contact de confiance (2 à 60 caractères).'));
      if (typeof recoveryAddress !== 'string' || !isAddress(recoveryAddress)) throw new HttpError(400, t('Invalid new recovery key', 'Nouvelle clé de secours invalide'));
      if (getAddress(recoveryAddress) === getAddress(c.owners.recovery)) throw new HttpError(400, t('A trusted contact needs a NEW recovery key (the old parts must be retired).', 'Un contact de confiance exige une NOUVELLE clé de secours (les anciennes parties doivent être retirées).'));
      if (!HEX(12).test(String(iv)) || !/^0x[0-9a-fA-F]{66,200}$/.test(String(ciphertext))) throw new HttpError(400, t('Invalid invitation data', 'Données d’invitation invalides'));
      const token = randomBytes(32).toString('base64url');
      const contact: Contact = { name, recoveryAddress: getAddress(recoveryAddress), tokenHash: hashToken(token), createdAt: nowIso(), invite: { iv, ciphertext, expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() } };
      tcStore.update((d) => (d.clients[c.clientId] = { ...d.clients[c.clientId], contact }));
      return { token, expiresAt: contact.invite!.expiresAt };
    }),
  );

  /** Called right after the rotation succeeded: the invitation becomes active (status derived from the on-chain owner). */
  app.post(
    '/clients/:id/trusted-contact/sent',
    route((req) => {
      const c = getClient(String(req.params.id));
      const ct = tcStore.data.clients[c.clientId]?.contact;
      if (!ct || contactStatus(c.clientId) !== 'invited') throw new HttpError(409, t('No pending invitation', 'Aucune invitation en attente'));
      logActivity({ clientId: c.clientId, actor: 'client', type: 'trusted-contact.invited', message: both(`Trusted contact invited: ${ct.name} (recovery key now split 2-of-4)`, `Contact de confiance invité : ${ct.name} (clé de secours désormais découpée 2 sur 4)`) });
      notify({
        clientId: c.clientId,
        channel: 'email',
        subject: both('You added a trusted contact', 'Vous avez ajouté un contact de confiance'),
        body: both(
          `${ct.name} can now help you recover your wallet together with the recovery partner. Send them the invitation link yourself (in this prototype no e-mail is sent). If this wasn't you, contact Swissquote.`,
          `${ct.name} peut désormais vous aider à récupérer votre wallet avec le partenaire de récupération. Transmettez-lui vous-même le lien d’invitation (ce prototype n’envoie aucun e-mail). Si ce n’est pas vous, contactez Swissquote.`,
        ),
      });
      return contactView(c.clientId);
    }),
  );

  app.post(
    '/clients/:id/trusted-contact/remove',
    route((req) => {
      const c = getClient(String(req.params.id));
      const ct = tcStore.data.clients[c.clientId]?.contact;
      if (!ct) return { status: 'none' };
      tcStore.update((d) => {
        delete d.clients[c.clientId].contact;
        if (d.clients[c.clientId].health) delete d.clients[c.clientId].health!.contactConfirmedAt;
      });
      logActivity({
        clientId: c.clientId,
        actor: 'client',
        type: 'trusted-contact.removed',
        message: both(
          `Trusted contact removed (${ct.name}). Their part still fits the current recovery key until you replace your recovery kit.`,
          `Contact de confiance retiré (${ct.name}). Sa partie correspond encore à la clé de secours actuelle jusqu’au remplacement de votre kit de récupération.`,
        ),
      });
      return { status: 'none' };
    }),
  );

  // ── Contact side (public, token-gated: the contact has no Swissquote account) ──
  app.get(
    '/trusted/:token',
    route((req) => {
      const { clientId, ct } = byToken(String(req.params.token));
      const c = getClient(clientId);
      const status = contactStatus(clientId);
      const expired = !!ct.invite && new Date(ct.invite.expiresAt) < new Date();
      return {
        status: expired && status === 'invited' ? 'expired' : status,
        clientFirstName: String(c.name ?? '').split(' ')[0],
        contactName: ct.name,
        safeAddress: c.safeAddress,
        invite: status === 'invited' && !expired ? { iv: ct.invite!.iv, ciphertext: ct.invite!.ciphertext } : null,
        method: ct.method ?? null,
        record: status === 'accepted' && ct.method === 'security-key' ? ct.record : null,
      };
    }),
  );

  app.post(
    '/trusted/:token/accept',
    route((req) => {
      const { clientId, ct } = byToken(String(req.params.token));
      const c = getClient(clientId);
      if (contactStatus(clientId) !== 'invited' || !ct.invite || new Date(ct.invite.expiresAt) < new Date()) throw new HttpError(409, t('This invitation is no longer valid.', 'Cette invitation n’est plus valable.'));
      let method: Contact['method'];
      let record: SecurityKeyShare | undefined;
      if (req.body?.method === 'offline-password') method = 'offline-password';
      else {
        let r;
        try {
          r = parseShare2Record(req.body?.record);
        } catch {
          throw new HttpError(400, t('Invalid protected part', 'Partie protégée invalide'));
        }
        if (r.method !== 'security-key') throw new HttpError(400, t('A passphrase file is never sent to Swissquote', 'Un fichier protégé par phrase secrète n’est jamais envoyé à Swissquote'));
        if (getAddress(r.safeAddress) !== getAddress(c.safeAddress!)) throw new HttpError(400, t('This part belongs to another wallet', 'Cette partie appartient à un autre wallet'));
        method = 'security-key';
        record = r;
      }
      tcStore.update((d) => {
        const x = d.clients[clientId].contact!;
        delete x.invite; // the invitation ciphertext is no longer needed
        Object.assign(x, { acceptedAt: nowIso(), method, ...(record ? { record } : {}) });
      });
      logActivity({ clientId, actor: 'system', type: 'trusted-contact.accepted', message: both(`${ct.name} accepted to be your trusted contact`, `${ct.name} a accepté d’être votre contact de confiance`) });
      notify({
        clientId,
        channel: 'app',
        subject: both('Trusted contact confirmed', 'Contact de confiance confirmé'),
        body: both(`${ct.name} protected their part of your recovery key (${method === 'security-key' ? 'with their passkey' : 'in an offline file'}).`, `${ct.name} a protégé sa partie de votre clé de secours (${method === 'security-key' ? 'avec sa passkey' : 'dans un fichier hors ligne'}).`),
      });
      return { accepted: true, method };
    }),
  );

  // ── Recovery health check ──
  app.get(
    '/clients/:id/recovery-health',
    route((req) => recoveryHealth(getClient(String(req.params.id)).clientId)),
  );

  /** The device sends only the SHA-256 of the part it checked; the partner (which holds the commitments) compares. */
  app.post(
    '/clients/:id/recovery-health/verify',
    route(async (req) => {
      const c = getClient(String(req.params.id));
      const kind = String(req.body?.kind ?? '');
      if (kind === 'contact-confirm') {
        if (contactStatus(c.clientId) !== 'accepted') throw new HttpError(409, t('Your trusted contact has not accepted yet (or belongs to a former kit).', 'Votre contact de confiance n’a pas encore accepté (ou appartient à un ancien kit).'));
        setHealth(c.clientId, { contactConfirmedAt: nowIso() });
        return { match: true, health: recoveryHealth(c.clientId) };
      }
      if (kind !== 'paper' && kind !== 'key') throw new HttpError(400, t('Invalid part', 'Partie invalide'));
      const commitment = String(req.body?.commitment ?? '');
      if (!HEX(64).test(commitment)) throw new HttpError(400, t('Invalid part', 'Partie invalide'));
      const res = await fetch(`${PARTNER_URL}/shares/${encodeURIComponent(c.clientId)}/verify`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ kind, commitment: commitment.toLowerCase() }) }).catch(() => null);
      if (!res?.ok) throw new HttpError(502, t('The recovery partner cannot be reached: try again later.', 'Le partenaire de récupération est injoignable : réessayez plus tard.'));
      const { match } = (await res.json()) as { match: boolean };
      if (match) setHealth(c.clientId, kind === 'paper' ? { paperVerifiedAt: nowIso() } : { keyVerifiedAt: nowIso() });
      return { match, health: recoveryHealth(c.clientId) };
    }),
  );
}

/** In-app reminder once per period when the check is due (scan every minute). */
export function startRecoveryHealthReminders() {
  const tick = () => {
    for (const c of Object.values(db.data.clients)) {
      if (!c.safeAddress || c.headless) continue;
      const h = recoveryHealth(c.clientId);
      const since = [h.lastCheckAt, tcStore.data.remindersSince].filter((x): x is string => !!x).reduce((a, b) => (a > b ? a : b), '');
      if (!since || new Date(since).getTime() + RECOVERY_HEALTH_PERIOD_MS > Date.now()) continue;
      const key = h.dueAt ?? since;
      if (tcStore.data.clients[c.clientId]?.health?.remindedFor === key) continue;
      setHealth(c.clientId, { remindedFor: key });
      notify({
        clientId: c.clientId,
        channel: 'app',
        subject: both('Time for your recovery health check', 'C’est l’heure du bilan de votre récupération'),
        body: both(
          `Recovery: ${h.score === 'strong' ? 'Strong' : 'Weak'}. Take 2 minutes in My Wall → Security → Recovery health check: check your paper code, your security key (or offline file) and your trusted contact.`,
          `Récupération : ${h.score === 'strong' ? 'solide' : 'fragile'}. Prenez 2 minutes dans My Wall → Sécurité → Bilan de santé de la récupération : vérifiez votre code papier, votre clé de sécurité (ou fichier hors ligne) et votre contact de confiance.`,
        ),
      });
    }
  };
  setTimeout(tick, 15_000);
  return setInterval(tick, 60_000);
}
