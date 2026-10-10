// External wallet verification with Sign-In with Ethereum (EIP-4361, https://eips.ethereum.org/EIPS/eip-4361).
// The client proves it CONTROLS an address (no transaction, no network fee, no approval, never a seed phrase or a
// private key). sq-bank is the KYC / verified-wallet registry, so the result is stored in the client's
// verifiedWallets — it is then accepted as "My own wallet" in the send flow (Travel Rule, see docs/COMPLIANCE.md).
// What it proves: control of the address at the time of signing. NOT a proof of identity, NOT a compliance attestation.
//
// Format parsing is plain text (no crypto). Signature checks: EOA via ethers.verifyMessage (EIP-191 personal_sign);
// smart-contract accounts via EIP-1271 isValidSignature(hashMessage(message), signature) read on Sepolia.

import { randomBytes } from 'node:crypto';
import { Contract, getAddress, hashMessage, isAddress, verifyMessage, type AbstractProvider } from 'ethers';
import type { Express, NextFunction, Request, Response } from 'express';
import { CHAIN_ID, EIP1271_ABI, EIP1271_MAGIC, parseLang, pick } from '@sq/shared';
import { allowedOrigins } from '@sq/shared/server';

export const SIWE_TTL_SEC = 5 * 60;
/** Origins allowed to request a proof (the SIWE domain/URI). Default: the services' CORS allow-list (http/https only). */
export const siweAllowedOrigins = () =>
  (process.env.SIWE_ALLOWED_ORIGINS ? process.env.SIWE_ALLOWED_ORIGINS.split(',') : [...allowedOrigins()]).map((s) => s.trim().replace(/\/$/, '')).filter((o) => /^https?:\/\/[^/]+$/.test(o));
export const SIWE_CHAIN_IDS = [CHAIN_ID]; // Sepolia only (the app's network; EIP-1271 is checked on Sepolia)

export interface SiweFields {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: '1';
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

export function buildSiweMessage(f: SiweFields): string {
  const lines = [`${f.domain} wants you to sign in with your Ethereum account:`, f.address, ''];
  if (f.statement) lines.push(f.statement, '');
  lines.push(`URI: ${f.uri}`, `Version: ${f.version}`, `Chain ID: ${f.chainId}`, `Nonce: ${f.nonce}`, `Issued At: ${f.issuedAt}`);
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  if (f.notBefore) lines.push(`Not Before: ${f.notBefore}`);
  if (f.requestId !== undefined) lines.push(`Request ID: ${f.requestId}`);
  if (f.resources?.length) lines.push('Resources:', ...f.resources.map((r) => `- ${r}`));
  return lines.join('\n');
}

export class SiweError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Strict parser of the EIP-4361 text format (only what we generate is accepted: fields in the standard order). */
export function parseSiweMessage(msg: string): SiweFields {
  if (typeof msg !== 'string' || msg.length > 4000 || msg.includes('\r')) throw new SiweError('malformed', 'Malformed message');
  const lines = msg.split('\n');
  let i = 0;
  const head = /^(?<domain>[^\s/]+) wants you to sign in with your Ethereum account:$/.exec(lines[i++] ?? '');
  if (!head) throw new SiweError('malformed', 'Malformed message (header)');
  const address = lines[i++] ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new SiweError('malformed', 'Malformed message (address)');
  if (lines[i++] !== '') throw new SiweError('malformed', 'Malformed message');
  let statement: string | undefined;
  if (!(lines[i] ?? '').startsWith('URI: ')) {
    statement = lines[i++];
    if (lines[i++] !== '') throw new SiweError('malformed', 'Malformed message (statement)');
  }
  const take = (key: string, optional = false) => {
    const l = lines[i] ?? '';
    if (l.startsWith(`${key}: `)) {
      i++;
      return l.slice(key.length + 2);
    }
    if (!optional) throw new SiweError('malformed', `Malformed message (${key})`);
    return undefined;
  };
  const uri = take('URI')!;
  const version = take('Version')!;
  const chainId = take('Chain ID')!;
  const nonce = take('Nonce')!;
  const issuedAt = take('Issued At')!;
  const expirationTime = take('Expiration Time', true);
  const notBefore = take('Not Before', true);
  const requestId = take('Request ID', true);
  let resources: string[] | undefined;
  if (lines[i] === 'Resources:') {
    i++;
    resources = [];
    while (i < lines.length && lines[i].startsWith('- ')) resources.push(lines[i++].slice(2));
  }
  if (i !== lines.length) throw new SiweError('malformed', 'Malformed message (trailing content)');
  if (version !== '1') throw new SiweError('malformed', 'Unsupported SIWE version');
  if (!/^\d+$/.test(chainId)) throw new SiweError('malformed', 'Malformed chain id');
  if (!/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new SiweError('malformed', 'Malformed nonce');
  for (const t of [issuedAt, expirationTime, notBefore]) if (t !== undefined && !ISO.test(t)) throw new SiweError('malformed', 'Malformed timestamp');
  return { domain: head.groups!.domain, address, statement, uri, version: '1', chainId: Number(chainId), nonce, issuedAt, expirationTime, notBefore, requestId, resources };
}

export interface StoredChallenge {
  nonce: string;
  clientId: string;
  address: string; // checksummed
  chainId: number;
  domain: string;
  uri: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
}

export function siweStatement(clientId: string) {
  return `Prove that you control this address for your Swissquote account ${clientId}. Signing is free: it is not a transaction, moves no funds and grants no token approval. Swissquote will never ask for your seed phrase or private key.`;
}

export function createChallenge(clientId: string, address: string, chainId: number, origin: string, now = new Date()): StoredChallenge {
  if (!isAddress(address)) throw new SiweError('address', 'Invalid address');
  if (!SIWE_CHAIN_IDS.includes(chainId)) throw new SiweError('chain', 'Unsupported network: switch your wallet to Ethereum Sepolia');
  if (!siweAllowedOrigins().includes(origin)) throw new SiweError('domain', 'Origin not allowed');
  const u = new URL(origin);
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SIWE_TTL_SEC * 1000).toISOString();
  const fields: SiweFields = { domain: u.host, address: getAddress(address), statement: siweStatement(clientId), uri: u.origin, version: '1', chainId, nonce, issuedAt, expirationTime: expiresAt };
  return { nonce, clientId, address: fields.address, chainId, domain: fields.domain, uri: fields.uri, message: buildSiweMessage(fields), issuedAt, expiresAt, used: false };
}

export type Eip1271Check = (address: string, hash: string, signature: string) => Promise<boolean>;

export const eip1271Checker =
  (provider: AbstractProvider): Eip1271Check =>
  async (address, hash, signature) => {
    const code = await provider.getCode(address);
    if (!code || code === '0x') return false;
    const r: string = await new Contract(address, EIP1271_ABI, provider).isValidSignature(hash, signature).catch(() => '0x');
    return r.toLowerCase() === EIP1271_MAGIC;
  };

export const METHOD_EOA = 'SIWE (EIP-4361) personal_sign';
export const METHOD_1271 = 'SIWE (EIP-4361) + EIP-1271 (contract account)';

/**
 * Verifies a signed SIWE message against the stored (already consumed) challenge. Throws SiweError with a code:
 * malformed | mismatch-<field> | tampered | expired | not-yet-valid | signature.
 */
export async function verifySiwe(ch: StoredChallenge, message: string, signature: string, now: Date, isValid1271: Eip1271Check): Promise<{ method: string; address: string }> {
  const f = parseSiweMessage(message);
  if (f.domain !== ch.domain) throw new SiweError('mismatch-domain', 'Domain mismatch');
  if (f.uri !== ch.uri) throw new SiweError('mismatch-uri', 'URI mismatch');
  if (getAddress(f.address) !== ch.address) throw new SiweError('mismatch-address', 'Address mismatch');
  if (f.chainId !== ch.chainId) throw new SiweError('mismatch-chain', 'Network mismatch');
  if (f.nonce !== ch.nonce) throw new SiweError('mismatch-nonce', 'Nonce mismatch');
  if (message !== ch.message) throw new SiweError('tampered', 'The signed message differs from the one issued');
  if (!f.expirationTime || new Date(f.expirationTime).getTime() <= now.getTime() || new Date(ch.expiresAt).getTime() <= now.getTime()) throw new SiweError('expired', 'Challenge expired');
  if (f.notBefore && new Date(f.notBefore).getTime() > now.getTime()) throw new SiweError('not-yet-valid', 'Not yet valid');
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new SiweError('signature', 'Invalid signature');
  try {
    if (signature.length === 132 && getAddress(verifyMessage(message, signature)) === ch.address) return { method: METHOD_EOA, address: ch.address };
  } catch {
    /* not a valid EOA signature — try EIP-1271 below */
  }
  if (await isValid1271(ch.address, hashMessage(message), signature).catch(() => false)) return { method: METHOD_1271, address: ch.address };
  throw new SiweError('signature', 'Signature does not match this address');
}

// ───────────────────────────── Routes (registered from index.ts) ─────────────────────────────

export interface SiweDeps {
  store: { data: any; update<R>(fn: (d: any) => R): R };
  client: (id: string) => { clientId: string; verifiedWallets: { address: string; label: string; method: string; verifiedAt: string; kind?: string; chainId?: number }[] };
  provider: AbstractProvider;
  treasury: string;
  HttpError: new (status: number, message: string) => Error;
}

type R = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => unknown;

export function registerSiweRoutes(app: Express, route: R, deps: SiweDeps) {
  const { store, client, HttpError } = deps;
  const check1271 = eip1271Checker(deps.provider);
  const msg = (req: Request, en: string, fr: string) => pick(parseLang(req.header('x-lang')), en, fr);
  const ERR: Record<string, [number, string, string]> = {
    address: [400, 'Invalid address.', 'Adresse invalide.'],
    chain: [400, 'Unsupported network: switch your wallet to Ethereum Sepolia and try again.', 'Réseau non pris en charge : passez votre wallet sur Ethereum Sepolia et recommencez.'],
    domain: [400, 'This website is not allowed to request a verification.', 'Ce site n’est pas autorisé à demander une vérification.'],
    malformed: [400, 'The signed message is not a valid verification message.', 'Le message signé n’est pas un message de vérification valide.'],
    tampered: [400, 'The signed message differs from the one we issued: start again.', 'Le message signé diffère de celui émis : recommencez.'],
    expired: [410, 'The verification request expired: start again.', 'La demande de vérification a expiré : recommencez.'],
    'not-yet-valid': [400, 'Not yet valid.', 'Pas encore valable.'],
    signature: [401, 'The signature does not match this address.', 'La signature ne correspond pas à cette adresse.'],
  };
  const fail = (req: Request, e: unknown): never => {
    if (e instanceof SiweError) {
      const [status, en, fr] = ERR[e.code] ?? (e.code.startsWith('mismatch-') ? [400, `The signed message does not match the request (${e.code.slice(9)}): start again.`, `Le message signé ne correspond pas à la demande (${e.code.slice(9)}) : recommencez.`] : [400, e.message, e.message]);
      throw Object.assign(new HttpError(status, msg(req, en, fr)), { code: e.code });
    }
    throw e;
  };
  const view = (w: any) => ({ address: w.address, label: w.label, method: w.method, verifiedAt: w.verifiedAt, chainId: w.chainId, kind: w.kind });

  app.get(
    '/clients/:id/external-wallets',
    route((req) => client(String(req.params.id)).verifiedWallets.filter((w) => w.kind === 'external').map(view)),
  );

  app.post(
    '/clients/:id/external-wallets/challenge',
    route((req) => {
      const c = client(String(req.params.id));
      const { address, chainId, origin } = req.body as { address: string; chainId: number; origin: string };
      if (isAddress(address) && [deps.treasury, ...c.verifiedWallets.filter((w) => w.kind !== 'external').map((w) => w.address)].some((a) => a.toLowerCase() === String(address).toLowerCase()))
        throw new HttpError(409, msg(req, 'This address is already linked to your account (Swissquote / My Wall).', 'Cette adresse est déjà liée à votre compte (Swissquote / My Wall).'));
      let ch: StoredChallenge;
      try {
        // The browser's Origin (already checked against the allow-list by the security edge) wins over the body.
        ch = createChallenge(c.clientId, address, Number(chainId), String(req.headers.origin ?? origin ?? ''));
      } catch (e) {
        return fail(req, e);
      }
      store.update((d) => {
        d.siweChallenges ??= {};
        for (const [k, v] of Object.entries(d.siweChallenges as Record<string, StoredChallenge>)) if (new Date(v.expiresAt).getTime() < Date.now() - 86400_000) delete d.siweChallenges[k];
        d.siweChallenges[ch.nonce] = ch;
      });
      return { nonce: ch.nonce, message: ch.message, address: ch.address, chainId: ch.chainId, issuedAt: ch.issuedAt, expiresAt: ch.expiresAt };
    }),
  );

  app.post(
    '/clients/:id/external-wallets/verify',
    route(async (req) => {
      const c = client(String(req.params.id));
      const { nonce, message, signature, label } = req.body as { nonce: string; message: string; signature: string; label?: string };
      // Consume the nonce atomically (single use) BEFORE any await: a replay — even concurrent — finds it used.
      const ch = store.update((d) => {
        const x: StoredChallenge | undefined = d.siweChallenges?.[String(nonce)];
        if (!x || x.clientId !== c.clientId) return { error: 'unknown' as const };
        if (x.used) return { error: 'used' as const };
        x.used = true;
        x.usedAt = new Date().toISOString();
        return { ch: { ...x } };
      });
      if ('error' in ch) throw new HttpError(ch.error === 'used' ? 409 : 404, ch.error === 'used' ? msg(req, 'This verification request was already used: start again.', 'Cette demande de vérification a déjà été utilisée : recommencez.') : msg(req, 'Unknown verification request: start again.', 'Demande de vérification inconnue : recommencez.'));
      let r: { method: string; address: string };
      try {
        r = await verifySiwe(ch.ch, String(message ?? ''), String(signature ?? ''), new Date(), check1271);
      } catch (e) {
        return fail(req, e);
      }
      const rec = { address: r.address, label: String(label ?? '').trim().slice(0, 40) || 'External wallet', method: r.method, verifiedAt: new Date().toISOString(), chainId: ch.ch.chainId, kind: 'external' };
      store.update((d) => {
        const cl = d.clients[c.clientId];
        cl.verifiedWallets = cl.verifiedWallets.filter((w: { address: string }) => w.address.toLowerCase() !== r.address.toLowerCase());
        cl.verifiedWallets.push(rec);
      });
      console.log(`[bank] external wallet verified (${r.method})`); // no client id / address in public logs
      return view(rec);
    }),
  );

  app.post(
    '/clients/:id/external-wallets/:address/revoke',
    route((req) => {
      const c = client(String(req.params.id));
      const a = String(req.params.address).toLowerCase();
      const found = c.verifiedWallets.some((w) => w.kind === 'external' && w.address.toLowerCase() === a);
      if (!found) throw new HttpError(404, msg(req, 'No verified external wallet with this address.', 'Aucun wallet externe vérifié avec cette adresse.'));
      store.update((d) => {
        const cl = d.clients[c.clientId];
        cl.verifiedWallets = cl.verifiedWallets.filter((w: { address: string; kind?: string }) => !(w.kind === 'external' && w.address.toLowerCase() === a));
      });
      return { revoked: true };
    }),
  );
}
