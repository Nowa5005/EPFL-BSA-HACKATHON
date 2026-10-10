// Part ② of the recovery key, protected by a PHYSICAL SECURITY KEY (FIDO2, e.g. YubiKey) or a second device,
// through the WebAuthn PRF extension (CTAP2 hmac-secret). A dedicated credential is registered on that
// authenticator for this purpose only; the authenticator evaluates PRF(per-wallet salt) internally and the
// browser derives the AES key from it (packages/shared/src/recoveryShare2.ts). Decryption needs the key itself,
// present and touched. The ceremonies use @simplewebauthn/browser (v14 forwards `extensions` untouched and returns
// getClientExtensionResults() as-is, so `prf` works) through the native-app guard.

import { bufferToBase64URLString } from '@simplewebauthn/browser';
import { decryptShareWithPrf, encryptShareWithPrf, newPrfSalt, type SecurityKeyShare } from '@sq/shared';
import { getBytes } from 'ethers';
import { startAuthentication, startRegistration } from './passkeyGuard';
import { tr } from './i18n';

export class PrfUnsupportedError extends Error {
  constructor() {
    super(
      tr(
        'This security key or browser cannot protect a secret (the WebAuthn “PRF” / hmac-secret feature is missing). Use a recent FIDO2 key (e.g. YubiKey 5) in a recent Chrome, Edge or Safari — or the offline file option.',
        'Cette clé de sécurité ou ce navigateur ne peut pas protéger un secret (fonction WebAuthn « PRF » / hmac-secret absente). Utilisez une clé FIDO2 récente (ex. YubiKey 5) dans un Chrome, Edge ou Safari récent — ou l’option fichier hors ligne.',
      ),
    );
  }
}

export type PrfSupport = 'supported' | 'unsupported' | 'unknown';

/** Browser-level hint (WebAuthn L3 getClientCapabilities). The authenticator itself is only known when used. */
export async function prfSupport(): Promise<PrfSupport> {
  try {
    if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) return 'unsupported';
    const gcc = (PublicKeyCredential as any).getClientCapabilities;
    if (typeof gcc !== 'function') return 'unknown';
    const caps = await gcc.call(PublicKeyCredential);
    const v = caps?.['extension:prf'];
    return v === true ? 'supported' : v === false ? 'unsupported' : 'unknown';
  } catch {
    return 'unknown';
  }
}

const challenge = () => bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(32)).buffer);
const prfInput = (prfSaltHex: string) => ({ prf: { eval: { first: getBytes(prfSaltHex) } } });
const prfFirst = (ext: any): Uint8Array | null => {
  const first = ext?.prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first as ArrayBuffer);
};

/** Evaluates PRF on a registered security-key credential (asks for the key + touch). */
export async function evalSecurityKeyPrf(credentialId: string, prfSaltHex: string, transports?: string[]): Promise<Uint8Array> {
  const res = await startAuthentication({
    optionsJSON: {
      challenge: challenge(),
      rpId: window.location.hostname,
      allowCredentials: [{ id: credentialId, type: 'public-key', transports: transports as any }],
      userVerification: 'discouraged',
      timeout: 120_000,
      extensions: prfInput(prfSaltHex) as any,
    },
  });
  const out = prfFirst(res.clientExtensionResults);
  if (!out) throw new PrfUnsupportedError();
  return out;
}

/**
 * Registers a dedicated credential on the security key (or second device) with PRF, then encrypts `share` with
 * the derived key. Returns the ciphertext record — the only thing that ever leaves this browser.
 */
export async function protectShareWithSecurityKey(input: { safeAddress: string; share: string; clientId: string; userName: string }): Promise<SecurityKeyShare> {
  const prfSalt = newPrfSalt();
  const reg = await startRegistration({
    optionsJSON: {
      challenge: challenge(),
      rp: { name: 'My Wall recovery key', id: window.location.hostname },
      user: {
        id: bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(16)).buffer),
        name: `${input.userName} — My Wall recovery key ②`,
        displayName: `${input.userName} — My Wall recovery key ②`,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -8 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'discouraged' },
      attestation: 'none',
      timeout: 120_000,
      extensions: prfInput(prfSalt) as any,
    },
  });
  const ext: any = reg.clientExtensionResults;
  if (ext?.prf && ext.prf.enabled === false) throw new PrfUnsupportedError();
  const transports = reg.response.transports;
  // Some authenticators return the PRF output at creation, most only on an assertion (second touch).
  const out = prfFirst(ext) ?? (await evalSecurityKeyPrf(reg.id, prfSalt, transports));
  const record = await encryptShareWithPrf({
    safeAddress: input.safeAddress,
    share: input.share,
    prfOutput: out,
    credentialId: reg.id,
    rpId: window.location.hostname,
    prfSalt,
    transports,
    label: reg.authenticatorAttachment === 'platform' ? 'second device' : 'security key',
  });
  out.fill(0);
  return record;
}

/** Opens part ② with the security key it was registered on (key present + touch). */
export async function openShareWithSecurityKey(record: SecurityKeyShare): Promise<string> {
  if (record.rpId !== window.location.hostname)
    throw new Error(
      tr(
        `This security key was registered on ${record.rpId}. Open My Wall on that address to use it.`,
        `Cette clé de sécurité a été enregistrée sur ${record.rpId}. Ouvrez My Wall à cette adresse pour l’utiliser.`,
      ),
    );
  const out = await evalSecurityKeyPrf(record.credentialId, record.prfSalt, record.transports);
  try {
    return await decryptShareWithPrf(record, out);
  } catch {
    throw new Error(tr('This security key cannot open this part (wrong key or altered data).', 'Cette clé de sécurité ne peut pas ouvrir cette partie (mauvaise clé ou données modifiées).'));
  } finally {
    out.fill(0);
  }
}
