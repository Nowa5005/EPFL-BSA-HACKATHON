// sq-cosigner — Swissquote co-signing service (K2), policy engine, gas relayer, activity log.
// Separate process with its own data/ directory. Holds K2 (mock HSM) + relayer key. Never sees K1 or K3.

import { loadDotenv, newId, nowIso } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { formatEther, formatUnits, getAddress, randomBytes, hexlify, hashMessage, verifyTypedData } from 'ethers';
import {
  PORTS,
  POLICY,
  SERVICE_URLS,
  USDC_DECIMALS,
  decodeSafeTx,
  deploySafe,
  explorerTx,
  safeIface,
  safeDomain,
  SAFE_MESSAGE_TYPES,
  signSafeMessage,
  packSignatures,
  short,
  type SafeTx,
} from '@sq/shared';
import { db, getClient, HttpError, logActivity, notify, usageOf, type Client, type TxRequest } from './db';
import { cosignerWallet, getOrCreateCosigner } from './keys';
import {
  balancesOf,
  checkedSafeTxHash,
  cosignAndExecute,
  provider,
  recoverSigner,
  relayer,
  relayerAddress,
  relayerTask,
  safeState,
  shortErr,
  simulateInner,
} from './chain';
import { evaluatePolicy, usdcEquivalent, DAPP_WHITELIST, SANCTIONED } from './policy';
import {
  authOptionsForAction,
  authOptionsForHash,
  HEADLESS_ALLOWED,
  registrationOptions,
  verifyAssertion,
  verifyRegistration,
} from './webauthn';

const RECOVERY_DELAY_SEC = Number(process.env.RECOVERY_DELAY_SEC ?? POLICY.recoveryDelaySec);
const COOLING_OFF_SEC = Number(process.env.COOLING_OFF_SEC ?? POLICY.coolingOffNewRecipientSec);
const PARTNER_URL = process.env.PARTNER_URL ?? SERVICE_URLS.partner;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

type H = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((r) => {
      if (!res.headersSent) res.json(r ?? { ok: true });
    })
    .catch(next);
};

function publicClient(c: Client) {
  return {
    clientId: c.clientId,
    name: c.name,
    email: c.email,
    safeAddress: c.safeAddress,
    deployTxHash: c.deployTxHash,
    owners: c.owners,
    devices: c.devices.map(({ publicKey, ...d }) => d),
    contacts: c.contacts.map((ct) => ({ ...ct, known: isKnown(ct.addedAt) })),
    usage: usageOf(c),
    privacy: c.privacy,
    headless: !!c.headless,
  };
}

const isKnown = (addedAt: string) => Date.now() - new Date(addedAt).getTime() >= COOLING_OFF_SEC * 1000;

// ───────────────────────────── Health ─────────────────────────────
app.get(
  '/health',
  route(async () => {
    const bal = await provider.getBalance(relayerAddress).catch(() => null);
    return { service: 'sq-cosigner', relayer: relayerAddress, relayerEth: bal === null ? null : formatEther(bal), headlessAllowed: HEADLESS_ALLOWED };
  }),
);

app.get('/config', route(() => ({ policy: { ...POLICY, recoveryDelaySec: RECOVERY_DELAY_SEC, coolingOffNewRecipientSec: COOLING_OFF_SEC }, dapps: DAPP_WHITELIST, sanctions: SANCTIONED })));

// ───────────────────────────── Clients ─────────────────────────────
app.post(
  '/clients',
  route((req) => {
    const { clientId, name, email, headless } = req.body as { clientId: string; name: string; email: string; headless?: boolean };
    if (!clientId || !name || !email) throw new HttpError(400, 'clientId, name, email required');
    if (headless && !HEADLESS_ALLOWED) throw new HttpError(403, 'Headless clients are disabled');
    db.update((d) => {
      d.clients[clientId] ??= { clientId, name, email, devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full', headless: !!headless };
    });
    return publicClient(getClient(clientId));
  }),
);

app.get('/clients/:id', route((req) => publicClient(getClient(String(req.params.id)))));

app.get(
  '/clients/:id/onchain',
  route(async (req) => {
    const c = getClient(String(req.params.id));
    if (!c.safeAddress) return { deployed: false };
    const [state, bal] = await Promise.all([safeState(c.safeAddress), balancesOf(c.safeAddress)]);
    return {
      deployed: true,
      safeAddress: c.safeAddress,
      ...state,
      nonce: state.nonce.toString(),
      eth: formatEther(bal.eth),
      usdc: formatUnits(bal.usdc, USDC_DECIMALS),
    };
  }),
);

app.post(
  '/clients/:id/cosigner-key',
  route((req) => {
    const c = getClient(String(req.params.id));
    return { address: getOrCreateCosigner(c.clientId) };
  }),
);

// ───────────────────────────── Passkeys ─────────────────────────────
app.post(
  '/webauthn/register/options',
  route(async (req) => {
    const { clientId, deviceType = 'desktop', recoveryAttestationId } = req.body;
    const c = getClient(clientId);
    if (recoveryAttestationId) await checkAttestation(recoveryAttestationId, c);
    return registrationOptions(c, deviceType, !!recoveryAttestationId);
  }),
);

app.post(
  '/webauthn/register/verify',
  route(async (req) => {
    const { clientId, response, deviceType = 'desktop', label = 'My device', recoveryAttestationId } = req.body;
    const c = getClient(clientId);
    if (recoveryAttestationId) await checkAttestation(recoveryAttestationId, c);
    const dev = await verifyRegistration(c, response, deviceType, label, !!recoveryAttestationId);
    logActivity({
      clientId,
      actor: 'client',
      type: recoveryAttestationId ? 'device.pending' : 'device.registered',
      message: recoveryAttestationId ? `New ${deviceType} passkey registered (activates when recovery completes)` : `Passkey registered on ${label} (${deviceType})`,
    });
    if (!recoveryAttestationId) notify({ clientId, channel: 'email', subject: 'New device linked to your SQ Wallet', body: `A passkey was registered on "${label}". If this was not you, contact Swissquote immediately.` });
    return { credentialId: dev.credentialId, status: dev.status };
  }),
);

app.post(
  '/webauthn/auth/options',
  route(async (req) => {
    const { clientId, purpose } = req.body;
    return authOptionsForAction(getClient(clientId), purpose ?? 'action');
  }),
);

app.post(
  '/webauthn/auth/verify',
  route(async (req) => {
    const { clientId, purpose, response } = req.body;
    await verifyAssertion(clientId, response, { purpose: purpose ?? 'action' });
    return { verified: true };
  }),
);

// ───────────────────────────── Wallet deployment (gasless) ─────────────────────────────
app.post(
  '/wallets/deploy',
  route(async (req) => {
    const { clientId, deviceAddress, recoveryAddress } = req.body as { clientId: string; deviceAddress: string; recoveryAddress: string };
    const c = getClient(clientId);
    if (c.safeAddress) return { safeAddress: c.safeAddress, txHash: c.deployTxHash, alreadyDeployed: true };
    if (!c.headless && !c.devices.some((d) => d.status === 'active')) throw new HttpError(400, 'Register a passkey first (device binding)');
    const cosigner = getOrCreateCosigner(clientId);
    const owners = [getAddress(deviceAddress), cosigner, getAddress(recoveryAddress)];
    if (new Set(owners.map((o) => o.toLowerCase())).size !== 3) throw new HttpError(400, 'Owners must be distinct');
    const salt = BigInt(hexlify(randomBytes(8)));
    const { safeAddress, txHash } = await relayerTask(() => deploySafe(relayer, owners, salt));
    db.update((d) => {
      const cl = d.clients[clientId];
      cl.safeAddress = safeAddress;
      cl.deployTxHash = txHash;
      cl.owners = { device: owners[0], cosigner, recovery: owners[2] };
    });
    logActivity({ clientId, actor: 'swissquote', type: 'wallet.deployed', message: `Safe 2-of-3 deployed at ${short(safeAddress)} (gas paid by Swissquote)`, txHash });
    notify({ clientId, channel: 'email', subject: 'Your SQ Wallet is ready', body: `Your self-custody wallet ${safeAddress} has been created. Keep your recovery kit safe.` });
    return { safeAddress, txHash, owners: { device: owners[0], cosigner, recovery: owners[2] }, explorer: explorerTx(txHash) };
  }),
);

// ───────────────────────────── EIP-1271 ownership proof (Travel Rule) ─────────────────────────────
app.post(
  '/wallets/ownership-proof',
  route(async (req) => {
    const { clientId, message, signatureK1 } = req.body as { clientId: string; message: string; signatureK1: string };
    const c = getClient(clientId);
    if (!c.safeAddress || !c.owners) throw new HttpError(400, 'Wallet not deployed');
    if (!message.includes(c.safeAddress) || !message.includes(clientId)) throw new HttpError(400, 'Statement must name this client and wallet');
    const dataHash = hashMessage(message);
    const signer = getAddress(verifyTypedData(safeDomain(c.safeAddress), SAFE_MESSAGE_TYPES, { message: dataHash }, signatureK1));
    if (signer !== getAddress(c.owners.device)) throw new HttpError(401, 'Statement not signed by the device key');
    const k2 = cosignerWallet(clientId);
    const sigK2 = await signSafeMessage(k2, c.safeAddress, dataHash);
    const signature = packSignatures([{ signer, signature: signatureK1 }, { signer: k2.address, signature: sigK2 }]);
    logActivity({ clientId, actor: 'swissquote', type: 'wallet.ownership-proof', message: 'EIP-1271 proof of ownership co-signed (Travel Rule self-hosted wallet verification)' });
    return { dataHash, signature };
  }),
);

// ───────────────────────────── Contacts ─────────────────────────────
app.post(
  '/clients/:id/contacts',
  route((req) => {
    const c = getClient(String(req.params.id));
    const { name, address, verifiedOwnership } = req.body as { name: string; address: string; verifiedOwnership?: boolean };
    const addr = getAddress(address);
    db.update((d) => {
      const cl = d.clients[c.clientId];
      const ex = cl.contacts.find((x) => x.address.toLowerCase() === addr.toLowerCase());
      if (ex) ex.name = name;
      else cl.contacts.push({ name, address: addr, addedAt: nowIso(), verifiedOwnership: !!verifiedOwnership });
    });
    logActivity({ clientId: c.clientId, actor: 'client', type: 'contact.added', message: `Contact "${name}" (${short(addr)}) added — trusted after ${COOLING_OFF_SEC}s cooling-off` });
    return publicClient(getClient(c.clientId));
  }),
);

// ───────────────────────────── Transactions ─────────────────────────────
async function analyse(c: Client, safeTx: SafeTx) {
  if (!c.safeAddress) throw new HttpError(400, 'Wallet not deployed');
  const [state, balances, safeTxHash] = await Promise.all([safeState(c.safeAddress), balancesOf(c.safeAddress), checkedSafeTxHash(c.safeAddress, safeTx)]);
  if (BigInt(safeTx.nonce) !== state.nonce) throw new HttpError(409, `Stale nonce (wallet nonce is ${state.nonce})`);
  const contactName = (a: string) => c.contacts.find((x) => x.address.toLowerCase() === a.toLowerCase())?.name;
  const decoded = decodeSafeTx(safeTx, c.safeAddress, contactName);
  const usage = usageOf(c);
  const policy = evaluatePolicy({
    tx: safeTx,
    decoded,
    safeAddress: c.safeAddress,
    contacts: c.contacts.filter((x) => isKnown(x.addedAt)),
    spentTodayUsdc: usage.spentUsdc,
    sponsoredToday: usage.sponsoredTx,
    balances,
  });
  const simulation = await simulateInner(c.safeAddress, safeTx);
  if (!simulation.success) {
    policy.checks.push({ id: 'simulation', label: 'Simulation (eth_call)', status: 'fail', detail: simulation.error });
    policy.decision = 'reject';
    policy.reasons.push(`Simulation failed: ${simulation.error}`);
  } else policy.checks.push({ id: 'simulation', label: 'Simulation (eth_call)', status: 'pass', detail: 'The transaction would succeed' });
  let after: { eth: string; usdc: string } = { eth: formatEther(balances.eth - BigInt(safeTx.value)), usdc: formatUnits(balances.usdc, USDC_DECIMALS) };
  if (decoded.kind === 'erc20-transfer' && decoded.token === 'USDC') after.usdc = formatUnits(balances.usdc - BigInt(decoded.amountRaw!), USDC_DECIMALS);
  return {
    safeTxHash,
    decoded,
    policy,
    simulation,
    state: { ...state, nonce: state.nonce.toString() },
    balances: { eth: formatEther(balances.eth), usdc: formatUnits(balances.usdc, USDC_DECIMALS) },
    balancesAfter: after,
    fees: { paidBy: 'Swissquote', clientCostChf: 0 },
  };
}

app.post(
  '/tx/prepare',
  route(async (req) => {
    const { clientId, safeTx } = req.body as { clientId: string; safeTx: SafeTx };
    const c = getClient(clientId);
    const a = await analyse(c, safeTx);
    const authOptions = c.headless ? null : await authOptionsForHash(c, a.safeTxHash);
    return { ...a, authOptions };
  }),
);

async function execute(r: TxRequest) {
  db.update((d) => {
    d.txRequests[r.id].status = 'executing';
    d.txRequests[r.id].updatedAt = nowIso();
  });
  try {
    const { txHash } = await cosignAndExecute(r.clientId, r.safeAddress, r.safeTx, { signer: r.deviceAddress, signature: r.signatureK1 });
    db.update((d) => {
      Object.assign(d.txRequests[r.id], { status: 'executed', txHash, updatedAt: nowIso() });
      const cl = d.clients[r.clientId];
      const u = usageOf(cl);
      u.sponsoredTx += 1;
      const dec = decodeSafeTx(r.safeTx, r.safeAddress);
      u.spentUsdc += usdcEquivalent(dec, r.safeTx);
    });
    logActivity({ clientId: r.clientId, actor: 'swissquote', type: 'tx.executed', message: `${r.summary} — co-signed by Swissquote, gas sponsored`, txHash });
    notify({ clientId: r.clientId, channel: 'app', subject: 'Transaction confirmed', body: `${r.summary}. ${explorerTx(txHash)}` });
    return txHash;
  } catch (e) {
    const error = shortErr(e);
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'failed', error, updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'system', type: 'tx.failed', message: `${r.summary} failed: ${error}` });
    throw new HttpError(502, `Execution failed: ${error}`);
  }
}

app.post(
  '/tx/submit',
  route(async (req) => {
    const { clientId, safeTx, signatureK1, webauthn } = req.body as { clientId: string; safeTx: SafeTx; signatureK1: string; webauthn?: any };
    const c = getClient(clientId);
    if (!c.owners || !c.safeAddress) throw new HttpError(400, 'Wallet not deployed');
    if (c.frozen) throw new HttpError(423, 'Wallet co-signing is frozen by Swissquote compliance');
    const a = await analyse(c, safeTx);
    // 1. Biometric passkey bound to this exact transaction
    await verifyAssertion(clientId, webauthn, { hash: a.safeTxHash });
    // 2. Device key signature from the current on-chain device owner
    const signer = recoverSigner(c.safeAddress, safeTx, signatureK1);
    if (!a.state.owners.includes(signer) || signer.toLowerCase() === c.owners.cosigner.toLowerCase())
      throw new HttpError(401, 'Signature is not from an authorised key of this wallet');
    if (signer.toLowerCase() !== c.owners.device.toLowerCase()) throw new HttpError(401, 'Day-to-day transactions must be signed by the device key');

    const base: TxRequest = {
      id: newId(),
      clientId,
      safeAddress: c.safeAddress,
      safeTx,
      safeTxHash: a.safeTxHash,
      summary: a.decoded.summary,
      warnings: a.decoded.warnings,
      policy: a.policy,
      signatureK1,
      deviceAddress: signer,
      status: 'awaiting-otp',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    if (a.policy.decision === 'reject') {
      base.status = 'rejected';
      db.update((d) => (d.txRequests[base.id] = base));
      logActivity({ clientId, actor: 'swissquote', type: 'tx.rejected', message: `Refused: ${a.decoded.summary} — ${a.policy.reasons.join('; ')}`, data: { requestId: base.id } });
      throw new HttpError(403, 'Swissquote refused to co-sign this transaction', { policy: a.policy, decoded: a.decoded, requestId: base.id });
    }

    if (a.policy.decision === 'approve') {
      base.status = 'executing';
      db.update((d) => (d.txRequests[base.id] = base));
      logActivity({ clientId, actor: 'client', type: 'tx.signed', message: `Signed with passkey + device key: ${a.decoded.summary}` });
      const txHash = await execute(base);
      return { status: 'executed', requestId: base.id, txHash, explorer: explorerTx(txHash), policy: a.policy, decoded: a.decoded };
    }

    // Step-up: OTP + cooling-off + four-eyes approval
    const code = String(Math.floor(100000 + Math.random() * 900000));
    base.otp = { code, expiresAt: new Date(Date.now() + POLICY.otpTtlSec * 1000).toISOString(), verified: false };
    db.update((d) => (d.txRequests[base.id] = base));
    notify({ clientId, channel: 'email', subject: `Your SQ Wallet code: ${code}`, body: `Enter ${code} to confirm: ${a.decoded.summary}. Never share this code. If you did not request it, cancel the transaction.`, action: { label: 'This was not me — cancel', kind: 'cancel-tx', id: base.id } });
    logActivity({ clientId, actor: 'swissquote', type: 'tx.step-up', message: `Reinforced checks required: ${a.decoded.summary} (${a.policy.reasons.join('; ')})`, data: { requestId: base.id } });
    return { status: 'step-up', requestId: base.id, policy: a.policy, decoded: a.decoded };
  }),
);

function txView(r: TxRequest) {
  const { otp, signatureK1, ...rest } = r;
  return { ...rest, otpVerified: otp?.verified ?? false, explorer: r.txHash ? explorerTx(r.txHash) : undefined };
}

app.get('/tx/:id', route((req) => {
  const r = db.data.txRequests[String(req.params.id)];
  if (!r) throw new HttpError(404, 'Unknown request');
  return txView(r);
}));

app.get('/clients/:id/tx-requests', route((req) => Object.values(db.data.txRequests).filter((r) => r.clientId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(txView)));

app.post(
  '/tx/:id/otp',
  route((req) => {
    const r = db.data.txRequests[String(req.params.id)];
    if (!r || r.status !== 'awaiting-otp') throw new HttpError(400, 'No code expected for this request');
    if (!r.otp || new Date(r.otp.expiresAt) < new Date()) throw new HttpError(400, 'Code expired');
    if (String(req.body.code).trim() !== r.otp.code) {
      logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.otp-failed', message: 'Wrong confirmation code entered' });
      throw new HttpError(401, 'Wrong code');
    }
    const until = new Date(Date.now() + COOLING_OFF_SEC * 1000).toISOString();
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'awaiting-approval', coolingOffUntil: until, otp: { ...r.otp!, verified: true }, updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.otp-ok', message: `Email code confirmed. Cooling-off until ${until.slice(11, 19)} UTC; awaiting compliance approval (four-eyes)` });
    return txView(db.data.txRequests[r.id]);
  }),
);

app.post(
  '/tx/:id/cancel',
  route((req) => {
    const r = db.data.txRequests[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Unknown request');
    if (['executed', 'executing'].includes(r.status)) throw new HttpError(409, 'Already executed');
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'cancelled', updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.cancelled', message: `Cancelled: ${r.summary}` });
    return txView(db.data.txRequests[r.id]);
  }),
);

// ───────────────────────────── Admin console (MOCK back-office) ─────────────────────────────
app.get(
  '/admin/overview',
  route(async () => {
    const bal = await provider.getBalance(relayerAddress).catch(() => null);
    return {
      relayer: { address: relayerAddress, eth: bal === null ? null : formatEther(bal) },
      clients: Object.values(db.data.clients).map(publicClient),
      txRequests: Object.values(db.data.txRequests).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(txView),
      recoveries: Object.values(db.data.recoveries).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      activity: db.data.activity.slice(-300).reverse(),
    };
  }),
);

app.post(
  '/admin/tx/:id/decision',
  route(async (req) => {
    const r = db.data.txRequests[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Unknown request');
    if (r.status !== 'awaiting-approval' && r.status !== 'awaiting-otp') throw new HttpError(409, `Request is ${r.status}`);
    const { decision, agent = 'compliance.officer@swissquote (mock)', note } = req.body as { decision: 'approved' | 'rejected'; agent?: string; note?: string };
    db.update((d) => {
      const x = d.txRequests[r.id];
      x.approval = { by: agent, at: nowIso(), decision, note };
      if (decision === 'rejected') x.status = 'rejected';
      x.updatedAt = nowIso();
    });
    logActivity({ clientId: r.clientId, actor: 'compliance', type: `tx.${decision}`, message: `Compliance ${decision}: ${r.summary}${note ? ` (${note})` : ''}` });
    if (decision === 'rejected') notify({ clientId: r.clientId, channel: 'app', subject: 'Transaction refused by compliance', body: `${r.summary}${note ? ` — ${note}` : ''}` });
    void tick();
    return txView(db.data.txRequests[r.id]);
  }),
);

app.post(
  '/admin/clients/:id/freeze',
  route((req) => {
    const c = getClient(String(req.params.id));
    const frozen = !!req.body.frozen;
    db.update((d) => (d.clients[c.clientId].frozen = frozen));
    logActivity({ clientId: c.clientId, actor: 'compliance', type: frozen ? 'client.frozen' : 'client.unfrozen', message: frozen ? 'Co-signing frozen (Swissquote can block, never move funds)' : 'Co-signing resumed' });
    return publicClient(getClient(c.clientId));
  }),
);

// ───────────────────────────── Recovery (owner rotation) ─────────────────────────────
async function checkAttestation(attestationId: string, c: Client) {
  const res = await fetch(`${PARTNER_URL}/attestations/${attestationId}`).catch(() => null);
  if (!res || !res.ok) throw new HttpError(403, 'Recovery partner attestation not found');
  const att = (await res.json()) as { clientId: string; decision: string; riskScore: number; expiresAt: string };
  if (att.clientId !== c.clientId || att.decision !== 'released') throw new HttpError(403, 'Recovery partner did not approve this recovery');
  if (new Date(att.expiresAt) < new Date()) throw new HttpError(403, 'Recovery attestation expired');
  return att;
}

app.post(
  '/recovery/request',
  route(async (req) => {
    const { clientId, safeTx, signatureK3, partnerAttestationId, newCredentialId } = req.body as {
      clientId: string;
      safeTx: SafeTx;
      signatureK3: string;
      partnerAttestationId: string;
      newCredentialId?: string;
    };
    const c = getClient(clientId);
    if (!c.safeAddress || !c.owners) throw new HttpError(400, 'Wallet not deployed');
    const att = await checkAttestation(partnerAttestationId, c);
    const state = await safeState(c.safeAddress);
    // Must be swapOwner(prev, currentDevice, newDevice) on this Safe
    if (safeTx.to.toLowerCase() !== c.safeAddress.toLowerCase() || safeTx.operation !== 0 || BigInt(safeTx.value) !== 0n)
      throw new HttpError(400, 'Recovery transaction must be a call to the wallet itself');
    const parsed = safeIface.parseTransaction({ data: safeTx.data });
    if (parsed?.name !== 'swapOwner') throw new HttpError(400, 'Recovery transaction must be swapOwner');
    const [, oldOwner, newOwner] = parsed.args as unknown as [string, string, string];
    if (getAddress(oldOwner) !== getAddress(c.owners.device)) throw new HttpError(400, 'Only the device key can be rotated');
    if (getAddress(oldOwner) === getAddress(c.owners.cosigner) || getAddress(oldOwner) === getAddress(c.owners.recovery)) throw new HttpError(400, 'Cannot rotate this key');
    if (BigInt(safeTx.nonce) !== state.nonce) throw new HttpError(409, 'Stale nonce');
    const hash = await checkedSafeTxHash(c.safeAddress, safeTx);
    const signer = recoverSigner(c.safeAddress, safeTx, signatureK3);
    if (signer !== getAddress(c.owners.recovery)) throw new HttpError(401, 'Not signed by the recovery key');
    const open = Object.values(db.data.recoveries).find((r) => r.clientId === clientId && r.status === 'pending-delay');
    if (open) throw new HttpError(409, 'A recovery is already in progress');

    const executeAfter = new Date(Date.now() + RECOVERY_DELAY_SEC * 1000).toISOString();
    const r = {
      id: newId(),
      clientId,
      safeAddress: c.safeAddress,
      oldDevice: getAddress(oldOwner),
      newDevice: getAddress(newOwner),
      safeTx,
      safeTxHash: hash,
      signatureK3,
      partnerAttestationId,
      riskScore: att.riskScore,
      newCredentialId,
      status: 'pending-delay' as const,
      executeAfter,
      createdAt: nowIso(),
    };
    db.update((d) => (d.recoveries[r.id] = r));
    logActivity({ clientId, actor: 'client', type: 'recovery.requested', message: `Device recovery requested: ${short(r.oldDevice)} → ${short(r.newDevice)}. Security delay until ${executeAfter.slice(11, 19)} UTC` });
    for (const channel of ['email', 'sms', 'app'] as const)
      notify({
        clientId,
        channel,
        subject: '⚠️ Wallet recovery started',
        body: `A recovery of your SQ Wallet was started from a new device. It will complete at ${executeAfter.slice(11, 19)} UTC. If this was not you, cancel now.`,
        action: { label: 'This was not me — cancel', kind: 'cancel-recovery', id: r.id },
      });
    return r;
  }),
);

app.get('/recovery/:id', route((req) => {
  const r = db.data.recoveries[String(req.params.id)];
  if (!r) throw new HttpError(404, 'Unknown recovery');
  return r;
}));

app.get('/clients/:id/recoveries', route((req) => Object.values(db.data.recoveries).filter((r) => r.clientId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

app.post(
  '/recovery/:id/cancel',
  route((req) => {
    const r = db.data.recoveries[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Unknown recovery');
    if (r.status !== 'pending-delay') throw new HttpError(409, `Recovery is ${r.status}`);
    db.update((d) => {
      d.recoveries[r.id].status = 'cancelled';
      const cl = d.clients[r.clientId];
      cl.devices = cl.devices.map((dev) => (dev.status === 'pending-recovery' ? { ...dev, status: 'revoked' } : dev));
    });
    logActivity({ clientId: r.clientId, actor: 'client', type: 'recovery.cancelled', message: `Recovery cancelled by the client (${req.body?.by ?? 'Swissquote account'}). Nothing changed on-chain.` });
    return db.data.recoveries[r.id];
  }),
);

/** Called by the recovery partner when it refuses a recovery (e.g. attacker): the real client is warned. */
app.post(
  '/recovery/alerts',
  route((req) => {
    const { clientId, message, riskScore } = req.body as { clientId: string; message: string; riskScore?: number };
    getClient(clientId);
    logActivity({ clientId, actor: 'partner', type: 'recovery.refused', message, data: { riskScore } });
    notify({ clientId, channel: 'app', subject: '🚫 Blocked recovery attempt', body: `${message} Your wallet is safe. If you still have your device, no action is needed.` });
    return { ok: true };
  }),
);

async function executeRecovery(id: string) {
  const r = db.data.recoveries[id];
  db.update((d) => (d.recoveries[id].status = 'executing'));
  try {
    const { txHash } = await cosignAndExecute(r.clientId, r.safeAddress, r.safeTx, { signer: db.data.clients[r.clientId].owners!.recovery, signature: r.signatureK3 });
    db.update((d) => {
      Object.assign(d.recoveries[id], { status: 'completed', txHash });
      const cl = d.clients[r.clientId];
      cl.owners!.device = r.newDevice;
      cl.devices = cl.devices.map((dev) =>
        dev.status === 'pending-recovery' ? { ...dev, status: 'active' } : dev.status === 'active' ? { ...dev, status: 'revoked' } : dev,
      );
    });
    logActivity({ clientId: r.clientId, actor: 'swissquote', type: 'recovery.completed', message: `Old device key ${short(r.oldDevice)} revoked on-chain, new key ${short(r.newDevice)} active`, txHash });
    notify({ clientId: r.clientId, channel: 'email', subject: 'Wallet recovery completed', body: `Your old device can no longer sign. ${explorerTx(txHash)}` });
  } catch (e) {
    db.update((d) => Object.assign(d.recoveries[id], { status: 'failed', error: shortErr(e) }));
    logActivity({ clientId: r.clientId, actor: 'system', type: 'recovery.failed', message: `Recovery failed: ${shortErr(e)}` });
  }
}

// ───────────────────────────── Inbox & activity ─────────────────────────────
app.get('/clients/:id/inbox', route((req) => db.data.inbox.filter((m) => m.clientId === req.params.id).slice(-100).reverse()));
app.get('/clients/:id/activity', route((req) => db.data.activity.filter((e) => e.clientId === req.params.id).slice(-200).reverse()));

// ───────────────────────────── Background ticker ─────────────────────────────
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const r of Object.values(db.data.txRequests)) {
      if (r.status === 'awaiting-approval' && r.approval?.decision === 'approved') {
        if (r.coolingOffUntil && new Date(r.coolingOffUntil).getTime() > now) continue;
        await execute(r).catch(() => undefined);
      }
    }
    for (const r of Object.values(db.data.recoveries)) {
      if (r.status === 'pending-delay' && new Date(r.executeAfter).getTime() <= now) await executeRecovery(r.id);
    }
  } finally {
    ticking = false;
  }
}
setInterval(() => void tick(), 3000);

// ───────────────────────────── Errors ─────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  res.status(500).json({ error: shortErr(err) });
});

app.listen(PORTS.cosigner, () => {
  console.log(`sq-cosigner listening on http://localhost:${PORTS.cosigner}`);
  console.log(`Relayer (gas sponsor) address: ${relayerAddress}`);
  provider
    .getBalance(relayerAddress)
    .then((b) => console.log(`Relayer balance: ${formatEther(b)} SepoliaETH${b === 0n ? '  ⚠️  needs funding — see POUR_NOA.md' : ''}`))
    .catch(() => console.log('Could not read relayer balance (RPC)'));
});
