// #16 — Session opened with the duress code. The SAME wallet screens render, but every call to Swissquote's services
// made with the client session is answered here, in memory, with a small plausible FICTITIOUS wallet: no real
// balance, address, contact, history or document ever reaches the screen. Nothing is stored (no localStorage, no
// flag in the DOM); reloading the page or locking the wallet ends it. There is no real key in this session (a
// throwaway key that owns nothing), and co-signing was frozen server-side when the code was checked — so nothing
// real can be signed. Operations "fail" with a plausible, generic service error.

import { getAddress, keccak256, scrypt, toUtf8Bytes, hexlify, type HDNodeWallet, type Wallet } from 'ethers';
import type { BankSession, DeviceRecord } from './device';
import { tr } from './i18n';

/** Device-side derivation of the duress code (the server only ever sees this proof, then hashes it again). */
export async function duressProof(clientId: string, code: string): Promise<string> {
  return hexlify(await scrypt(toUtf8Bytes(code.normalize('NFKC')), toUtf8Bytes(`mywall-duress-v1:${clientId}`), 1 << 14, 8, 1, 32));
}

interface DecoyState {
  device: DeviceRecord;
  session: BankSession;
  key: Wallet | HDNodeWallet;
  codeDigest: string;
  safe: string;
  client: any;
  txs: any[];
  usdc: string;
  eth: string;
  protection: any;
}
let st: DecoyState | null = null;

export const decoyActive = () => !!st;
export const decoyDevice = () => st?.device ?? null;
export const decoySession = () => st?.session ?? null;
export const decoyKey = () => st?.key ?? null;
export function endDecoy() {
  st = null;
}
/** Same code typed again (e.g. the password fallback of the privacy screen) → stays in the same session. */
export const isDecoyCode = (code: string) => !!st && keccak256(toUtf8Bytes(code)) === st.codeDigest;

const addr = (seed: string) => getAddress('0x' + keccak256(toUtf8Bytes(seed)).slice(-40));
const daysAgo = (n: number, h = 11) => {
  const d = new Date(Date.now() - n * 86400_000);
  d.setUTCHours(h, 17, 0, 0);
  return d.toISOString();
};

export function startDecoy(o: { device: DeviceRecord; session: BankSession; code: string; key: Wallet | HDNodeWallet; preferences?: unknown; protection?: any }) {
  const id = o.device.clientId;
  const key = o.key; // throwaway key: owns nothing, signs nothing real
  const safe = addr(`decoy-safe:${id}`); // stable per client, owns nothing real
  const cosignerKey = addr(`decoy-k2:${id}`);
  const recovery = addr(`decoy-k3:${id}`);
  const account = addr(`decoy-account:${id}`);
  const marc = addr(`decoy-contact-1:${id}`);
  const lea = addr(`decoy-contact-2:${id}`);
  const name: string = o.session.profile?.name ?? 'Client';
  const [firstName, ...rest] = name.split(' ');
  const profile = { clientId: id, username: o.session.profile?.username, name, firstName: o.session.profile?.firstName ?? firstName, lastName: o.session.profile?.lastName ?? rest.join(' '), email: o.session.profile?.email, accounts: { CHF: 1_284.6, USDC: 0 }, verifiedWallets: [], transfers: [] };
  const tx = (n: number, kind: 'receive' | 'send', asset: 'USDC' | 'ETH', amount: string, other: string, otherName: string | undefined, ago: number) => ({
    id: `d${n}-${id}`,
    kind,
    status: 'confirmed',
    asset,
    amount,
    from: kind === 'receive' ? other : safe,
    to: kind === 'receive' ? safe : other,
    counterpartyName: otherName,
    source: kind === 'receive' && otherName === 'Swissquote account' ? 'swissquote-account' : 'wallet',
    feesSponsored: kind === 'send',
    createdAt: daysAgo(ago),
    confirmedAt: daysAgo(ago),
    reference: `MW-${(0x5a1c3 + n * 7919).toString(36).toUpperCase()}`,
  });
  const txs = [tx(4, 'send', 'USDC', '22.60', lea, 'Léa', 3), tx(3, 'send', 'USDC', '45.00', marc, 'Marc', 9), tx(2, 'receive', 'USDC', '250.00', account, 'Swissquote account', 16), tx(1, 'receive', 'ETH', '0.0315', addr(`decoy-ext:${id}`), undefined, 41)];
  // Same on-chain protection status as the real wallet (banner / card look identical), with fictitious addresses.
  const q = (n: string, x: any) => (x ? { ...x, address: addr(`decoy-${n}:${id}`), pending: [] } : x);
  const pr = o.protection;
  const protection = pr
    ? {
        ...pr,
        config: pr.config ? { k2: cosignerKey, k3: recovery, d1: addr(`decoy-d1:${id}`), d2: addr(`decoy-d2:${id}`), d3: null } : pr.config,
        queues: pr.queues ? { d1: q('d1', pr.queues.d1), d2: q('d2', pr.queues.d2) } : pr.queues,
        emergencyReserve: pr.emergencyReserve ? { address: addr(`decoy-reserve:${id}`), eth: '0.002' } : pr.emergencyReserve,
        record: null,
      }
    : null;
  st = {
    protection,
    key,
    codeDigest: keccak256(toUtf8Bytes(o.code)),
    safe,
    usdc: '182.40',
    eth: '0.0315',
    txs,
    device: { clientId: id, safeAddress: safe, deviceAddress: key.address, keystore: '', credentialId: o.device.credentialId, deviceType: o.device.deviceType, createdAt: o.device.createdAt },
    session: { ...o.session, profile },
    client: {
      clientId: id,
      name,
      email: o.session.profile?.email,
      safeAddress: safe,
      owners: { device: key.address, cosigner: cosignerKey, recovery },
      devices: [{ credentialId: o.device.credentialId ?? 'device', deviceType: o.device.deviceType, label: o.device.deviceType === 'mobile' ? 'iPhone' : 'Chrome', status: 'active', createdAt: o.device.createdAt }],
      contacts: [
        { name: 'Marc', address: marc, addedAt: daysAgo(30), known: true },
        { name: 'Léa', address: lea, addedAt: daysAgo(20), known: true },
      ],
      usage: { day: new Date().toISOString().slice(0, 10), spentUsdc: 0, sponsoredTx: 0 },
      privacy: 'full',
      headless: false,
      frozen: false,
      frozenBy: null,
      preferences: o.preferences ?? {},
      backupCode: { configured: false },
      plan: 'free',
      demoFeeChf: null,
    },
  };
}

/** Thrown for anything the decoy cannot (must not) do — same shape as a real service error. */
export class DecoyServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const unavailable = () => new DecoyServiceError(503, tr('The service is temporarily unavailable. Please try again later.', 'Le service est momentanément indisponible. Réessayez plus tard.'));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Paths the decoy lets through to the real services: passkey ceremonies and non-personal configuration only. */
export function decoyPassThrough(method: string, path: string) {
  return (
    (method === 'POST' && (path === '/webauthn/auth/options' || path === '/webauthn/auth/verify')) ||
    (method === 'GET' && /^\/clients\/[^/]+\/(terms(\/.*)?|travel-rule\/config)$/.test(path)) ||
    (method === 'GET' && /^\/(config|pricing)$/.test(path))
  );
}

/** Fictitious answers for the client's own service calls while the decoy is active. */
export async function decoyRequest(service: 'cosigner' | 'bank' | 'partner', method: string, path: string, body?: any): Promise<any> {
  const s = st!;
  await wait(120 + Math.random() * 180); // network-like latency
  const p = path.split('?')[0];
  const m = p.match(/^\/clients\/[^/]+(\/.*)?$/);
  const sub = m ? m[1] ?? '' : null;
  if (service === 'bank') {
    if (method === 'GET' && sub === '') return { ...s.session.profile, rates: { USDC_CHF: null }, treasury: s.client.owners.recovery };
    if (method === 'GET' && sub === '/external-wallets') return [];
    throw unavailable();
  }
  if (service !== 'cosigner') throw unavailable();
  if (method === 'GET') {
    if (sub === '') return s.client;
    if (sub === '/onchain')
      return { deployed: true, safeAddress: s.safe, owners: [s.client.owners.device, s.client.owners.cosigner, s.client.owners.recovery], threshold: 2, nonce: '6', eth: s.eth, usdc: s.usdc, simulatedUsdc: 0 };
    if (sub === '/wallet-txs') return s.txs;
    if (sub === '/activity' || sub === '/inbox' || sub === '/tx-requests' || sub === '/documents' || sub === '/scheduled' || sub === '/recoveries') return [];
    if (sub === '/allowances') return [];
    if (sub === '/unrecognised-tokens') return [];
    if (sub === '/protection') {
      if (s.protection) return s.protection;
      throw unavailable();
    }
    if (sub === '/duress-code') return { configured: false, createdAt: null };
    if (sub === '/limits') return { dailyUsdc: 1000, pending: null, defaultUsdc: 1000, maxUsdc: 10000, raiseDelaySec: 60 };
    if (sub?.startsWith('/snapshots')) {
      const now = Date.now();
      const points = Array.from({ length: 24 }, (_, i) => {
        const t = now - (23 - i) * 3600_000;
        return { t, at: new Date(t).toISOString(), total: null, assets: { ETH: { qty: Number(s.eth), value: null }, USDC: { qty: Number(s.usdc), value: null } } };
      });
      const range = new URLSearchParams(path.split('?')[1] ?? '').get('range') ?? '24h';
      return { range, from: points[0].at, to: points[23].at, recordingSince: points[0].at, points, enough: false, partial: true, intervalMinutes: 60 };
    }
    const w = p.match(/^\/wallet-txs\/(.+)$/);
    if (w) {
      const t = s.txs.find((x) => x.id === w[1]);
      if (t) return t;
      throw new DecoyServiceError(404, tr('Unknown transaction', 'Transaction inconnue'));
    }
    throw unavailable();
  }
  // Writes: harmless local ones succeed; anything that would move or reveal value fails like a busy service.
  if (sub === '/contacts' && body?.name && body?.address) {
    s.client.contacts = [...s.client.contacts.filter((c: any) => c.address.toLowerCase() !== String(body.address).toLowerCase()), { name: body.name, address: body.address, addedAt: new Date().toISOString(), known: false }];
    return s.client;
  }
  if (sub === '/preferences') {
    s.client.preferences = { ...s.client.preferences, ...body };
    return s.client;
  }
  await wait(900);
  throw unavailable();
}
