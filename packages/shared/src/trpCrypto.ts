// #9 — Ed25519 signing of Travel Rule messages (node:crypto standard primitive, no custom crypto). Node-only:
// exported from '@sq/shared/server'. Each VASP has its own key pair, generated on first start and stored in ITS OWN
// git-ignored data directory (mode 600, optionally PKCS#8-encrypted with a passphrase). Keys are never logged,
// never committed, never regenerated when the file exists.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import type { SignedEnvelope } from './trp';

export interface VaspKey {
  privateKey: KeyObject;
  publicKeyPem: string;
  keyId: string;
}

export const sha256Hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Short, stable fingerprint of a public key (sha256 of its SPKI DER, first 16 hex chars). */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return sha256Hex(der).slice(0, 16);
}

/**
 * Loads the VASP signing key from `file`, or generates it (Ed25519) when the file does not exist.
 * With a passphrase the private key is stored as encrypted PKCS#8 (AES-256-CBC, node:crypto / OpenSSL).
 */
export function loadOrCreateVaspKey(file: string, vaspId: string, passphrase?: string): VaspKey {
  let pem: string;
  if (fs.existsSync(file)) {
    pem = (JSON.parse(fs.readFileSync(file, 'utf8')) as { privateKeyPem: string }).privateKeyPem;
  } else {
    const { privateKey } = generateKeyPairSync('ed25519');
    pem = passphrase
      ? (privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }) as string)
      : (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ format: 'vasp-ed25519-v1', vaspId, encrypted: !!passphrase, createdAt: new Date().toISOString(), privateKeyPem: pem }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const privateKey = createPrivateKey(passphrase && pem.includes('ENCRYPTED') ? { key: pem, passphrase } : { key: pem });
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('VASP key is not an Ed25519 key');
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) as string;
  return { privateKey, publicKeyPem, keyId: `${vaspId}#${keyFingerprint(publicKeyPem)}` };
}

/** Signs the exact bytes of JSON.stringify(payload). */
export function signEnvelope(payload: unknown, key: VaspKey): SignedEnvelope {
  const text = JSON.stringify(payload);
  const signature = sign(null, Buffer.from(text, 'utf8'), key.privateKey).toString('base64url');
  return { payload: text, signature, keyId: key.keyId, alg: 'Ed25519' };
}

export class EnvelopeError extends Error {}

/**
 * Verifies an envelope with the sender's public key (PEM, SPKI) and returns the parsed payload.
 * Throws EnvelopeError on any malformed field, key-id mismatch or bad signature.
 */
export function verifyEnvelope<T = unknown>(env: unknown, publicKeyPem: string, expectedVaspId?: string): T {
  const e = env as Partial<SignedEnvelope> | null;
  if (!e || typeof e !== 'object' || typeof e.payload !== 'string' || typeof e.signature !== 'string' || typeof e.keyId !== 'string' || e.alg !== 'Ed25519')
    throw new EnvelopeError('Malformed signed envelope');
  if (e.payload.length > 64_000) throw new EnvelopeError('Payload too large');
  const fp = keyFingerprint(publicKeyPem);
  const [vaspId, kfp] = e.keyId.split('#');
  if (kfp !== fp || (expectedVaspId !== undefined && vaspId !== expectedVaspId)) throw new EnvelopeError('Unknown signing key');
  let sig: Buffer;
  try {
    sig = Buffer.from(e.signature, 'base64url');
  } catch {
    throw new EnvelopeError('Malformed signature');
  }
  if (sig.length !== 64 || !verify(null, Buffer.from(e.payload, 'utf8'), createPublicKey(publicKeyPem), sig)) throw new EnvelopeError('Invalid signature');
  try {
    return JSON.parse(e.payload) as T;
  } catch {
    throw new EnvelopeError('Payload is not JSON');
  }
}

/**
 * Pinned peer keys (trust on first use, then pinned): a VASP's public key fetched once from its identity endpoint is
 * stored in our data directory; a different key later is REFUSED (possible impersonation) until an operator
 * re-pins it. Production: keys/certificates come from the Travel Rule network's directory (TRP uses mutual TLS).
 */
export class PeerKeys {
  private file: string;
  private peers: Record<string, { publicKeyPem: string; pinnedAt: string }>;
  constructor(file: string) {
    this.file = file;
    this.peers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
  get(vaspId: string) {
    return this.peers[vaspId]?.publicKeyPem;
  }
  /** Returns the pinned key, pinning `fetched` on first use; throws when it differs from the pinned one. */
  pin(vaspId: string, fetched: string): string {
    const cur = this.peers[vaspId];
    if (cur) {
      if (keyFingerprint(cur.publicKeyPem) !== keyFingerprint(fetched)) throw new EnvelopeError(`The signing key of ${vaspId} changed — refused until re-pinned by an operator`);
      return cur.publicKeyPem;
    }
    this.peers[vaspId] = { publicKeyPem: fetched, pinnedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.peers, null, 2), { mode: 0o600 });
    return fetched;
  }
}

/** Fetches a VASP's public identity (vaspId + Ed25519 public key) from its TRP endpoint. */
export async function fetchVaspIdentity(endpoint: string, identityPath = '/trp/identity'): Promise<{ vaspId: string; publicKeyPem: string; keyId: string }> {
  const res = await fetch(`${endpoint}${identityPath}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new EnvelopeError(`Identity endpoint answered ${res.status}`);
  const j = (await res.json()) as { vaspId?: string; publicKeyPem?: string; keyId?: string };
  if (typeof j.vaspId !== 'string' || typeof j.publicKeyPem !== 'string' || typeof j.keyId !== 'string') throw new EnvelopeError('Malformed identity');
  if (j.keyId !== `${j.vaspId}#${keyFingerprint(j.publicKeyPem)}`) throw new EnvelopeError('Identity key id does not match its key');
  return { vaspId: j.vaspId, publicKeyPem: j.publicKeyPem, keyId: j.keyId };
}
