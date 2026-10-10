// #17 — Versioned Swissquote co-signer keys (K2): k2.v1, k2.v2, … in the same encrypted key vault (keyvault.ts).
//
//   • v1 = the ORIGINAL keys (`cosigners` in data/keys.json). They are never rewritten, re-encrypted or moved: the
//     "migration as v1" is purely logical (a file without `k2Versions` means "only v1, active").
//   • v ≥ 2 are stored in `cosignersV[version][clientId]`, encrypted exactly like v1 (ethers keystore, SERVICE_MASTER_KEY).
//   • A version is pending (created, opt-in only) → active (new wallets use it) → retiring (deadline) → retired.
//     After `retireAt`, a retiring version counts as retired: the signer refuses it (keys.ts cosignerWallet).
//
// Every write goes through updateKeyFile(): lock → re-read from disk → mutate → CHECK that every key that existed
// before is still there with the exact same address and the exact same keystore bytes → atomic write → re-read and
// check again. A backup copy of the file is taken before each rotation (backupKeyFile).

import fs from 'node:fs';
import path from 'node:path';
import { Wallet, getAddress } from 'ethers';
import { encryptKey, readEncryptedFile, writeEncryptedFile, type EncKey, type EncKeyFile } from './keyvault';

export type K2Status = 'pending' | 'active' | 'retiring' | 'retired';
export interface K2VersionMeta {
  version: number;
  status: K2Status;
  createdAt: string;
  /** retiring: after this instant the version is refused by the signer */
  retireAt?: string;
  activatedAt?: string;
  retiredAt?: string;
  note?: string;
}

export const LEGACY_V1: K2VersionMeta = { version: 1, status: 'active', createdAt: 'legacy (original K2 keys)' };

export function versionsOf(f: EncKeyFile): K2VersionMeta[] {
  return f.k2Versions?.length ? [...f.k2Versions].sort((a, b) => a.version - b.version) : [LEGACY_V1];
}

/** Status at `now`: a retiring version whose deadline has passed is retired. */
export function effectiveStatus(m: K2VersionMeta, now = Date.now()): K2Status {
  if (m.status === 'retiring' && m.retireAt && new Date(m.retireAt).getTime() <= now) return 'retired';
  return m.status;
}

export function metaOf(f: EncKeyFile, version: number): K2VersionMeta | undefined {
  return versionsOf(f).find((m) => m.version === version);
}

/** Version given to NEW wallets: the highest active one. */
export function activeVersion(f: EncKeyFile): number {
  const act = versionsOf(f).filter((m) => m.status === 'active');
  return act.length ? act[act.length - 1].version : 1;
}

/** Version an existing wallet migrates to: the highest pending or active version (pending = opt-in, e.g. the e2e test wallet). */
export function latestVersion(f: EncKeyFile, now = Date.now()): number {
  const ok = versionsOf(f).filter((m) => ['active', 'pending'].includes(effectiveStatus(m, now)));
  return ok.length ? ok[ok.length - 1].version : activeVersion(f);
}

export function keyOf(f: EncKeyFile, clientId: string, version: number): EncKey | undefined {
  return version === 1 ? f.cosigners[clientId] : f.cosignersV?.[String(version)]?.[clientId];
}

/** Every (version, key) this client has, lowest version first. */
export function clientKeys(f: EncKeyFile, clientId: string): { version: number; key: EncKey }[] {
  const out: { version: number; key: EncKey }[] = [];
  if (f.cosigners[clientId]) out.push({ version: 1, key: f.cosigners[clientId] });
  for (const v of Object.keys(f.cosignersV ?? {}).map(Number).sort((a, b) => a - b)) {
    const k = f.cosignersV![String(v)][clientId];
    if (k) out.push({ version: v, key: k });
  }
  return out;
}

/** Version of the key whose address is `address` for this client (the wallet's current K2 = its on-chain owner). */
export function versionOfAddress(f: EncKeyFile, clientId: string, address: string): number | undefined {
  const a = getAddress(address);
  return clientKeys(f, clientId).find((k) => getAddress(k.key.address) === a)?.version;
}

/** Every client id that has at least one K2. */
export function allClients(f: EncKeyFile): string[] {
  const s = new Set(Object.keys(f.cosigners));
  for (const m of Object.values(f.cosignersV ?? {})) for (const id of Object.keys(m)) s.add(id);
  return [...s];
}

/** Every key in the file, flattened (for the preservation check). */
function flatten(f: EncKeyFile): Map<string, EncKey> {
  const m = new Map<string, EncKey>([['relayer', f.relayer]]);
  for (const [id, k] of Object.entries(f.cosigners)) m.set(`v1:${id}`, k);
  for (const [v, ks] of Object.entries(f.cosignersV ?? {})) for (const [id, k] of Object.entries(ks)) m.set(`v${v}:${id}`, k);
  return m;
}

/** Throws unless every key of `before` is in `after` with the SAME address and the SAME encrypted bytes. */
export function assertPreserved(before: EncKeyFile, after: EncKeyFile) {
  const a = flatten(after);
  for (const [slot, k] of flatten(before)) {
    const n = a.get(slot);
    if (!n) throw new Error(`Key vault check failed: ${slot} would be removed`);
    if (getAddress(n.address) !== getAddress(k.address) || n.keystore !== k.keystore) throw new Error(`Key vault check failed: ${slot} would be modified`);
  }
}

/** Copy of the encrypted file next to it (mode 600). Returns the backup path. */
export function backupKeyFile(file: string, tag = 'backup'): string | null {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.dirname(file), `${path.basename(file, '.json')}.${tag}-${stamp}.json`);
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dest, 0o600);
  if (fs.readFileSync(dest, 'utf8') !== fs.readFileSync(file, 'utf8')) throw new Error('Backup copy differs from the key file');
  return dest;
}

function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx', 0o600));
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10_000) fs.rmSync(lock, { force: true }); // stale lock (crashed writer)
      else if (Date.now() - start > 5_000) throw new Error('Key vault is locked by another writer');
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/**
 * The only way to change the key file: re-read from disk (another process may have written), mutate a copy,
 * verify nothing that existed is lost or changed, write atomically, read back and verify again.
 */
export function updateKeyFile(file: string, mutate: (f: EncKeyFile) => EncKeyFile): EncKeyFile {
  return withLock(file, () => {
    const before = readEncryptedFile(file);
    const after = mutate(structuredClone(before));
    assertPreserved(before, after);
    writeEncryptedFile(file, after);
    const reread = readEncryptedFile(file);
    assertPreserved(before, reread);
    assertPreserved(after, reread);
    return reread;
  });
}

/** Adds a NEW key for (client, version). Never replaces an existing one. */
export function withClientKey(f: EncKeyFile, clientId: string, version: number, key: EncKey): EncKeyFile {
  if (keyOf(f, clientId, version)) throw new Error(`K2 v${version} already exists for this client`);
  if (version === 1) return { ...f, cosigners: { ...f.cosigners, [clientId]: key } };
  const v = String(version);
  return { ...f, cosignersV: { ...(f.cosignersV ?? {}), [v]: { ...(f.cosignersV?.[v] ?? {}), [clientId]: key } } };
}

export function newEncryptedKey(master: string): EncKey {
  const w = Wallet.createRandom();
  return encryptKey({ address: w.address, privateKey: w.privateKey, createdAt: new Date().toISOString() }, master);
}

export interface RotateOptions {
  /** pending: v(n+1) is created but nothing is retired; only wallets that opt in (test wallet) migrate to it */
  pending?: boolean;
  /** deadline for the retiring version (default: 30 days) */
  retireAt?: Date;
  /** pre-generate the new key for every existing client (default true) */
  pregenerate?: boolean;
  note?: string;
  now?: Date;
}

/** `npm run k2:rotate`: creates version n+1 (and the keys), marks the previous active version(s) retiring. */
export function rotate(file: string, master: string, o: RotateOptions = {}) {
  const now = o.now ?? new Date();
  const backup = backupKeyFile(file, 'backup-before-k2-rotate');
  let created = 0;
  const after = updateKeyFile(file, (f) => {
    const metas = versionsOf(f);
    if (metas.some((m) => m.status === 'pending')) throw new Error('A pending K2 version already exists: activate it (--activate) instead of creating another one');
    const version = Math.max(...metas.map((m) => m.version)) + 1;
    const retireAt = (o.retireAt ?? new Date(now.getTime() + 30 * 86400_000)).toISOString();
    const next: K2VersionMeta[] = metas.map((m) => (!o.pending && m.status === 'active' ? { ...m, status: 'retiring', retireAt } : m));
    next.push({ version, status: o.pending ? 'pending' : 'active', createdAt: now.toISOString(), ...(o.pending ? {} : { activatedAt: now.toISOString() }), ...(o.note ? { note: o.note } : {}) });
    let g: EncKeyFile = { ...f, k2Versions: next };
    if (o.pregenerate !== false)
      for (const id of allClients(f)) {
        if (keyOf(g, id, version)) continue;
        g = withClientKey(g, id, version, newEncryptedKey(master));
        created++;
      }
    return g;
  });
  const v = versionsOf(after);
  return { backup, version: v[v.length - 1].version, versions: v, keysCreated: created };
}

/** Promotes a pending version to active; the previous active version(s) become retiring with the deadline. */
export function activate(file: string, version: number, retireAt: Date, now = new Date()) {
  const backup = backupKeyFile(file, 'backup-before-k2-activate');
  const after = updateKeyFile(file, (f) => {
    const metas = versionsOf(f);
    const m = metas.find((x) => x.version === version);
    if (!m || m.status !== 'pending') throw new Error(`K2 v${version} is not pending`);
    return {
      ...f,
      k2Versions: metas.map((x) =>
        x.version === version ? { ...x, status: 'active' as const, activatedAt: now.toISOString() } : x.status === 'active' && x.version < version ? { ...x, status: 'retiring' as const, retireAt: retireAt.toISOString() } : x,
      ),
    };
  });
  return { backup, versions: versionsOf(after) };
}

/** Emergency (compromised K2 version): retire it NOW. Wallets still on it can only move through D1 (see docs). */
export function retireNow(file: string, version: number, now = new Date()) {
  const backup = backupKeyFile(file, 'backup-before-k2-retire');
  const after = updateKeyFile(file, (f) => {
    const metas = versionsOf(f);
    const m = metas.find((x) => x.version === version);
    if (!m) throw new Error(`Unknown K2 v${version}`);
    if (!metas.some((x) => x.version !== version && ['active', 'pending'].includes(x.status))) throw new Error('Create the replacement version first (k2:rotate)');
    return { ...f, k2Versions: metas.map((x) => (x.version === version ? { ...x, status: 'retired' as const, retiredAt: now.toISOString(), retireAt: x.retireAt ?? now.toISOString() } : x)) };
  });
  return { backup, versions: versionsOf(after) };
}

/** Changes the deadline of a retiring version. */
export function setDeadline(file: string, version: number, retireAt: Date) {
  const after = updateKeyFile(file, (f) => {
    const metas = versionsOf(f);
    const m = metas.find((x) => x.version === version);
    if (!m || m.status !== 'retiring') throw new Error(`K2 v${version} is not retiring`);
    return { ...f, k2Versions: metas.map((x) => (x.version === version ? { ...x, retireAt: retireAt.toISOString() } : x)) };
  });
  return { versions: versionsOf(after) };
}
