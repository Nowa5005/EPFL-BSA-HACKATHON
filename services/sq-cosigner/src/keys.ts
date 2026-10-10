// MOCK HSM: K2 (one co-signer key per client) and the relayer key, ENCRYPTED at rest in data/keys.json
// (see keyvault.ts). In production these keys would be generated and used inside an HSM, never exported.

import fs from 'node:fs';
import path from 'node:path';
import { Wallet } from 'ethers';
import { DATA_DIR, ENV_FILE } from './paths';
import { decryptKey, encryptKey, isEncrypted, migrateKeyFile, readEncryptedFile, resolveMasterKey, writeEncryptedFile, KEYFILE_FORMAT, type EncKeyFile } from './keyvault';
import { db, HttpError } from './db';

export { DATA_DIR };
const KEY_FILE = path.join(DATA_DIR, 'keys.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Never generate a new master key if keys are already encrypted with another one.
if (!process.env.SERVICE_MASTER_KEY && fs.existsSync(KEY_FILE) && isEncrypted(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))))
  throw new Error('SERVICE_MASTER_KEY is missing but data/keys.json is encrypted — restore the master key (.env) instead of generating a new one');
const MASTER = resolveMasterKey(ENV_FILE);

const migration = migrateKeyFile(KEY_FILE, MASTER);
if (migration === 'migrated') console.log('[keyvault] keys.json migrated to encrypted keystores (addresses verified, plaintext removed)');
if (migration === 'created-empty') {
  const r = Wallet.createRandom();
  writeEncryptedFile(KEY_FILE, { format: KEYFILE_FORMAT, relayer: encryptKey({ address: r.address, privateKey: r.privateKey }, MASTER), cosigners: {} });
}

let file: EncKeyFile = readEncryptedFile(KEY_FILE);
const cache = new Map<string, Wallet>(); // decrypted keys stay in memory only

export const keyStore = { get data() { return file; } };

export function relayerWallet(): Wallet {
  let w = cache.get('relayer');
  if (!w) cache.set('relayer', (w = decryptKey(file.relayer, MASTER)));
  return w;
}

/** Generates (once) the Swissquote co-signer key K2 for a client. Only the address ever leaves this module. */
export function getOrCreateCosigner(clientId: string): string {
  const existing = file.cosigners[clientId];
  if (existing) return existing.address;
  const w = Wallet.createRandom();
  file = { ...file, cosigners: { ...file.cosigners, [clientId]: encryptKey({ address: w.address, privateKey: w.privateKey, createdAt: new Date().toISOString() }, MASTER) } };
  writeEncryptedFile(KEY_FILE, file);
  cache.set(`k2:${clientId}`, new Wallet(w.privateKey));
  return w.address;
}

/**
 * The ONLY way to obtain K2. Single choke point for the freeze: a frozen wallet never gets a co-signature,
 * whatever the route (transactions, pending reinforced requests, ownership proofs, recovery).
 */
export function cosignerWallet(clientId: string): Wallet {
  const c = db.data.clients[clientId];
  if (c?.frozen) throw new HttpError(423, 'Co-signature gelée pour ce wallet : Swissquote ne signe plus rien tant que le gel est actif.');
  const k = file.cosigners[clientId];
  if (!k) throw new Error('No co-signer key for this client');
  let w = cache.get(`k2:${clientId}`);
  if (!w) cache.set(`k2:${clientId}`, (w = decryptKey(k, MASTER)));
  return w;
}
