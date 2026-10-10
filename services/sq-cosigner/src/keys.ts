// MOCK HSM: K2 (per-client co-signer keys) and the relayer key live in data/keys.json.
// In production these would be generated and used inside an HSM, never exported.

import { Wallet } from 'ethers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '@sq/shared/server';

export const DATA_DIR = process.env.COSIGNER_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

interface KeyFile {
  relayer: { address: string; privateKey: string };
  cosigners: Record<string, { address: string; privateKey: string; createdAt: string }>;
}

export const keyStore = new JsonStore<KeyFile>(DATA_DIR, 'keys', () => {
  const r = Wallet.createRandom();
  return { relayer: { address: r.address, privateKey: r.privateKey }, cosigners: {} };
});

export function relayerWallet() {
  return new Wallet(keyStore.data.relayer.privateKey);
}

/** Generates (once) the Swissquote co-signer key K2 for a client. Only the address ever leaves this module. */
export function getOrCreateCosigner(clientId: string): string {
  const existing = keyStore.data.cosigners[clientId];
  if (existing) return existing.address;
  const w = Wallet.createRandom();
  keyStore.update((d) => {
    d.cosigners[clientId] = { address: w.address, privateKey: w.privateKey, createdAt: new Date().toISOString() };
  });
  return w.address;
}

export function cosignerWallet(clientId: string): Wallet {
  const k = keyStore.data.cosigners[clientId];
  if (!k) throw new Error('No co-signer key for this client');
  return new Wallet(k.privateKey);
}
