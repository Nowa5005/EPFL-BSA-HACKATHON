// sq-cosigner — Swissquote co-signing service (K2), policy engine, gas relayer, activity log.
// Separate process with its own data/ directory. Holds K2 (mock HSM) + relayer key. Never sees K1 or K3.

import { loadDotenv, newId, nowIso } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { formatEther, formatUnits, getAddress, randomBytes, hexlify, hashMessage, verifyTypedData, MaxUint256 } from 'ethers';
import { randomInt } from 'node:crypto';
import {
  PORTS,
  POLICY,
  MOCK_ETH_CHF,
  conditionsChanged,
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
import { db, DEFAULT_PREFERENCES, getClient, HttpError, logActivity, notify, usageOf, type Client, type TxRequest } from './db';
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
  estimateFees,
} from './chain';
import { validateSafeTx } from './validate';
import { consumePreview, createPreview } from './previews';
import { verifyBackupCode } from './backupCode';
import { effectiveTier, registerFeatureRoutes, tickScheduled } from './features';
import { evaluatePolicy, usdcEquivalent, DAPP_WHITELIST, SANCTIONED } from './policy';
import { confirmWalletTx, docIdOf, referenceOf, simulateReceive, trackIncoming, upsertWalletTx, type WalletTx } from './walletTx';
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
    frozen: !!c.frozen,
    frozenBy: c.frozenBy ?? null,
    preferences: { ...DEFAULT_PREFERENCES, ...c.preferences },
    backupCode: c.backupCode ? { configured: true, createdAt: c.backupCode.createdAt, locked: !!c.backupCode.lockedUntil && new Date(c.backupCode.lockedUntil).getTime() > Date.now() } : { configured: false },
    plan: effectiveTier(c),
    demoFeeChf: c.demoFeeChf ?? null,
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
    if (!clientId || !name || !email) throw new HttpError(400, 'clientId, name, email requis');
    if (headless && !HEADLESS_ALLOWED) throw new HttpError(403, 'Clients sans navigateur désactivés');
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
      // demo-only fictitious receptions, shown separately from the real on-chain balance
      simulatedUsdc: Object.values(db.data.walletTxs ?? {})
        .filter((t) => t.clientId === c.clientId && t.simulated && t.status === 'confirmed')
        .reduce((n, t) => n + Number(t.amount), 0),
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
      message: recoveryAttestationId ? `Nouvelle passkey (${deviceType === 'mobile' ? 'mobile' : 'ordinateur'}) enregistrée — active à la fin de la récupération` : `Passkey enregistrée sur ${label} (${deviceType === 'mobile' ? 'mobile' : 'ordinateur'})`,
    });
    if (!recoveryAttestationId) notify({ clientId, channel: 'email', subject: 'Nouvel appareil lié à My Wall', body: `Une passkey a été enregistrée sur « ${label} ». Si ce n'est pas vous, contactez Swissquote immédiatement.` });
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
    if (c.safeAddress) {
      if (c.owners && getAddress(deviceAddress) === getAddress(c.owners.device)) return { safeAddress: c.safeAddress, txHash: c.deployTxHash, alreadyDeployed: true };
      throw new HttpError(409, "Un wallet existe déjà pour ce client. Sur un nouvel appareil, utilisez « J'ai perdu mon appareil » pour le récupérer.");
    }
    if (!c.headless && !c.devices.some((d) => d.status === 'active')) throw new HttpError(400, "Créez d'abord une passkey (liaison à l'appareil).");
    const cosigner = getOrCreateCosigner(clientId);
    const owners = [getAddress(deviceAddress), cosigner, getAddress(recoveryAddress)];
    if (new Set(owners.map((o) => o.toLowerCase())).size !== 3) throw new HttpError(400, 'Les clés doivent être distinctes');
    const salt = BigInt(hexlify(randomBytes(8)));
    const { safeAddress, txHash } = await relayerTask(() => deploySafe(relayer, owners, salt));
    db.update((d) => {
      const cl = d.clients[clientId];
      cl.safeAddress = safeAddress;
      cl.deployTxHash = txHash;
      cl.owners = { device: owners[0], cosigner, recovery: owners[2] };
    });
    logActivity({ clientId, actor: 'swissquote', type: 'wallet.deployed', message: `Wallet ouvert sur Ethereum (Safe 2 sur 3, ${short(safeAddress)}) — frais offerts par Swissquote`, txHash });
    notify({ clientId, channel: 'email', subject: 'Votre wallet My Wall est prêt', body: `Votre wallet ${safeAddress} a été créé. Conservez votre kit de récupération en lieu sûr.` });
    return { safeAddress, txHash, owners: { device: owners[0], cosigner, recovery: owners[2] }, explorer: explorerTx(txHash) };
  }),
);

// ───────────────────────────── EIP-1271 ownership proof (Travel Rule) ─────────────────────────────
app.post(
  '/wallets/ownership-proof',
  route(async (req) => {
    const { clientId, message, signatureK1 } = req.body as { clientId: string; message: string; signatureK1: string };
    const c = getClient(clientId);
    if (!c.safeAddress || !c.owners) throw new HttpError(400, "Wallet pas encore ouvert");
    if (!message.includes(c.safeAddress) || !message.includes(clientId)) throw new HttpError(400, 'La déclaration doit mentionner ce client et ce wallet');
    const dataHash = hashMessage(message);
    const signer = getAddress(verifyTypedData(safeDomain(c.safeAddress), SAFE_MESSAGE_TYPES, { message: dataHash }, signatureK1));
    if (signer !== getAddress(c.owners.device)) throw new HttpError(401, "Déclaration non signée par la clé de l'appareil");
    const k2 = cosignerWallet(clientId);
    const sigK2 = await signSafeMessage(k2, c.safeAddress, dataHash);
    const signature = packSignatures([{ signer, signature: signatureK1 }, { signer: k2.address, signature: sigK2 }]);
    logActivity({ clientId, actor: 'swissquote', type: 'wallet.ownership-proof', message: 'Preuve de propriété EIP-1271 co-signée (vérification Travel Rule du wallet)' });
    return { dataHash, signature };
  }),
);

// ───────────────────────────── Contacts ─────────────────────────────
app.post(
  '/clients/:id/contacts',
  route((req) => {
    const c = getClient(String(req.params.id));
    const { name, address, verifiedOwnership, email } = req.body as { name: string; address: string; verifiedOwnership?: boolean; email?: string };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Adresse email invalide');
    const addr = getAddress(address);
    db.update((d) => {
      const cl = d.clients[c.clientId];
      const ex = cl.contacts.find((x) => x.address.toLowerCase() === addr.toLowerCase());
      if (ex) {
        ex.name = name;
        if (email !== undefined) ex.email = email || undefined;
      } else cl.contacts.push({ name, address: addr, addedAt: nowIso(), verifiedOwnership: !!verifiedOwnership, email: email || undefined });
    });
    logActivity({ clientId: c.clientId, actor: 'client', type: 'contact.added', message: `Contact « ${name} » (${short(addr)}) ajouté — reconnu après ${COOLING_OFF_SEC} s de délai de réflexion` });
    return publicClient(getClient(c.clientId));
  }),
);

app.post(
  '/clients/:id/privacy',
  route((req) => {
    const c = getClient(String(req.params.id));
    const privacy = req.body.privacy as Client['privacy'];
    if (!['full', 'balance-only', 'none'].includes(privacy)) throw new HttpError(400, 'Réglage de confidentialité invalide');
    db.update((d) => (d.clients[c.clientId].privacy = privacy));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'settings.privacy', message: `Vue consolidée Swissquote : « ${({ full: 'complète', 'balance-only': 'solde uniquement', none: 'aucune' } as Record<string, string>)[privacy]} »` });
    return publicClient(getClient(c.clientId));
  }),
);

// ───────────────────────────── Transactions ─────────────────────────────
const spenderName = (c: Client, a: string) => DAPP_WHITELIST[a.toLowerCase()]?.name ?? c.contacts.find((x) => x.address.toLowerCase() === a.toLowerCase())?.name;

/** Network fee estimate in CHF (or the demo override, clearly flagged). */
async function feeEstimate(c: Client, safeAddress: string, safeTx: SafeTx) {
  const f = await estimateFees(safeAddress, safeTx);
  const eth = formatEther(f.wei);
  const chf = Math.round(Number(eth) * MOCK_ETH_CHF * 100) / 100;
  if (typeof c.demoFeeChf === 'number') return { available: true, chf: c.demoFeeChf, eth, gasUnits: f.gasUnits, demo: true };
  return { available: f.available, chf, eth, gasUnits: f.gasUnits, demo: false };
}

/** Everything the client sees before signing — recomputed by the co-signer from the calldata itself. */
async function analyse(c: Client, safeTx: SafeTx) {
  if (!c.safeAddress) throw new HttpError(400, "Wallet pas encore ouvert");
  const intent = validateSafeTx(safeTx, c.safeAddress); // independent decoding; throws on anything unsupported
  const [state, balances, safeTxHash, fee] = await Promise.all([safeState(c.safeAddress), balancesOf(c.safeAddress), checkedSafeTxHash(c.safeAddress, safeTx), feeEstimate(c, c.safeAddress, safeTx)]);
  if (BigInt(safeTx.nonce) !== state.nonce) throw new HttpError(409, `Transaction périmée (une autre opération est passée entre-temps). Recommencez.`);
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
    policy.checks.push({ id: 'simulation', label: 'Simulation sur Ethereum', status: 'fail', detail: simulation.error });
    policy.decision = 'reject';
    policy.reasons.push(`Simulation en échec : ${simulation.error}`);
  } else policy.checks.push({ id: 'simulation', label: 'Simulation sur Ethereum', status: 'pass', detail: 'L’opération réussirait (estimation, pas une garantie)' });

  const usdcAfter = intent.kind === 'erc20-transfer' ? balances.usdc - BigInt(intent.amountRaw) : balances.usdc;
  const ethAfter = intent.kind === 'eth-transfer' ? balances.eth - BigInt(intent.value) : balances.eth;
  const debits = intent.kind === 'erc20-transfer' ? [{ asset: 'USDC', amount: formatUnits(intent.amountRaw, USDC_DECIMALS) }] : intent.kind === 'eth-transfer' ? [{ asset: 'ETH', amount: formatEther(intent.value) }] : [];
  const receives =
    intent.kind === 'erc20-transfer'
      ? [{ party: contactName(intent.to) ?? intent.to, asset: 'USDC', amount: formatUnits(intent.amountRaw, USDC_DECIMALS) }]
      : intent.kind === 'eth-transfer'
        ? [{ party: contactName(intent.to) ?? intent.to, asset: 'ETH', amount: formatEther(intent.value) }]
        : [];
  const approvals =
    intent.kind === 'erc20-approve'
      ? [
          {
            token: 'USDC',
            tokenAddress: intent.token,
            spender: intent.spender,
            spenderName: spenderName(c, intent.spender),
            amount: BigInt(intent.amountRaw) >= MaxUint256 / 2n ? 'illimité' : formatUnits(intent.amountRaw, USDC_DECIMALS),
            amountRaw: intent.amountRaw,
            unlimited: BigInt(intent.amountRaw) >= MaxUint256 / 2n,
            revocation: intent.amountRaw === '0',
          },
        ]
      : [];
  return {
    intent,
    safeTxHash,
    decoded,
    policy,
    simulation,
    state: { ...state, nonce: state.nonce.toString() },
    balances: { eth: formatEther(balances.eth), usdc: formatUnits(balances.usdc, USDC_DECIMALS) },
    balancesAfter: { eth: formatEther(ethAfter), usdc: formatUnits(usdcAfter, USDC_DECIMALS) },
    debits,
    receives,
    approvals,
    fee,
    fees: { paidBy: 'Swissquote', clientCostChf: 0, network: fee, serviceCommission: { bps: 0, amount: '0', note: 'Aucune commission sur les envois, réceptions et autorisations' } },
  };
}

app.post(
  '/tx/prepare',
  route(async (req) => {
    const { clientId, safeTx } = req.body as { clientId: string; safeTx: SafeTx };
    const c = getClient(clientId);
    const a = await analyse(c, safeTx);
    const p = createPreview({ clientId, safeAddress: c.safeAddress!, safeTx, safeTxHash: a.safeTxHash, intent: a.intent, fee: a.fee });
    const authOptions = c.headless ? null : await authOptionsForHash(c, p.challenge);
    return { ...a, previewId: p.id, expiresAt: p.expiresAt, authOptions, backupCodeAvailable: !!c.backupCode };
  }),
);

async function execute(r: TxRequest) {
  db.update((d) => {
    d.txRequests[r.id].status = 'executing';
    d.txRequests[r.id].updatedAt = nowIso();
  });
  // Money movements also appear in the client's transaction history (détectée → en attente → confirmée).
  const dec0 = decodeSafeTx(r.safeTx, r.safeAddress);
  const isTransfer = (dec0.kind === 'erc20-transfer' && dec0.token === 'USDC') || dec0.kind === 'eth-transfer';
  const contact = isTransfer ? db.data.clients[r.clientId].contacts.find((c) => c.address.toLowerCase() === dec0.recipient!.toLowerCase()) : undefined;
  const wtx = isTransfer
    ? upsertWalletTx({
        clientId: r.clientId,
        kind: 'send',
        status: 'detected',
        asset: dec0.token === 'USDC' ? 'USDC' : 'ETH',
        amount: dec0.amount!,
        from: r.safeAddress,
        to: dec0.recipient!,
        counterpartyName: contact ? (contact.verifiedOwnership ? 'Compte Swissquote' : contact.name) : undefined,
        source: 'wallet',
        feesSponsored: true,
        requestId: r.id,
        note: r.note,
      })
    : null;
  try {
    const { txHash } = await cosignAndExecute(r.clientId, r.safeAddress, r.safeTx, { signer: r.deviceAddress, signature: r.signatureK1 }, (hash) => {
      if (wtx) upsertWalletTx({ id: wtx.id, clientId: r.clientId, status: 'pending', txHash: hash });
    });
    if (wtx) confirmWalletTx(wtx.id);
    db.update((d) => {
      Object.assign(d.txRequests[r.id], { status: 'executed', txHash, updatedAt: nowIso() });
      const cl = d.clients[r.clientId];
      const u = usageOf(cl);
      u.sponsoredTx += 1;
      const dec = decodeSafeTx(r.safeTx, r.safeAddress);
      u.spentUsdc += usdcEquivalent(dec, r.safeTx);
    });
    logActivity({ clientId: r.clientId, actor: 'swissquote', type: 'tx.executed', message: `${r.summary} — co-signé par Swissquote, frais offerts`, txHash });
    notify({ clientId: r.clientId, channel: 'app', subject: 'Transaction confirmée', body: `${r.summary}. ${explorerTx(txHash)}` });
    return txHash;
  } catch (e) {
    const error = shortErr(e);
    if (wtx) upsertWalletTx({ id: wtx.id, clientId: r.clientId, status: 'failed', error });
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'failed', error, updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'system', type: 'tx.failed', message: `${r.summary} — échec : ${error}` });
    throw new HttpError(502, `L'exécution a échoué : ${error}`);
  }
}

app.post(
  '/tx/submit',
  route(async (req) => {
    const { clientId, previewId, safeTx: submitted, signatureK1, webauthn, backupCode, note } = req.body as {
      clientId: string;
      previewId: string;
      safeTx?: SafeTx;
      signatureK1: string;
      webauthn?: any;
      backupCode?: string;
      note?: string;
    };
    const c = getClient(clientId);
    if (!c.owners || !c.safeAddress) throw new HttpError(400, "Wallet pas encore ouvert");
    if (c.frozen) throw new HttpError(423, c.frozenBy === 'client' ? 'Vous avez gelé la co-signature de ce wallet : dégelez-la dans Sécurité pour continuer.' : 'La co-signature est suspendue par la conformité Swissquote');
    if (!previewId) throw new HttpError(400, 'Aperçu manquant : vérifiez l’opération avant de la confirmer.');
    // 0. The exact SafeTx that was simulated and shown (single use, not expired, unchanged byte for byte)
    const p = consumePreview(previewId, clientId, submitted);
    const safeTx = p.safeTx;
    const a = await analyse(c, safeTx); // re-validated and re-simulated by the co-signer
    if (p.fee.available && a.fee.available && conditionsChanged(p.fee.chf, a.fee.chf, POLICY.feeChange))
      throw new HttpError(409, `Les frais estimés sont passés de ${p.fee.chf.toFixed(2)} à ${a.fee.chf.toFixed(2)} CHF. Vérifiez les nouvelles conditions avant de continuer.`, {
        code: 'conditions-changed',
        previous: p.fee.chf,
        current: a.fee.chf,
      });
    // 1. User verification bound to this exact preview: passkey, or the backup code (single-use preview = no replay)
    if (backupCode) verifyBackupCode(clientId, backupCode);
    else await verifyAssertion(clientId, webauthn, { hash: p.challenge });
    // 2. Device key signature from the current on-chain device owner
    const signer = recoverSigner(c.safeAddress, safeTx, signatureK1);
    if (!a.state.owners.includes(signer) || signer.toLowerCase() === c.owners.cosigner.toLowerCase())
      throw new HttpError(401, "La signature ne provient pas d'une clé autorisée de ce wallet");
    if (signer.toLowerCase() !== c.owners.device.toLowerCase()) throw new HttpError(401, "Les opérations courantes doivent être signées par la clé de l'appareil");

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
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 140) : undefined,
      status: 'awaiting-otp',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    if (a.policy.decision === 'reject') {
      base.status = 'rejected';
      db.update((d) => (d.txRequests[base.id] = base));
      logActivity({ clientId, actor: 'swissquote', type: 'tx.rejected', message: `Refusé : ${a.decoded.summary} — ${a.policy.reasons.join(' ; ')}`, data: { requestId: base.id } });
      throw new HttpError(403, 'Swissquote refuse de co-signer cette transaction', { policy: a.policy, decoded: a.decoded, requestId: base.id });
    }

    if (a.policy.decision === 'approve') {
      base.status = 'executing';
      db.update((d) => (d.txRequests[base.id] = base));
      logActivity({ clientId, actor: 'client', type: 'tx.signed', message: `Signé avec ${backupCode ? 'code de secours' : 'passkey'} + clé de l'appareil : ${a.decoded.summary}` });
      const txHash = await execute(base);
      return { status: 'executed', requestId: base.id, txHash, explorer: explorerTx(txHash), policy: a.policy, decoded: a.decoded };
    }

    // Step-up: OTP + cooling-off + four-eyes approval
    const code = String(randomInt(100000, 1000000)); // CSPRNG
    base.otp = { code, expiresAt: new Date(Date.now() + POLICY.otpTtlSec * 1000).toISOString(), verified: false };
    db.update((d) => (d.txRequests[base.id] = base));
    notify({ clientId, channel: 'email', subject: `Votre code My Wall : ${code}`, body: `Saisissez ${code} pour confirmer : ${a.decoded.summary}. Ne communiquez jamais ce code. Si vous n'êtes pas à l'origine de cette demande, annulez l'opération.`, action: { label: "Ce n'est pas moi — annuler", kind: 'cancel-tx', id: base.id } });
    logActivity({ clientId, actor: 'swissquote', type: 'tx.step-up', message: `Contrôles renforcés requis : ${a.decoded.summary} (${a.policy.reasons.join(' ; ')})`, data: { requestId: base.id } });
    return { status: 'step-up', requestId: base.id, policy: a.policy, decoded: a.decoded };
  }),
);

function txView(r: TxRequest) {
  const { otp, signatureK1, ...rest } = r;
  return { ...rest, otpVerified: otp?.verified ?? false, explorer: r.txHash ? explorerTx(r.txHash) : undefined };
}

app.get('/tx/:id', route((req) => {
  const r = db.data.txRequests[String(req.params.id)];
  if (!r) throw new HttpError(404, 'Demande inconnue');
  return txView(r);
}));

app.get('/clients/:id/tx-requests', route((req) => Object.values(db.data.txRequests).filter((r) => r.clientId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(txView)));

app.post(
  '/tx/:id/otp',
  route((req) => {
    const r = db.data.txRequests[String(req.params.id)];
    if (!r || r.status !== 'awaiting-otp') throw new HttpError(400, 'Aucun code attendu pour cette demande');
    if (!r.otp || new Date(r.otp.expiresAt) < new Date()) throw new HttpError(400, 'Code expiré');
    if (String(req.body.code).trim() !== r.otp.code) {
      logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.otp-failed', message: 'Code de confirmation erroné saisi' });
      throw new HttpError(401, 'Code incorrect');
    }
    const until = new Date(Date.now() + COOLING_OFF_SEC * 1000).toISOString();
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'awaiting-approval', coolingOffUntil: until, otp: { ...r.otp!, verified: true }, updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.otp-ok', message: `Code email confirmé. Délai de réflexion jusqu'à ${new Date(until).toLocaleTimeString('fr-CH', { timeZone: 'Europe/Zurich' })} ; validation conformité (quatre yeux) en attente` });
    return txView(db.data.txRequests[r.id]);
  }),
);

app.post(
  '/tx/:id/cancel',
  route((req) => {
    const r = db.data.txRequests[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Demande inconnue');
    if (['executed', 'executing'].includes(r.status)) throw new HttpError(409, 'Déjà exécutée');
    db.update((d) => Object.assign(d.txRequests[r.id], { status: 'cancelled', updatedAt: nowIso() }));
    logActivity({ clientId: r.clientId, actor: 'client', type: 'tx.cancelled', message: `Annulé : ${r.summary}` });
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
    if (!r) throw new HttpError(404, 'Demande inconnue');
    if (r.status !== 'awaiting-approval' && r.status !== 'awaiting-otp') throw new HttpError(409, `Demande déjà traitée (${r.status})`);
    const { decision, agent = 'compliance.officer@swissquote (mock)', note } = req.body as { decision: 'approved' | 'rejected'; agent?: string; note?: string };
    db.update((d) => {
      const x = d.txRequests[r.id];
      x.approval = { by: agent, at: nowIso(), decision, note };
      if (decision === 'rejected') x.status = 'rejected';
      x.updatedAt = nowIso();
    });
    logActivity({ clientId: r.clientId, actor: 'compliance', type: `tx.${decision}`, message: `Conformité — ${decision === 'approved' ? 'validé' : 'refusé'} : ${r.summary}${note ? ` (${note})` : ''}` });
    if (decision === 'rejected') notify({ clientId: r.clientId, channel: 'app', subject: 'Opération refusée par la conformité', body: `${r.summary}${note ? ` — ${note}` : ''}` });
    void tick();
    return txView(db.data.txRequests[r.id]);
  }),
);

app.post(
  '/admin/clients/:id/freeze',
  route((req) => {
    const c = getClient(String(req.params.id));
    const frozen = !!req.body.frozen;
    db.update((d) => {
      d.clients[c.clientId].frozen = frozen;
      d.clients[c.clientId].frozenBy = frozen ? 'compliance' : undefined;
    });
    logActivity({ clientId: c.clientId, actor: 'compliance', type: frozen ? 'client.frozen' : 'client.unfrozen', message: frozen ? 'Co-signature suspendue (Swissquote peut bloquer, jamais déplacer les fonds)' : 'Co-signature rétablie' });
    return publicClient(getClient(c.clientId));
  }),
);

// ───────────────────────────── Recovery (owner rotation) ─────────────────────────────
async function checkAttestation(attestationId: string, c: Client) {
  const res = await fetch(`${PARTNER_URL}/attestations/${attestationId}`).catch(() => null);
  if (!res || !res.ok) throw new HttpError(403, 'Attestation du partenaire de récupération introuvable');
  const att = (await res.json()) as { clientId: string; decision: string; riskScore: number; expiresAt: string };
  if (att.clientId !== c.clientId || att.decision !== 'released') throw new HttpError(403, "Le partenaire de récupération n'a pas validé cette récupération");
  if (new Date(att.expiresAt) < new Date()) throw new HttpError(403, 'Attestation de récupération expirée');
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
    if (!c.safeAddress || !c.owners) throw new HttpError(400, "Wallet pas encore ouvert");
    const att = await checkAttestation(partnerAttestationId, c);
    const state = await safeState(c.safeAddress);
    // Must be swapOwner(prev, currentDevice, newDevice) on this Safe
    if (safeTx.to.toLowerCase() !== c.safeAddress.toLowerCase() || safeTx.operation !== 0 || BigInt(safeTx.value) !== 0n)
      throw new HttpError(400, 'La récupération doit porter sur le wallet lui-même');
    const intent = validateSafeTx(safeTx, c.safeAddress, { allowOwnerChange: true }); // same strict checks as any co-signature
    if (intent.kind !== 'swap-owner') throw new HttpError(400, 'La récupération doit être un remplacement de clé (swapOwner)');
    const parsed = safeIface.parseTransaction({ data: safeTx.data })!;
    const [, oldOwner, newOwner] = parsed.args as unknown as [string, string, string];
    if (getAddress(oldOwner) !== getAddress(c.owners.device)) throw new HttpError(400, "Seule la clé de l'appareil peut être remplacée");
    if (getAddress(oldOwner) === getAddress(c.owners.cosigner) || getAddress(oldOwner) === getAddress(c.owners.recovery)) throw new HttpError(400, 'Cette clé ne peut pas être remplacée');
    if (BigInt(safeTx.nonce) !== state.nonce) throw new HttpError(409, 'Opération périmée, recommencez');
    const hash = await checkedSafeTxHash(c.safeAddress, safeTx);
    const signer = recoverSigner(c.safeAddress, safeTx, signatureK3);
    if (signer !== getAddress(c.owners.recovery)) throw new HttpError(401, 'Non signé par la clé de secours');
    const open = Object.values(db.data.recoveries).find((r) => r.clientId === clientId && r.status === 'pending-delay');
    if (open) throw new HttpError(409, 'Une récupération est déjà en cours');

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
    logActivity({ clientId, actor: 'client', type: 'recovery.requested', message: `Récupération demandée : ${short(r.oldDevice)} → ${short(r.newDevice)}. Délai de sécurité jusqu'à ${new Date(executeAfter).toLocaleTimeString('fr-CH', { timeZone: 'Europe/Zurich' })}` });
    for (const channel of ['email', 'sms', 'app'] as const)
      notify({
        clientId,
        channel,
        subject: 'Récupération de wallet en cours',
        body: `Une récupération de votre wallet My Wall a été lancée depuis un nouvel appareil. Elle aboutira à ${new Date(executeAfter).toLocaleTimeString('fr-CH', { timeZone: 'Europe/Zurich' })}. Si ce n'est pas vous, annulez maintenant.`,
        action: { label: "Ce n'est pas moi — annuler", kind: 'cancel-recovery', id: r.id },
      });
    return r;
  }),
);

app.get('/recovery/:id', route((req) => {
  const r = db.data.recoveries[String(req.params.id)];
  if (!r) throw new HttpError(404, 'Récupération inconnue');
  return r;
}));

app.get('/clients/:id/recoveries', route((req) => Object.values(db.data.recoveries).filter((r) => r.clientId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

app.post(
  '/recovery/:id/cancel',
  route((req) => {
    const r = db.data.recoveries[String(req.params.id)];
    if (!r) throw new HttpError(404, 'Récupération inconnue');
    if (r.status !== 'pending-delay') throw new HttpError(409, `Récupération déjà traitée (${r.status})`);
    db.update((d) => {
      d.recoveries[r.id].status = 'cancelled';
      const cl = d.clients[r.clientId];
      cl.devices = cl.devices.map((dev) => (dev.status === 'pending-recovery' ? { ...dev, status: 'revoked' } : dev));
    });
    logActivity({ clientId: r.clientId, actor: 'client', type: 'recovery.cancelled', message: `Récupération annulée par le client (${req.body?.by ?? 'compte Swissquote'}). Rien n'a changé sur la blockchain.` });
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
    notify({ clientId, channel: 'app', subject: 'Tentative de récupération bloquée', body: `${message} Votre wallet est en sécurité. Si vous avez toujours votre appareil, aucune action n'est nécessaire.` });
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
    logActivity({ clientId: r.clientId, actor: 'swissquote', type: 'recovery.completed', message: `Ancienne clé d'appareil ${short(r.oldDevice)} révoquée sur la blockchain, nouvelle clé ${short(r.newDevice)} active`, txHash });
    notify({ clientId: r.clientId, channel: 'email', subject: 'Récupération terminée', body: `Votre ancien appareil ne peut plus signer. ${explorerTx(txHash)}` });
  } catch (e) {
    db.update((d) => Object.assign(d.recoveries[id], { status: 'failed', error: shortErr(e) }));
    logActivity({ clientId: r.clientId, actor: 'system', type: 'recovery.failed', message: `Récupération échouée : ${shortErr(e)}` });
  }
}

// ───────────────────────────── Wallet transactions & receipts ─────────────────────────────
const txWithDoc = (t: WalletTx) => ({ ...t, docId: t.status === 'confirmed' ? docIdOf(t) : undefined, reference: referenceOf(t), explorer: t.txHash ? explorerTx(t.txHash) : undefined });

app.get('/clients/:id/wallet-txs', route((req) =>
  Object.values(db.data.walletTxs ?? {})
    .filter((t) => t.clientId === req.params.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(txWithDoc),
));

app.get('/wallet-txs/:id', route((req) => {
  const t = db.data.walletTxs?.[String(req.params.id)];
  if (!t) throw new HttpError(404, 'Transaction inconnue');
  return txWithDoc(t);
}));

app.get('/clients/:id/documents', route((req) =>
  Object.values(db.data.documents ?? {})
    .filter((d) => d.clientId === req.params.id)
    .map((d) => ({ ...d, tx: txWithDoc(db.data.walletTxs![d.walletTxId]) }))
    .sort((a, b) => (b.tx.confirmedAt ?? b.createdAt).localeCompare(a.tx.confirmedAt ?? a.createdAt)),
));

/** Demo: fictitious incoming payment (MOCK, no blockchain transaction). */
app.post('/clients/:id/simulate-receive', route((req) => {
  const c = getClient(String(req.params.id));
  if (!c.safeAddress) throw new HttpError(400, 'Wallet pas encore ouvert');
  return txWithDoc(simulateReceive(c.clientId, c.safeAddress, String(req.body?.amount ?? '250')));
}));

/** Server-to-server (sq-bank) or client: follow an incoming on-chain USDC transfer until it is confirmed. */
app.post('/clients/:id/receipts/track', route((req) => {
  const c = getClient(String(req.params.id));
  if (!c.safeAddress) throw new HttpError(400, 'Wallet pas encore ouvert');
  const { txHash, source = 'external', fromName, amount } = req.body as { txHash: string; source?: WalletTx['source']; fromName?: string; amount?: string };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) throw new HttpError(400, 'Hash de transaction invalide');
  logActivity({ clientId: c.clientId, actor: 'system', type: 'wallet-tx.pending', message: `Réception détectée${fromName ? ` depuis ${fromName}` : ''} — en attente de confirmation sur Ethereum`, txHash });
  return txWithDoc(trackIncoming(c.clientId, c.safeAddress, txHash, source, fromName, amount));
}));

registerFeatureRoutes(app, route, publicClient);

// ───────────────────────────── Inbox & activity ─────────────────────────────
app.get('/clients/:id/inbox', route((req) => db.data.inbox.filter((m) => m.clientId === req.params.id).slice(-100).reverse()));
app.get('/clients/:id/activity', route((req) => db.data.activity.filter((e) => e.clientId === req.params.id).slice(-200).reverse()));

// ───────────────────────────── Demo reset (keeps keys: relayer stays funded) ─────────────────────────────
app.post(
  '/admin/reset',
  route(() => {
    db.update((d) => {
      d.clients = {};
      d.txRequests = {};
      d.recoveries = {};
      d.challenges = {};
      d.activity = [];
      d.inbox = [];
      d.walletTxs = {};
      d.documents = {};
      d.previews = {};
      d.scheduled = {};
      d.swapQuotes = {};
    });
    console.log('[cosigner] demo state reset');
    return { reset: true };
  }),
);

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
    tickScheduled();
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
