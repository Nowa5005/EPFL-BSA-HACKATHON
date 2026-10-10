// Key vault for the co-signer service: K2 (per client) and the relayer key are stored ENCRYPTED at rest
// as ethers keystore JSON (scrypt + AES-128-CTR + MAC), unlocked with SERVICE_MASTER_KEY from the environment.
// The master key never lives in the same file as the keystores and is never logged.
//
// Migration from the former plaintext keys.json is atomic (write tmp → verify → rename), idempotent
// (an already-encrypted file is left untouched) and never regenerates a key: addresses are checked
// before and after so the Safes already deployed on Sepolia keep working.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Wallet, decryptKeystoreJsonSync, encryptKeystoreJsonSync, getAddress } from 'ethers';

export const KEYFILE_FORMAT = 'mywall-keys-encrypted-v1';

// The master key is 256 bits of randomness, so a moderate scrypt cost is enough and keeps start-up fast.
const SCRYPT = { N: 1 << 14, r: 8, p: 1 };

export interface PlainKey {
  address: string;
  privateKey: string;
  createdAt?: string;
}
export interface PlainKeyFile {
  relayer: PlainKey;
  cosigners: Record<string, PlainKey>;
}
export interface EncKey {
  address: string;
  keystore: string;
  createdAt?: string;
}
export interface EncKeyFile {
  format: typeof KEYFILE_FORMAT;
  relayer: EncKey;
  cosigners: Record<string, EncKey>;
}

export function encryptKey(k: PlainKey, master: string): EncKey {
  const keystore = encryptKeystoreJsonSync({ address: k.address, privateKey: k.privateKey }, master, { scrypt: SCRYPT });
  return { address: getAddress(k.address), keystore, ...(k.createdAt ? { createdAt: k.createdAt } : {}) };
}

export function decryptKey(k: EncKey, master: string): Wallet {
  const acc = decryptKeystoreJsonSync(k.keystore, master);
  const w = new Wallet(acc.privateKey);
  if (getAddress(w.address) !== getAddress(k.address)) throw new Error('Keystore address mismatch');
  return w;
}

export const isEncrypted = (d: unknown): d is EncKeyFile => !!d && (d as EncKeyFile).format === KEYFILE_FORMAT;

function atomicWrite(file: string, content: string) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/** Encrypts a plaintext key file in place. Returns what happened. Throws (leaving the original intact) on any mismatch. */
export function migrateKeyFile(file: string, master: string): 'created-empty' | 'already-encrypted' | 'migrated' {
  if (!fs.existsSync(file)) return 'created-empty';
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (isEncrypted(raw)) return 'already-encrypted';
  const plain = raw as PlainKeyFile;
  const enc: EncKeyFile = {
    format: KEYFILE_FORMAT,
    relayer: encryptKey(plain.relayer, master),
    cosigners: Object.fromEntries(Object.entries(plain.cosigners ?? {}).map(([id, k]) => [id, encryptKey(k, master)])),
  };
  // Verify every key round-trips to the exact same address and private key BEFORE replacing the plaintext.
  const check = (p: PlainKey, e: EncKey) => {
    const w = decryptKey(e, master);
    if (getAddress(w.address) !== getAddress(p.address) || w.privateKey.toLowerCase() !== p.privateKey.toLowerCase()) throw new Error(`Migration check failed for ${p.address}`);
  };
  check(plain.relayer, enc.relayer);
  for (const [id, k] of Object.entries(plain.cosigners ?? {})) check(k, enc.cosigners[id]);
  atomicWrite(file, JSON.stringify(enc, null, 2));
  return 'migrated';
}

/** SERVICE_MASTER_KEY from the environment. In local development only, a strong value is generated once and
 *  appended to the repo-root .env (git-ignored, mode 600). In production it must come from a durable secret store. */
export function resolveMasterKey(envFile: string): string {
  const existing = process.env.SERVICE_MASTER_KEY;
  if (existing && existing.length >= 32) return existing;
  if (existing) throw new Error('SERVICE_MASTER_KEY is too short (min 32 characters)');
  if (process.env.NODE_ENV === 'production') throw new Error('SERVICE_MASTER_KEY must be provided by the secret store in production');
  const key = crypto.randomBytes(32).toString('base64url');
  const line = `\n# Generated on ${new Date().toISOString()} — master key for the co-signer key vault. Keep it; losing it makes K2/relayer keys unrecoverable.\nSERVICE_MASTER_KEY=${key}\n`;
  fs.appendFileSync(envFile, line, { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  process.env.SERVICE_MASTER_KEY = key;
  console.log(`[keyvault] SERVICE_MASTER_KEY generated and stored in ${path.basename(envFile)} (git-ignored)`);
  return key;
}

export function writeEncryptedFile(file: string, data: EncKeyFile) {
  atomicWrite(file, JSON.stringify(data, null, 2));
}

export function readEncryptedFile(file: string): EncKeyFile {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isEncrypted(d)) throw new Error('Key file is not encrypted — run the migration');
  return d;
}
