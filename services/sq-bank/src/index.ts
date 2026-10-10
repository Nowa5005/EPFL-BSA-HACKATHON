// sq-bank — MOCK Swissquote core banking + KYC.
// Separate process, own data/ directory. Client profile, CHF/USDC account, verified-wallet registry (Travel Rule),
// transfers account ↔ wallet. The USDC leg is REAL on Sepolia when the treasury holds test USDC.

import { loadDotenv, JsonStore, newId, nowIso } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, Wallet, formatEther, formatUnits, getAddress, hashMessage, parseUnits } from 'ethers';
import {
  EIP1271_ABI,
  EIP1271_MAGIC,
  ERC20_ABI,
  MOCK_USDC_CHF,
  PORTS,
  RPC_URLS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  explorerTx,
  makeProvider,
  usdcContract,
} from '@sq/shared';

const DATA_DIR = process.env.BANK_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const provider = makeProvider(process.env.SEPOLIA_RPC_URLS ? process.env.SEPOLIA_RPC_URLS.split(',') : RPC_URLS);

interface BankClient {
  clientId: string;
  username: string;
  name: string;
  email: string;
  phone: string;
  kyc: { status: 'verified'; dob: string; nationality: string; idDocument: string; address: string; verifiedAt: string; photo: string; riskClass: 'low' | 'medium' | 'high' };
  accounts: { CHF: number; USDC: number };
  verifiedWallets: { address: string; method: string; verifiedAt: string; proofTx?: string; label: string }[];
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
    email: 'alice.muster@example.ch',
    phone: '+41 79 123 45 67',
    kyc: {
      status: 'verified',
      dob: '1991-04-12',
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
  return { [alice.clientId]: alice };
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
  if (!c) throw new HttpError(404, 'Unknown client');
  return c;
};

const app = express();
app.use(cors());
app.use(express.json());

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
    const c = Object.values(store.data.clients).find((x) => x.username === String(username ?? '').toLowerCase().trim());
    if (!c) throw new HttpError(401, 'Unknown Swissquote user (try "alice")');
    const token = newId();
    store.update((d) => (d.sessions[token] = { clientId: c.clientId, createdAt: nowIso() }));
    return { token, clientId: c.clientId, profile: c };
  }),
);

app.get('/sessions/:token', route((req) => {
  const s = store.data.sessions[String(req.params.token)];
  if (!s) throw new HttpError(401, 'Invalid session');
  return s;
}));

app.get('/clients/:id', route((req) => ({ ...client(String(req.params.id)), rates: { USDC_CHF: MOCK_USDC_CHF }, treasury: treasury.address })));

/** Travel Rule: register a self-hosted wallet after verifying an EIP-1271 proof of ownership ON-CHAIN. */
app.post(
  '/clients/:id/wallets',
  route(async (req) => {
    const c = client(String(req.params.id));
    const { address, message, signature, label = 'SQ Wallet' } = req.body as { address: string; message: string; signature: string; label?: string };
    const safe = getAddress(address);
    if (!message.includes(c.clientId) || !message.includes(safe)) throw new HttpError(400, 'Statement does not match client and wallet');
    const result: string = await new Contract(safe, EIP1271_ABI, provider).isValidSignature(hashMessage(message), signature).catch(() => '0x');
    if (result.toLowerCase() !== EIP1271_MAGIC) throw new HttpError(401, 'EIP-1271 proof of ownership is invalid');
    store.update((d) => {
      const cl = d.clients[c.clientId];
      cl.verifiedWallets = cl.verifiedWallets.filter((w) => w.address !== safe);
      cl.verifiedWallets.push({ address: safe, label, method: 'EIP-1271 signature (device key + Swissquote co-signer), verified on-chain', verifiedAt: nowIso() });
    });
    console.log(`[bank] wallet ${safe} verified for ${c.clientId} (EIP-1271)`);
    return { verified: true, method: 'EIP-1271', address: safe };
  }),
);

/** Account → wallet: debits the mock USDC account, sends REAL test USDC from the Swissquote treasury. */
app.post(
  '/clients/:id/transfer-to-wallet',
  route(async (req) => {
    const c = client(String(req.params.id));
    const amount = Number(req.body.amount);
    const to = getAddress(req.body.address);
    if (!(amount > 0)) throw new HttpError(400, 'Invalid amount');
    if (!c.verifiedWallets.some((w) => w.address === to)) throw new HttpError(403, 'Travel Rule: destination wallet is not a verified wallet of this client');
    if (c.accounts.USDC < amount) throw new HttpError(400, 'Insufficient USDC on your Swissquote account');
    const raw = parseUnits(String(amount), USDC_DECIMALS);
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, treasury);
    const bal: bigint = await usdc.balanceOf(treasury.address);
    if (bal < raw) throw new HttpError(503, `Treasury test-USDC too low on Sepolia (${formatUnits(bal, USDC_DECIMALS)} USDC). Fund ${treasury.address} at faucet.circle.com.`);
    const tx = await usdc.transfer(to, raw);
    await tx.wait();
    const t = { id: newId(), ts: nowIso(), direction: 'to-wallet' as const, amount, asset: 'USDC' as const, txHash: tx.hash, status: 'confirmed' };
    store.update((d) => {
      d.clients[c.clientId].accounts.USDC -= amount;
      d.clients[c.clientId].transfers.unshift(t);
    });
    return { ...t, explorer: explorerTx(tx.hash) };
  }),
);

/** Wallet → account: the client sends USDC to the treasury from the Safe; the bank verifies the on-chain Transfer and credits. */
app.post(
  '/clients/:id/credit-from-wallet',
  route(async (req) => {
    const c = client(String(req.params.id));
    const { txHash } = req.body as { txHash: string };
    if (c.transfers.some((t) => t.txHash === txHash)) throw new HttpError(409, 'Already credited');
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) throw new HttpError(400, 'Transaction not found or failed');
    const iface = new Contract(USDC_ADDRESS, ERC20_ABI).interface;
    let amountRaw = 0n;
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      const p = iface.parseLog(l);
      if (p?.name === 'Transfer' && getAddress(p.args[1]) === treasury.address && c.verifiedWallets.some((w) => w.address === getAddress(p.args[0]))) amountRaw += p.args[2] as bigint;
    }
    if (amountRaw === 0n) throw new HttpError(400, 'No USDC transfer from a verified wallet to the Swissquote account found');
    const amount = Number(formatUnits(amountRaw, USDC_DECIMALS));
    const t = { id: newId(), ts: nowIso(), direction: 'from-wallet' as const, amount, asset: 'USDC' as const, txHash, status: 'credited' };
    store.update((d) => {
      d.clients[c.clientId].accounts.USDC += amount;
      d.clients[c.clientId].transfers.unshift(t);
    });
    return t;
  }),
);

app.post('/admin/reset', route(() => {
  store.update((d) => {
    d.clients = seedClients();
    d.sessions = {};
  });
  return { reset: true };
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: String((err as Error)?.message ?? err) });
});

app.listen(PORTS.bank, () => {
  console.log(`sq-bank (MOCK core banking) listening on http://localhost:${PORTS.bank}`);
  console.log(`Treasury (test USDC float) address: ${treasury.address}`);
});
