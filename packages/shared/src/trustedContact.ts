// #14 — Trusted contact (Shamir 2-of-4) + recovery health check.
//
// Adding a trusted contact gives the recovery key a 4th holder: ① paper code · ② security key · ③ partner ·
// ④ trusted contact; any 2 rebuild it. As for N2's "Replace my recovery kit", the client does NOT re-split the same K3
// (old paper code + old part ② would still rebuild it): a NEW recovery key K3′ is generated on the device, split
// 2-of-4, and swapped on-chain (K1 + K2, recoveryRotation.ts). Every old part then rebuilds a key that owns nothing.
//
// The contact's part travels through a simulated invitation link: the device encrypts it with a random one-time
// AES-256-GCM key that is put ONLY in the link's #fragment (never sent to any server). Swissquote stores the
// ciphertext until the contact opens the link and re-protects the part with their own passkey (WebAuthn PRF — the
// same record format as part ②) or a passphrase-protected offline file. Swissquote never sees the part in clear.
//
// Standard primitives only (Shamir library, WebCrypto AES-GCM). Encoding glue only.

import { getAddress, getBytes, hexlify, toUtf8Bytes } from 'ethers';

/** Labels of the 2-of-4 split once a trusted contact is added. */
export const CONTACT_SHARE_ORDER = ['paper', 'key', 'partner', 'contact'] as const;
export type ContactShareLabel = (typeof CONTACT_SHARE_ORDER)[number];

const INVITE_KIND = 'mywall-trusted-contact-invite';
const subtle = () => globalThis.crypto.subtle;
const aad = (safeAddress: string) => toUtf8Bytes(`${INVITE_KIND}|v1|${getAddress(safeAddress)}`);
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export interface SealedInvitation {
  iv: string;
  ciphertext: string;
}

/** Encrypts the contact's part for the invitation. `inviteKey` (base64url) goes in the link fragment only. */
export async function sealInvitation(safeAddress: string, share: string): Promise<SealedInvitation & { inviteKey: string }> {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(safeAddress) as BufferSource }, key, getBytes(share) as BufferSource);
  const inviteKey = b64url(raw);
  raw.fill(0);
  return { iv: hexlify(iv), ciphertext: hexlify(new Uint8Array(ct)), inviteKey };
}

export async function openInvitation(safeAddress: string, sealed: SealedInvitation, inviteKey: string): Promise<string> {
  try {
    const raw = fromB64url(inviteKey);
    if (raw.length !== 32) throw new Error();
    const key = await subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(sealed.iv) as BufferSource, additionalData: aad(safeAddress) as BufferSource }, key, getBytes(sealed.ciphertext) as BufferSource);
    return hexlify(new Uint8Array(pt));
  } catch {
    throw new Error('This invitation link is incomplete or was altered');
  }
}

/** Invitation link (simulated e-mail). The key is in the #fragment: browsers never send it to the server. */
export const invitationLink = (origin: string, token: string, inviteKey: string) => `${origin}/trusted/${encodeURIComponent(token)}#k=${inviteKey}`;

// ───────────── Recovery health check ─────────────

/** Production: every 6 months. Demo default: 24 h (env RECOVERY_HEALTH_PERIOD_SEC on the co-signer). */
export const RECOVERY_HEALTH_PERIOD_PROD_MS = 182 * 24 * 3600_000;
export const RECOVERY_HEALTH_PERIOD_DEMO_MS = 24 * 3600_000;

export interface RecoveryHealthInput {
  /** Last successful check of each part (ISO), if any. */
  paperVerifiedAt?: string | null;
  keyVerifiedAt?: string | null;
  contactConfirmedAt?: string | null;
  /** How part ② is held. */
  share2Method?: 'security-key' | 'offline-password' | null;
  /** Trusted contact: none, invited (not accepted yet), accepted (current split), outdated (kit replaced since). */
  contact: 'none' | 'invited' | 'accepted' | 'outdated';
  /** The independent partner holds a current part ③. */
  partnerEnrolled: boolean;
  /** When the current recovery kit was created (wallet creation or last replacement). */
  kitSince?: string | null;
}

export interface RecoveryHealthReason {
  part: 'paper' | 'key' | 'partner' | 'contact';
  ok: boolean;
  en: string;
  fr: string;
}

export interface RecoveryHealth {
  score: 'strong' | 'weak';
  /** Parts known to work (checked within the period, or held by the partner). Strong = 3 or more: any one can be lost. */
  workingParts: number;
  reasons: RecoveryHealthReason[];
  lastCheckAt: string | null;
  dueAt: string | null;
  due: boolean;
}

const recent = (iso: string | null | undefined, now: number, period: number) => !!iso && now - new Date(iso).getTime() <= period && (iso ?? '') !== '';

/**
 * Score: "Strong" when at least 3 of the 4 possible parts are known to work — then losing any ONE of them still leaves
 * 2, enough to recover. Otherwise "Weak", with the reasons. A check older than the period no longer counts.
 */
export function assessRecoveryHealth(h: RecoveryHealthInput, now = Date.now(), period = RECOVERY_HEALTH_PERIOD_PROD_MS): RecoveryHealth {
  const after = (iso?: string | null) => (iso && h.kitSince && new Date(iso) < new Date(h.kitSince) ? null : iso ?? null); // checks of a former kit don't count
  const paper = recent(after(h.paperVerifiedAt), now, period);
  const key = recent(after(h.keyVerifiedAt), now, period);
  const contact = h.contact === 'accepted' && recent(after(h.contactConfirmedAt), now, period);
  const reasons: RecoveryHealthReason[] = [
    paper
      ? { part: 'paper', ok: true, en: 'Paper code ① checked recently', fr: 'Code papier ① vérifié récemment' }
      : { part: 'paper', ok: false, en: 'Paper code ① not checked in the last period — check that you still have it and that it is readable', fr: 'Code papier ① non vérifié sur la dernière période — vérifiez que vous l’avez toujours et qu’il est lisible' },
    key
      ? { part: 'key', ok: true, en: h.share2Method === 'offline-password' ? 'Offline file ② and its backup password checked recently' : 'Security key ② checked recently', fr: h.share2Method === 'offline-password' ? 'Fichier hors ligne ② et son mot de passe de sauvegarde vérifiés récemment' : 'Clé de sécurité ② vérifiée récemment' }
      : h.share2Method === 'offline-password'
        ? { part: 'key', ok: false, en: 'Offline file ② / backup password not checked in the last period', fr: 'Fichier hors ligne ② / mot de passe de sauvegarde non vérifiés sur la dernière période' }
        : h.share2Method === 'security-key'
          ? { part: 'key', ok: false, en: 'Security key ② not checked in the last period', fr: 'Clé de sécurité ② non vérifiée sur la dernière période' }
          : { part: 'key', ok: false, en: 'Part ② is not set up (former cloud backup): replace your recovery kit', fr: 'La partie ② n’est pas configurée (ancienne sauvegarde cloud) : remplacez votre kit de récupération' },
    h.partnerEnrolled
      ? { part: 'partner', ok: true, en: 'Recovery partner ③ holds its part (released after identity checks)', fr: 'Le partenaire ③ détient sa partie (libérée après vérification d’identité)' }
      : { part: 'partner', ok: false, en: 'The recovery partner ③ has no current part', fr: 'Le partenaire ③ n’a pas de partie à jour' },
    contact
      ? { part: 'contact', ok: true, en: 'Trusted contact ④ confirmed', fr: 'Contact de confiance ④ confirmé' }
      : h.contact === 'none'
        ? { part: 'contact', ok: false, en: 'No trusted contact ④: if you lose both your paper code and your security key, the partner alone cannot restore access', fr: 'Pas de contact de confiance ④ : si vous perdez à la fois votre code papier et votre clé de sécurité, le partenaire seul ne peut pas rétablir l’accès' }
        : h.contact === 'invited'
          ? { part: 'contact', ok: false, en: 'Trusted contact ④ has not accepted the invitation yet', fr: 'Le contact de confiance ④ n’a pas encore accepté l’invitation' }
          : h.contact === 'outdated'
            ? { part: 'contact', ok: false, en: 'Trusted contact ④ holds a part of a former kit: add them again', fr: 'Le contact de confiance ④ détient une partie d’un ancien kit : ajoutez-le à nouveau' }
            : { part: 'contact', ok: false, en: 'Trusted contact ④ not confirmed in the last period', fr: 'Contact de confiance ④ non confirmé sur la dernière période' },
  ];
  const workingParts = reasons.filter((r) => r.ok).length;
  const checks = [after(h.paperVerifiedAt), after(h.keyVerifiedAt), h.contact === 'accepted' ? after(h.contactConfirmedAt) : null, h.kitSince ?? null].filter((x): x is string => !!x);
  const lastCheckAt = checks.length ? checks.reduce((a, b) => (a > b ? a : b)) : null;
  const dueAt = lastCheckAt ? new Date(new Date(lastCheckAt).getTime() + period).toISOString() : null;
  return { score: workingParts >= 3 ? 'strong' : 'weak', workingParts, reasons, lastCheckAt, dueAt, due: !dueAt || new Date(dueAt).getTime() <= now };
}
