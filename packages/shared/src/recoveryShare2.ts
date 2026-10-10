// Share ② of the recovery key K3 — NO cloud backup.
//
// Primary: a PHYSICAL SECURITY KEY (FIDO2 key such as a YubiKey) or a second device of the client, registered as a
// dedicated WebAuthn credential with the PRF extension (CTAP2 "hmac-secret"). The authenticator computes
// PRF(per-wallet salt) internally, from a secret that never leaves it; we derive an AES-256-GCM key from that
// output with HKDF-SHA256 (WebCrypto) and encrypt the share. Swissquote stores only the ciphertext (unreadable);
// decrypting needs the key itself, present and touched. An offline copy of the ciphertext can be downloaded.
//
// Fallback (no PRF-capable key / second device): an OFFLINE FILE (USB stick) encrypted with a distinct, strong
// backup password: scrypt (ethers) → AES-256-GCM (WebCrypto). "Keep offline — never upload to a cloud."
//
// Standard primitives only (WebAuthn PRF, HKDF, scrypt, AES-GCM). No custom cryptography.

import { computeHmac, concat, getAddress, getBytes, hexlify, scrypt, sha256, toUtf8Bytes } from 'ethers';

export const SHARE2_KIND = 'mywall-recovery-share2';
export const OFFLINE_NOTICE = 'Keep offline — never upload to a cloud';
const HKDF_INFO = 'mywall/k3-share2/security-key/v1';
/** Production scrypt cost for the offline file (N = 2^17, r = 8, p = 1 — same as the ethers keystore default). */
export const OFFLINE_SCRYPT_N = 1 << 17;
const MIN_SCRYPT_N = 1 << 14;
export const MIN_BACKUP_PASSWORD_LENGTH = 15;

export interface SecurityKeyShare {
  kind: typeof SHARE2_KIND;
  version: 1;
  method: 'security-key';
  safeAddress: string;
  /** WebAuthn credential id (base64url) of the dedicated credential on the security key. */
  credentialId: string;
  /** Relying-party id the credential is bound to (the wallet's web domain). */
  rpId: string;
  transports?: string[];
  /** Fixed per-wallet PRF input (hex, 32 bytes) — passed as `prf.eval.first`. Not secret. */
  prfSalt: string;
  hkdfSalt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  label?: string;
}

export interface OfflineShareFile {
  kind: typeof SHARE2_KIND;
  version: 1;
  method: 'offline-password';
  safeAddress: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  iv: string;
  ciphertext: string;
  createdAt: string;
  notice: typeof OFFLINE_NOTICE;
}

export type Share2Record = SecurityKeyShare | OfflineShareFile;

const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Authenticated data: binds the ciphertext to its wallet, method and credential (any change → decryption fails). */
function aad(method: Share2Record['method'], safeAddress: string, credentialId = '') {
  return toUtf8Bytes(`${SHARE2_KIND}|v1|${method}|${getAddress(safeAddress)}|${credentialId}`);
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array, ad: Uint8Array) {
  const iv = rand(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: ad as BufferSource }, key, plaintext as BufferSource);
  return { iv: hexlify(iv), ciphertext: hexlify(new Uint8Array(ct)) };
}
async function aesDecrypt(key: CryptoKey, iv: string, ciphertext: string, ad: Uint8Array) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(iv) as BufferSource, additionalData: ad as BufferSource }, key, getBytes(ciphertext) as BufferSource);
  return hexlify(new Uint8Array(pt));
}

// ───────────── Physical security key (WebAuthn PRF) ─────────────

/** A fresh per-wallet PRF input (32 random bytes, hex). */
export const newPrfSalt = () => hexlify(rand(32));

async function prfKey(prfOutput: Uint8Array, hkdfSalt: string, safeAddress: string) {
  if (prfOutput.length < 32) throw new Error('Invalid PRF output');
  const ikm = await subtle().importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: getBytes(hkdfSalt) as BufferSource, info: toUtf8Bytes(`${HKDF_INFO}|${getAddress(safeAddress)}`) as BufferSource },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptShareWithPrf(input: {
  safeAddress: string;
  share: string;
  prfOutput: Uint8Array;
  credentialId: string;
  rpId: string;
  prfSalt: string;
  transports?: string[];
  label?: string;
}): Promise<SecurityKeyShare> {
  const safeAddress = getAddress(input.safeAddress);
  const hkdfSalt = hexlify(rand(16));
  const key = await prfKey(input.prfOutput, hkdfSalt, safeAddress);
  const { iv, ciphertext } = await aesEncrypt(key, getBytes(input.share), aad('security-key', safeAddress, input.credentialId));
  return {
    kind: SHARE2_KIND,
    version: 1,
    method: 'security-key',
    safeAddress,
    credentialId: input.credentialId,
    rpId: input.rpId,
    transports: input.transports,
    prfSalt: input.prfSalt,
    hkdfSalt,
    iv,
    ciphertext,
    createdAt: new Date().toISOString(),
    label: input.label,
  };
}

export async function decryptShareWithPrf(record: SecurityKeyShare, prfOutput: Uint8Array): Promise<string> {
  try {
    const key = await prfKey(prfOutput, record.hkdfSalt, record.safeAddress);
    return await aesDecrypt(key, record.iv, record.ciphertext, aad('security-key', record.safeAddress, record.credentialId));
  } catch {
    throw new Error('This security key cannot open this part of the recovery key (wrong key or altered data)');
  }
}

/**
 * WebAuthn PRF → CTAP2 hmac-secret: the salt actually sent to the authenticator is
 * SHA-256("WebAuthn PRF" || 0x00 || input) (WebAuthn Level 3 §10.1.4). Lets a command-line FIDO2 tool
 * (e.g. libfido2 `fido2-assert -h`) compute the same output without a browser (escape hatch).
 */
export const prfHmacSecretSalt = (prfSaltHex: string) => sha256(concat([toUtf8Bytes('WebAuthn PRF'), new Uint8Array([0]), getBytes(prfSaltHex)]));

/**
 * TEST ONLY — deterministic stand-in for a security key, used by the headless e2e client and unit tests (no
 * authenticator in node). Mirrors what an authenticator does: HMAC-SHA256(credential secret, hmac-secret salt).
 * Never used by the app.
 */
export function TEST_ONLY_simulatePrf(testSecretHex: string, prfSaltHex: string): Uint8Array {
  return getBytes(computeHmac('sha256', getBytes(testSecretHex), prfHmacSecretSalt(prfSaltHex)));
}

// ───────────── Fallback: offline file protected by a distinct backup password ─────────────

const fold = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** The backup password must differ from the wallet password (otherwise one leak would expose two things). */
export function backupPasswordProblem(backupPassword: string, walletPassword?: string): string | null {
  if ([...backupPassword].length < MIN_BACKUP_PASSWORD_LENGTH) return `The backup password needs at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`;
  if (walletPassword !== undefined && fold(backupPassword) === fold(walletPassword)) return 'The backup password must be different from your wallet password';
  return null;
}

async function scryptKey(password: string, kdf: OfflineShareFile['kdf'], onProgress?: (p: number) => void) {
  const raw = await scrypt(toUtf8Bytes(password.normalize('NFKC')), getBytes(kdf.salt), kdf.N, kdf.r, kdf.p, 32, onProgress);
  return subtle().importKey('raw', getBytes(raw) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptShareOffline(
  safeAddress: string,
  share: string,
  backupPassword: string,
  opts: { walletPassword?: string; scryptN?: number; onProgress?: (p: number) => void } = {},
): Promise<OfflineShareFile> {
  const problem = backupPasswordProblem(backupPassword, opts.walletPassword);
  if (problem) throw new Error(problem);
  const N = opts.scryptN ?? OFFLINE_SCRYPT_N;
  if (N < MIN_SCRYPT_N || (N & (N - 1)) !== 0) throw new Error('Invalid scrypt cost');
  const addr = getAddress(safeAddress);
  const kdf = { name: 'scrypt' as const, N, r: 8, p: 1, salt: hexlify(rand(16)) };
  const key = await scryptKey(backupPassword, kdf, opts.onProgress);
  const { iv, ciphertext } = await aesEncrypt(key, getBytes(share), aad('offline-password', addr));
  return { kind: SHARE2_KIND, version: 1, method: 'offline-password', safeAddress: addr, kdf, iv, ciphertext, createdAt: new Date().toISOString(), notice: OFFLINE_NOTICE };
}

export async function decryptShareOffline(file: OfflineShareFile, backupPassword: string, onProgress?: (p: number) => void): Promise<string> {
  const key = await scryptKey(backupPassword, file.kdf, onProgress);
  try {
    return await aesDecrypt(key, file.iv, file.ciphertext, aad('offline-password', file.safeAddress));
  } catch {
    throw new Error('Wrong backup password (or the file was altered)');
  }
}

// ───────────── Parsing / validation (files and server records) ─────────────

const HEX = /^0x[0-9a-fA-F]*$/;
const isHex = (v: unknown, min = 1, max = 4096) => typeof v === 'string' && HEX.test(v) && v.length >= 2 + min * 2 && v.length <= 2 + max * 2;

/** Strict shape check; returns the record or throws. Never accepts a plaintext share. */
export function parseShare2Record(input: unknown): Share2Record {
  const r = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, any>;
  const bad = () => new Error('This is not a My Wall recovery-key part (part ②)');
  if (!r || typeof r !== 'object' || r.kind !== SHARE2_KIND || r.version !== 1) throw bad();
  if (typeof r.safeAddress !== 'string') throw bad();
  getAddress(r.safeAddress);
  if (!isHex(r.iv, 12, 12) || !isHex(r.ciphertext, 17, 256)) throw bad();
  if (r.method === 'security-key') {
    if (typeof r.credentialId !== 'string' || !/^[A-Za-z0-9_-]{16,1024}$/.test(r.credentialId)) throw bad();
    if (typeof r.rpId !== 'string' || !r.rpId || r.rpId.length > 253) throw bad();
    if (!isHex(r.prfSalt, 32, 32) || !isHex(r.hkdfSalt, 16, 64)) throw bad();
    if (r.transports !== undefined && (!Array.isArray(r.transports) || r.transports.some((x: unknown) => typeof x !== 'string'))) throw bad();
    return r as SecurityKeyShare;
  }
  if (r.method === 'offline-password') {
    const k = r.kdf;
    if (!k || k.name !== 'scrypt' || !Number.isInteger(k.N) || k.N < MIN_SCRYPT_N || k.N > 1 << 20 || k.r !== 8 || k.p !== 1 || !isHex(k.salt, 16, 64)) throw bad();
    return r as OfflineShareFile;
  }
  throw bad();
}
