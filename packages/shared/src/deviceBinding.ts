// #11 — Device key K1 bound to the hardware passkey (WebAuthn PRF).
//
// K1 is encrypted TWICE on the device:
//   inner layer — the existing ethers keystore (scrypt + AES-128-CTR + MAC) keyed by the wallet PASSWORD;
//   outer layer — AES-256-GCM keyed by HKDF-SHA256(PRF output of the device passkey, random salt).
// Only the outer ciphertext is stored (localStorage). The PRF output is computed INSIDE the authenticator (Secure
// Enclave / TPM / platform passkey manager) from a secret that never leaves it, for a fixed per-wallet input (the
// "PRF salt", not secret), and only after user verification (Touch ID / Face ID / device PIN).
// Unlocking therefore needs BOTH the passkey on this hardware AND the password: a copy of the browser storage is
// useless without the passkey, and the passkey is useless without the password.
//
// Standard primitives only (WebAuthn PRF, WebCrypto HKDF + AES-GCM, ethers keystore). No custom cryptography.

import { getAddress, getBytes, hexlify, toUtf8Bytes } from 'ethers';

export const DEVICE_BINDING_KIND = 'mywall-device-key-prf';
const HKDF_INFO = 'mywall/device-key/passkey-prf/v1';

export interface PrfBoundKeystore {
  kind: typeof DEVICE_BINDING_KIND;
  version: 1;
  /** Public address of K1 (lets the app show which key this is without decrypting anything). */
  address: string;
  /** WebAuthn credential id (base64url) of THIS device's passkey. */
  credentialId: string;
  /** Relying-party id the passkey is bound to. */
  rpId: string;
  /** Fixed per-wallet PRF input (hex, 32 bytes) passed as `prf.eval.first`. Not secret. */
  prfSalt: string;
  hkdfSalt: string;
  iv: string;
  /** AES-256-GCM(PRF-derived key, ethers keystore JSON) — the keystore itself still needs the password. */
  ciphertext: string;
  createdAt: string;
}

const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const aad = (address: string, credentialId: string) => toUtf8Bytes(`${DEVICE_BINDING_KIND}|v1|${getAddress(address)}|${credentialId}`);

async function prfKey(prfOutput: Uint8Array, hkdfSalt: string, address: string) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) throw new Error('Invalid PRF output');
  const ikm = await subtle().importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: getBytes(hkdfSalt) as BufferSource, info: toUtf8Bytes(`${HKDF_INFO}|${getAddress(address)}`) as BufferSource },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Address inside an ethers keystore JSON (without decrypting it). */
function keystoreAddress(keystoreJson: string): string {
  const a = JSON.parse(keystoreJson)?.address;
  if (typeof a !== 'string') throw new Error('Not a keystore');
  return getAddress(a.startsWith('0x') ? a : `0x${a}`);
}

/** Wraps the (password-encrypted) keystore with the passkey's PRF output. */
export async function bindKeystoreWithPrf(input: { keystore: string; prfOutput: Uint8Array; credentialId: string; rpId: string; prfSalt: string }): Promise<PrfBoundKeystore> {
  const address = keystoreAddress(input.keystore);
  const hkdfSalt = hexlify(rand(16));
  const iv = rand(12);
  const key = await prfKey(input.prfOutput, hkdfSalt, address);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(address, input.credentialId) as BufferSource }, key, toUtf8Bytes(input.keystore) as BufferSource);
  return {
    kind: DEVICE_BINDING_KIND,
    version: 1,
    address,
    credentialId: input.credentialId,
    rpId: input.rpId,
    prfSalt: input.prfSalt,
    hkdfSalt,
    iv: hexlify(iv),
    ciphertext: hexlify(new Uint8Array(ct)),
    createdAt: new Date().toISOString(),
  };
}

/** Removes the outer layer with the passkey's PRF output → the password-encrypted keystore JSON. */
export async function unbindKeystoreWithPrf(rec: PrfBoundKeystore, prfOutput: Uint8Array): Promise<string> {
  let json: string;
  try {
    const key = await prfKey(prfOutput, rec.hkdfSalt, rec.address);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(rec.iv) as BufferSource, additionalData: aad(rec.address, rec.credentialId) as BufferSource }, key, getBytes(rec.ciphertext) as BufferSource);
    json = new TextDecoder().decode(pt);
  } catch {
    throw new Error('This passkey cannot open the device key (wrong passkey or altered data)');
  }
  if (keystoreAddress(json) !== getAddress(rec.address)) throw new Error('Device key mismatch');
  return json;
}

const HEX = /^0x[0-9a-fA-F]*$/;
const isHex = (v: unknown, min: number, max: number) => typeof v === 'string' && HEX.test(v) && v.length >= 2 + min * 2 && v.length <= 2 + max * 2;

/** Strict shape check of a stored record (returns null when absent / not a binding record). */
export function parsePrfBoundKeystore(input: unknown): PrfBoundKeystore | null {
  const r = input as Record<string, any> | null | undefined;
  if (!r || typeof r !== 'object' || r.kind !== DEVICE_BINDING_KIND || r.version !== 1) return null;
  try {
    getAddress(r.address);
  } catch {
    return null;
  }
  if (typeof r.credentialId !== 'string' || !/^[A-Za-z0-9_-]{16,1024}$/.test(r.credentialId)) return null;
  if (typeof r.rpId !== 'string' || !r.rpId || r.rpId.length > 253) return null;
  if (!isHex(r.prfSalt, 32, 32) || !isHex(r.hkdfSalt, 16, 64) || !isHex(r.iv, 12, 12) || !isHex(r.ciphertext, 64, 8192)) return null;
  return r as PrfBoundKeystore;
}
