// Recovery key (K3) splitting: Shamir 2-of-3 via the audited `shamir-secret-sharing`
// library (Privy). Cloud-backup share encryption: WebCrypto PBKDF2 + AES-GCM.
// No custom cryptography here — only encoding glue.

import { combine, split } from 'shamir-secret-sharing';
import { getBytes, hexlify } from 'ethers';

export type ShareLabel = 'paper' | 'cloud' | 'partner';
export const SHARE_ORDER: ShareLabel[] = ['paper', 'cloud', 'partner'];

/** Splits a 32-byte private key into 3 shares, any 2 of which reconstruct it. */
export async function splitRecoveryKey(privateKeyHex: string): Promise<Record<ShareLabel, string>> {
  const secret = getBytes(privateKeyHex);
  const shares = await split(secret, 3, 2);
  secret.fill(0);
  return { paper: hexlify(shares[0]), cloud: hexlify(shares[1]), partner: hexlify(shares[2]) };
}

export async function combineShares(shares: string[]): Promise<string> {
  if (shares.length < 2) throw new Error('At least 2 shares are required');
  const key = await combine(shares.map((s) => getBytes(s)));
  return hexlify(key);
}

/** Paper kit payload (encoded in the QR code). */
export function encodePaperShare(safeAddress: string, share: string) {
  return `sqwallet:recovery:v1:${safeAddress}:${share}`;
}
export function decodePaperShare(payload: string): { safeAddress: string; share: string } {
  const m = payload.trim().match(/^sqwallet:recovery:v1:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]+)$/);
  if (!m) throw new Error('This does not look like an SQ Wallet recovery kit');
  return { safeAddress: m[1], share: m[2] };
}

const subtle = () => globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 310_000;

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface CloudBackup {
  kind: 'sqwallet-cloud-backup';
  version: 1;
  safeAddress: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

/** Encrypts the cloud share with the client's wallet password (cloud provider never sees it in clear). */
export async function encryptCloudShare(safeAddress: string, share: string, password: string): Promise<CloudBackup> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, getBytes(share) as BufferSource);
  return {
    kind: 'sqwallet-cloud-backup',
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

export async function decryptCloudShare(backup: CloudBackup, password: string): Promise<string> {
  const key = await deriveKey(password, getBytes(backup.salt));
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(backup.iv) as BufferSource }, key, getBytes(backup.ciphertext) as BufferSource);
    return hexlify(new Uint8Array(pt));
  } catch {
    throw new Error('Wrong password for the cloud backup');
  }
}
