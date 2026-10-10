// Recovery key (K3) splitting: Shamir threshold sharing via the audited `shamir-secret-sharing` library (Privy).
// No custom cryptography here — only encoding glue around standard primitives (Shamir, WebCrypto PBKDF2 + AES-GCM).
//
// Shares of K3 (2 of 3 today; the split is generic 2-of-N so a 4th "trusted contact" share can be added):
//   ① paper   — recovery code written on paper / engraved on a steel plate, kept by the client (home, bank safe)
//   ② key     — encrypted with a key that only the client's physical security key (WebAuthn PRF) can derive;
//               fallback: an offline file encrypted with a distinct backup password (see recoveryShare2.ts)
//   ③ partner — held by the independent Swiss recovery partner, released after identity checks
// Nothing about these shares ever goes to a cloud storage provider.

import { combine, split } from 'shamir-secret-sharing';
import { Wallet, getAddress, getBytes, hexlify } from 'ethers';

/** Labels of the K3 shares. Kept open (string) so that new holders (e.g. 'contact') can be added: 2-of-N. */
export type ShareLabel = 'paper' | 'key' | 'partner' | (string & {});
export const SHARE_ORDER = ['paper', 'key', 'partner'] as const;
export type DefaultShareLabel = (typeof SHARE_ORDER)[number];

/**
 * Splits a 32-byte private key into one share per label; any `threshold` of them reconstruct it.
 * Default: ① paper, ② key (physical security key or offline file), ③ partner — 2 of 3.
 */
export async function splitRecoveryKey<L extends string = DefaultShareLabel>(
  privateKeyHex: string,
  labels: readonly L[] = SHARE_ORDER as unknown as readonly L[],
  threshold = 2,
): Promise<Record<L, string>> {
  if (labels.length < 2 || new Set(labels).size !== labels.length) throw new Error('At least 2 distinct share holders are required');
  if (threshold < 2 || threshold > labels.length) throw new Error('Invalid threshold');
  const secret = getBytes(privateKeyHex);
  const shares = await split(secret, labels.length, threshold);
  secret.fill(0);
  return Object.fromEntries(labels.map((l, i) => [l, hexlify(shares[i])])) as Record<L, string>;
}

export async function combineShares(shares: string[]): Promise<string> {
  if (shares.length < 2) throw new Error('At least 2 shares are required');
  if (new Set(shares.map((s) => s.toLowerCase())).size !== shares.length) throw new Error('The same share was given twice');
  const key = await combine(shares.map((s) => getBytes(s)));
  return hexlify(key);
}

/**
 * Rebuilds the recovery key K3 from any 2 (or more) shares — paper code, physical-key share, partner share,
 * or a future trusted-contact share — and checks it against the expected on-chain owner when given.
 * Used by /recover, the escape hatch and the protected exit. The caller drops the returned key as soon as it signed.
 */
export async function reconstructK3FromShares(shares: (string | null | undefined)[], opts: { expectedAddress?: string } = {}): Promise<Wallet> {
  const given = shares.filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (given.length < 2) throw new Error('Two parts of the recovery key are required');
  const k3 = new Wallet(await combineShares(given));
  if (opts.expectedAddress && getAddress(opts.expectedAddress) !== k3.address)
    throw new Error('These parts do not rebuild the recovery key of this wallet (wrong or outdated part)');
  return k3;
}

// ───────────── Small secret kept ON THE DEVICE, sealed with the wallet password ─────────────
// Used for the copy of the paper code (share ①) that the device keeps so it can be shown again after
// re-authentication. WebCrypto PBKDF2-SHA256 (random salt) + AES-256-GCM. Never leaves the device.

const subtle = () => globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 310_000;

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface PasswordSealed {
  /** Older records carry a legacy `kind` value; only the fields below are read. */
  kind: string;
  version: 1;
  safeAddress: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

/** Seals a share with the wallet password (local copy on this device only). */
export async function sealWithPassword(safeAddress: string, share: string, password: string): Promise<PasswordSealed> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, getBytes(share) as BufferSource);
  return {
    kind: 'mywall-device-sealed-share',
    version: 1,
    safeAddress,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: hexlify(salt),
    iv: hexlify(iv),
    ciphertext: hexlify(new Uint8Array(ct)),
    createdAt: new Date().toISOString(),
  };
}

export async function openWithPassword(sealed: PasswordSealed, password: string): Promise<string> {
  const key = await deriveKey(password, getBytes(sealed.salt), sealed.iterations || PBKDF2_ITERATIONS);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(sealed.iv) as BufferSource }, key, getBytes(sealed.ciphertext) as BufferSource);
    return hexlify(new Uint8Array(pt));
  } catch {
    throw new Error('Wrong password');
  }
}
