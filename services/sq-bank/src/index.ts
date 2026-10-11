// sq-bank — MOCK Swissquote core banking + KYC.
// Separate process, own data/ directory. Client profile, CHF/USDC account, verified-wallet registry (Travel Rule),
// transfers account ↔ wallet. The USDC leg is REAL on Sepolia when the treasury holds test USDC.

import { createSecurity, fetchWalletRates, internalHeaders, issueToken, listenService, isProduction, loadDotenv, localizeResponses, principalOf, JsonStore, newId, nowIso, t as tl } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerUserData } from './userdata';
import { registerSiweRoutes } from './siwe';
import { createTermsService } from './terms';
import { Contract, Wallet, formatEther, formatUnits, getAddress, hashMessage, parseUnits } from 'ethers';
import {
  EIP1271_ABI,
  EIP1271_MAGIC,
  ERC20_ABI,
  LANG_HEADER,
  PORTS,
  RPC_URLS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  explorerTx,
  makeProvider,
  parseLang,
  pick,
  usdcContract,
} from '@sq/shared';

const COSIGNER_URL = process.env.COSIGNER_URL ?? 'http://localhost:4001';
const DATA_DIR = process.env.BANK_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
// DEMO back-office user for the compliance console (role 'compliance'); not a bank client.
const COMPLIANCE_USER = 'compliance';
const COMPLIANCE_PROFILE = { name: 'Compliance officer (DEMO)', username: COMPLIANCE_USER, demo: true };
const provider = makeProvider(process.env.SEPOLIA_RPC_URLS ? process.env.SEPOLIA_RPC_URLS.split(',') : RPC_URLS);

interface BankClient {
  clientId: string;
  username: string;
  name: string;
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  email: string;
  phone: string;
  idVerification?: { status: 'accepted' | 'refused'; method: 'id-card' | 'passport'; date: string; simulated: true };
  kyc: { status: 'verified'; dob: string; nationality: string; idDocument: string; address: string; verifiedAt: string; photo: string; riskClass: 'low' | 'medium' | 'high' };
  accounts: { CHF: number; USDC: number };
  verifiedWallets: { address: string; method: string; verifiedAt: string; proofTx?: string; label: string; kind?: 'external'; chainId?: number }[];
  transfers: { id: string; ts: string; direction: 'to-wallet' | 'from-wallet'; amount: number; asset: 'USDC'; txHash?: string; status: string }[];
}

interface BankDb {
  treasury: { address: string; privateKey: string };
  clients: Record<string, BankClient>;
  sessions: Record<string, { clientId: string; createdAt: string }>;
}

function seedClients(): Record<string, BankClient> {
  const alice: BankClient = {
    clientId: 'CH-100234',
    username: 'alice',
    name: 'Alice Muster',
    firstName: 'Alice',
    lastName: 'Muster',
    birthDate: '1992-03-14',
    email: 'alice.muster@example.ch',
    phone: '+41 79 123 45 67',
    kyc: {
      status: 'verified',
      dob: '1992-03-14',
      nationality: 'CH',
      idDocument: 'Swiss ID card X1234567 (exp. 2031)',
      address: 'Avenue de la Gare 10, 1003 Lausanne',
      verifiedAt: '2024-02-03T09:12:00Z',
      photo: 'kyc-reference-photo (mock)',
      riskClass: 'low',
    },
    accounts: { CHF: 25_430.5, USDC: 1_000 },
    verifiedWallets: [],
    transfers: [],
  };
  const bruno: BankClient = {
    ...alice,
    clientId: 'CH-100235',
    username: 'bruno',
    name: 'Bruno Beispiel',
    firstName: 'Bruno',
    lastName: 'Beispiel',
    birthDate: '1988-11-02',
    email: 'bruno.beispiel@example.ch',
    phone: '+41 78 765 43 21',
    kyc: { ...alice.kyc, dob: '1988-11-02', idDocument: 'Swiss passport S7654321 (exp. 2030)', address: 'Bahnhofstrasse 1, 8001 Zürich' },
    accounts: { CHF: 8_120, USDC: 500 },
    verifiedWallets: [],
    transfers: [],
  };
  return { [alice.clientId]: alice, [bruno.clientId]: bruno };
}

const store = new JsonStore<BankDb>(DATA_DIR, 'bank', () => {
  const t = Wallet.createRandom();
  return { treasury: { address: t.address, privateKey: t.privateKey }, clients: seedClients(), sessions: {} };
});
const treasury = new Wallet(store.data.treasury.privateKey, provider);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).then((r) => !res.headersSent && res.json(r ?? { ok: true })).catch(next);
const client = (id: string) => {
  const c = store.data.clients[id];
  if (!c) throw new HttpError(404, tl('Unknown client', 'Client inconnu'));
  return c;
};

const app = express();
// Origin allow-list + CORS + JSON-only writes, then authentication with DEFAULT-DENY authorisation:
// every route not listed below needs a session token, and /clients/:id/... only for the token's own client.
const security = createSecurity({
  service: 'sq-bank',
  publicRoutes: [
    ['GET', '/health'],
    ['GET', '/ready'],
    ['POST', '/login'],
  ],
  sessionRoutes: [['POST', '/reauth']],
});
app.use(security.edge);
app.use(express.json());
app.use(security.guard);
app.use(localizeResponses); // stored bilingual texts (`xFr` twins) answered in the request language

// Process readiness must not wait for public blockchain RPCs or expose treasury information.
app.get('/ready', route(() => ({ service: 'sq-bank', ready: true })));

app.get(
  '/health',
  route(async () => {
    const [eth, usdc] = await Promise.all([provider.getBalance(treasury.address).catch(() => null), (usdcContract(provider).balanceOf(treasury.address) as Promise<bigint>).catch(() => null)]);
    return { service: 'sq-bank (MOCK)', treasury: treasury.address, treasuryEth: eth === null ? null : formatEther(eth), treasuryUsdc: usdc === null ? null : formatUnits(usdc, USDC_DECIMALS) };
  }),
);

/** MOCK Swissquote login (any password accepted for the demo user). */
app.post(
  '/login',
  route((req) => {
    const { username } = req.body as { username: string; password?: string };
    const u = String(username ?? '').toLowerCase().trim();
    // DEMO compliance officer for the internal console (/admin). Any password in this prototype.
    if (u === COMPLIANCE_USER) return { token: issueToken({ sub: `compliance:${u}`, role: 'compliance' }), role: 'compliance', clientId: null, profile: COMPLIANCE_PROFILE };
    const c = Object.values(store.data.clients).find((x) => x.username === u);
    if (!c) throw new HttpError(401, pick(parseLang(req.header(LANG_HEADER)), 'Unknown Swissquote user (try “alice” or “bruno”)', 'Utilisateur Swissquote inconnu (essayez « alice » ou « bruno »)'));
    // Signed, short-lived session token (HMAC, verified by every service) — sent as Authorization: Bearer.
    const token = issueToken({ sub: c.clientId, role: 'client' });
    return { token, role: 'client', clientId: c.clientId, profile: c };
  }),
);

/**
 * Re-authentication before a sensitive demo operation (per-client reset): the client re-enters the bank password
 * and receives a FRESH token valid 5 minutes. DEMO: any non-empty password is accepted, like /login.
 */
app.post(
  '/reauth',
  route((req) => {
    const p = principalOf(req);
    const lang = parseLang(req.header(LANG_HEADER));
    if (!String(req.body?.password ?? '')) throw new HttpError(400, pick(lang, 'Enter your password.', 'Saisissez votre mot de passe.'));
    if (p.kind !== 'client' && p.kind !== 'compliance') throw new HttpError(403, pick(lang, 'Not allowed.', 'Non autorisé.'));
    return { token: issueToken({ sub: p.sub!, role: p.kind, fresh: true }), fresh: true, expiresInSec: 300 };
  }),
);

/** Dev scripts only (x-internal-token, never in production): a client session for a headless E2E client. */
app.post(
  '/admin/test-session',
  route((req) => {
    if (isProduction() || principalOf(req).kind !== 'internal') throw new HttpError(404, 'Not found');
    const clientId = String(req.body?.clientId ?? '');
    if (!/^[A-Za-z0-9-]{3,64}$/.test(clientId)) throw new HttpError(400, tl('Invalid clientId', 'clientId invalide'));
    return { token: issueToken({ sub: clientId, role: 'client' }, 2 * 3600), clientId };
  }),
);

app.get(
  '/clients/:id',
  route(async (req) => {
    const c = client(String(req.params.id));
    // Indicative USDC/CHF market rate (market-data service, timestamped); null when unavailable — no fixed rate.
    const usdc = (await fetchWalletRates()).USDC;
    return { ...c, rates: { USDC_CHF: usdc ? { chf: usdc.chf, asOf: usdc.asOf, provider: usdc.provider, stale: usdc.stale, kind: 'indicative' } : null }, treasury: treasury.address };
  }),
);

/** Travel Rule: register a self-hosted wallet after verifying an EIP-1271 proof of ownership ON-CHAIN. */
app.post(
  '/clients/:id/wallets',
  route(async (req) => {
    const c = client(String(req.params.id));
    const { address, message, signature, label = 'SQ Wallet' } = req.body as { address: string; message: string; signature: string; label?: string };
    const safe = getAddress(address);
    if (!message.includes(c.clientId) || !message.includes(safe)) throw new HttpError(400, tl('The declaration does not match this client and wallet', 'La déclaration ne correspond pas au client et au wallet'));
    const result: string = await new Contract(safe, EIP1271_ABI, provider).isValidSignature(hashMessage(message), signature).catch(() => '0x');
    if (result.toLowerCase() !== EIP1271_MAGIC) throw new HttpError(401, tl('Invalid EIP-1271 proof of ownership', 'Preuve de propriété EIP-1271 invalide'));
    store.update((d) => {
      const cl = d.clients[c.clientId];
      cl.verifiedWallets = cl.verifiedWallets.filter((w) => w.address !== safe);
      cl.verifiedWallets.push({ address: safe, label, method: 'EIP-1271 signature (device key + Swissquote co-signer), verified on-chain', verifiedAt: nowIso() });
    });
    console.log(`[bank] wallet ${safe} verified for ${c.clientId} (EIP-1271)`);
    return { verified: true, method: 'EIP-1271', address: safe };
  }),
);

/** Simulated identity-document check: only the outcome is stored, never the images. */
app.post(
  '/clients/:id/id-verification',
  route((req) => {
    const c = client(String(req.params.id));
    const { status, method } = req.body as { status: 'accepted' | 'refused'; method: 'id-card' | 'passport' };
    if (!['accepted', 'refused'].includes(status) || !['id-card', 'passport'].includes(method)) throw new HttpError(400, tl('Invalid data', 'Données invalides'));
    const idVerification = { status, method, date: nowIso(), simulated: true as const };
    store.update((d) => (d.clients[c.clientId].idVerification = idVerification));
    return idVerification;
  }),
);

/** Account → wallet: debits the mock USDC account, sends REAL test USDC from the Swissquote treasury. */
app.post(
  '/clients/:id/transfer-to-wallet',
  route(async (req) => {
    const c = client(String(req.params.id));
    const amount = Number(req.body.amount);
    const to = getAddress(req.body.address);
    if (!(amount > 0)) throw new HttpError(400, tl('Invalid amount', 'Montant invalide'));
    if (!c.verifiedWallets.some((w) => w.address === to)) throw new HttpError(403, tl('Travel Rule: this wallet is not a verified wallet of this client', "Travel Rule : ce wallet n'est pas un wallet vérifié de ce client"));
    if (c.accounts.USDC < amount) throw new HttpError(400, tl('Not enough USDC on your Swissquote account', 'USDC insuffisants sur votre compte Swissquote'));
    const raw = parseUnits(String(amount), USDC_DECIMALS);
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, treasury);
    const bal: bigint = await usdc.balanceOf(treasury.address);
    if (bal < raw) throw new HttpError(
        503,
        tl(
          `Not enough test USDC in the Sepolia reserve (${formatUnits(bal, USDC_DECIMALS)} USDC). Fund ${treasury.address} on faucet.circle.com.`,
          `Réserve d'USDC de test insuffisante sur Sepolia (${formatUnits(bal, USDC_DECIMALS)} USDC). Alimentez ${treasury.address} sur faucet.circle.com.`,
        ),
      );
    const tx = await usdc.transfer(to, raw);
    // Respond as soon as the hash is known (« en attente »); the wallet side follows it until confirmed.
    const t = { id: newId(), ts: nowIso(), direction: 'to-wallet' as const, amount, asset: 'USDC' as const, txHash: tx.hash as string, status: 'pending' };
    store.update((d) => {
      d.clients[c.clientId].accounts.USDC -= amount;
      d.clients[c.clientId].transfers.unshift(t);
    });
    await fetch(`${COSIGNER_URL}/clients/${c.clientId}/receipts/track`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ txHash: tx.hash, source: 'swissquote-account', fromName: 'Swissquote account', fromNameFr: 'Compte Swissquote', amount: String(amount) }),
    }).catch(() => undefined);
    tx.wait()
      .then((rc: any) => store.update((d) => {
        const x = d.clients[c.clientId]?.transfers.find((y) => y.id === t.id);
        if (x) x.status = rc?.status === 1 ? 'confirmed' : 'failed';
      }))
      .catch(() => undefined);
    return { ...t, explorer: explorerTx(tx.hash) };
  }),
);

/** Wallet → account: the client sends USDC to the treasury from the Safe; the bank verifies the on-chain Transfer and credits. */
app.post(
  '/clients/:id/credit-from-wallet',
  route(async (req) => {
    const c = client(String(req.params.id));
    const { txHash } = req.body as { txHash: string };
    if (c.transfers.some((t) => t.txHash === txHash)) throw new HttpError(409, tl('Already credited', 'Déjà crédité'));
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) throw new HttpError(400, tl('Transaction not found or failed', 'Transaction introuvable ou échouée'));
    const iface = new Contract(USDC_ADDRESS, ERC20_ABI).interface;
    let amountRaw = 0n;
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      const p = iface.parseLog(l);
      if (p?.name === 'Transfer' && getAddress(p.args[1]) === treasury.address && c.verifiedWallets.some((w) => w.address === getAddress(p.args[0]))) amountRaw += p.args[2] as bigint;
    }
    if (amountRaw === 0n) throw new HttpError(400, tl('No USDC transfer from a verified wallet to the Swissquote account', "Aucun transfert d'USDC depuis un wallet vérifié vers le compte Swissquote"));
    const amount = Number(formatUnits(amountRaw, USDC_DECIMALS));
    const t = { id: newId(), ts: nowIso(), direction: 'from-wallet' as const, amount, asset: 'USDC' as const, txHash, status: 'credited' };
    store.update((d) => {
      d.clients[c.clientId].accounts.USDC += amount;
      d.clients[c.clientId].transfers.unshift(t);
    });
    return t;
  }),
);

app.post('/admin/clients/:id/reset', route((req) => {
  const id = String(req.params.id);
  const seed = seedClients()[id];
  if (!seed) throw new HttpError(404, tl('Unknown client', 'Client inconnu'));
  store.update((d) => (d.clients[id] = seed));
  terms.resetClient(id);
  return { reset: true };
}));

app.post('/admin/reset', route(() => {
  store.update((d) => {
    d.clients = seedClients();
    d.sessions = {};
  });
  terms.reset();
  return { reset: true };
}));

registerSiweRoutes(app, route, { store, client, provider, treasury: treasury.address, HttpError }); // external wallets (SIWE, compliance package)
registerUserData(app, (id) => !!store.data.clients[id]); // watchlist + alerts (content package)
const terms = createTermsService({ dataDir: DATA_DIR, httpError: HttpError }); // Terms of Use versions + acceptances (N4)
terms.register(app, route);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: String((err as Error)?.message ?? err) });
});

listenService(app, PORTS.bank, 'sq-bank (MOCK core banking)', () => {
  console.log(`Treasury (test USDC float) address: ${treasury.address}`);
});
