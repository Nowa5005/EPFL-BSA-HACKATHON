// Client-facing features added on top of the co-signing core: freeze, backup code, preferences,
// subscriptions & commissions (server-side), demo swap quotes, authorised apps, scheduled payments.

import type { Express, Request } from 'express';
import { AbiCoder, Contract, formatUnits, getAddress, keccak256, parseUnits, toUtf8Bytes, formatEther } from 'ethers';
import {
  CHAIN_ID,
  ERC20_ABI,
  MOCK_ETH_CHF,
  MOCK_USDC_CHF,
  PLANS,
  POLICY,
  USDC_ADDRESS,
  USDC_DECIMALS,
  breakEvenCents,
  commission,
  conditionsChanged,
  installments,
  type Billing,
  type Tier,
} from '@sq/shared';
import { newId, nowIso } from '@sq/shared/server';
import { db, DEFAULT_PREFERENCES, getClient, HttpError, logActivity, notify, type Client, type Preferences, type Scheduled, type Subscription } from './db';
import { authOptionsForAction, authOptionsForHash, verifyAssertion } from './webauthn';
import { revokeBackupCode, setBackupCode, verifyBackupCode } from './backupCode';
import { DAPP_WHITELIST } from './policy';
import { balancesOf, provider } from './chain';

type Route = (fn: (req: Request) => unknown) => any;
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

/** Effective plan right now (server-side entitlement). */
export function effectiveTier(c: Client): Tier {
  const s = c.subscription;
  if (!s || s.status === 'ended') return 'free';
  if (new Date(s.currentPeriodEnd).getTime() < Date.now() && s.status === 'cancel-at-period-end') return 'free';
  return s.tier;
}

export function buildSubscription(tier: Exclude<Tier, 'free'>, billing: Billing, now = new Date()): Subscription {
  const plan = PLANS[tier];
  const startedAt = now.toISOString();
  if (billing === 'monthly')
    return {
      tier,
      billing,
      status: 'active',
      startedAt,
      currentPeriodEnd: addMonths(now, 1).toISOString(),
      schedule: [
        { dueAt: startedAt, amountCents: plan.monthlyCents, status: 'paid-demo' },
        { dueAt: addMonths(now, 1).toISOString(), amountCents: plan.monthlyCents, status: 'scheduled' },
      ],
      payment: 'demo',
    };
  if (billing === 'annual-upfront')
    return { tier, billing, status: 'active', startedAt, currentPeriodEnd: addMonths(now, 12).toISOString(), schedule: [{ dueAt: startedAt, amountCents: plan.annualUpfrontCents!, status: 'paid-demo' }], payment: 'demo' };
  const parts = installments(plan.annualInstallmentsTotalCents!, 12);
  return {
    tier,
    billing,
    status: 'active',
    startedAt,
    currentPeriodEnd: addMonths(now, 12).toISOString(),
    commitmentEnd: addMonths(now, 12).toISOString(),
    schedule: parts.map((amountCents, i) => ({ dueAt: addMonths(now, i).toISOString(), amountCents, status: i === 0 ? 'paid-demo' : 'scheduled' })),
    payment: 'demo',
  };
}

// Demo swap price (fictitious): ETH in USDC from the indicative CHF rates, with a small drift so quotes age.
export function demoEthPriceUsdc(t = Date.now()) {
  const base = MOCK_ETH_CHF / MOCK_USDC_CHF;
  return base * (1 + 0.004 * Math.sin(t / 20_000));
}

export function quoteSwap(input: { from: 'USDC' | 'ETH'; amount: string; slippageBps: number; tier: Tier; now?: number }) {
  const decIn = input.from === 'USDC' ? USDC_DECIMALS : 18;
  const decOut = input.from === 'USDC' ? 18 : USDC_DECIMALS;
  const amountIn = parseUnits(input.amount, decIn);
  if (amountIn <= 0n) throw new HttpError(400, 'Montant invalide');
  if (!(input.slippageBps >= 1 && input.slippageBps <= 300)) throw new HttpError(400, 'Tolérance de glissement entre 0,01 % et 3 %');
  const bps = PLANS[input.tier].commissionBps;
  const fee = commission(amountIn, bps);
  const net = amountIn - fee;
  // price as an integer ratio (1e6 precision) to keep bigint arithmetic
  const p = BigInt(Math.round(demoEthPriceUsdc(input.now) * 1e6));
  // USDC→ETH: wei = net(1e6) * 1e18 / p ; ETH→USDC: units(1e6) = wei * p / 1e18   (p = USDC per ETH × 1e6)
  const outFixed = input.from === 'USDC' ? (net * 10n ** 18n) / p : (net * p) / 10n ** 18n;
  const minOut = (outFixed * BigInt(10000 - input.slippageBps)) / 10000n;
  return {
    amountIn: input.amount,
    commissionBps: bps,
    commission: formatUnits(fee, decIn),
    expectedOut: formatUnits(outFixed, decOut),
    minOut: formatUnits(minOut, decOut),
    priceUsdcPerEth: Number(p) / 1e6,
    raw: { amountIn: amountIn.toString(), fee: fee.toString(), out: outFixed.toString(), minOut: minOut.toString() },
  };
}

export function registerFeatureRoutes(app: Express, route: Route, publicClient: (c: Client) => unknown) {
  // ── Freeze co-signing (client), passkey only — the backup code can never freeze/unfreeze ──
  app.post('/clients/:id/freeze/options', route(async (req) => {
    const c = getClient(String(req.params.id));
    const frozen = !!req.body.frozen;
    return authOptionsForAction(c, `freeze:${frozen ? 'on' : 'off'}:${c.safeAddress}`);
  }));
  app.post('/clients/:id/freeze', route(async (req) => {
    const c = getClient(String(req.params.id));
    const frozen = !!req.body.frozen;
    if (!c.safeAddress) throw new HttpError(400, 'Wallet pas encore ouvert');
    if (!frozen && c.frozenBy === 'compliance') throw new HttpError(403, 'Ce gel a été décidé par la conformité Swissquote : seul un responsable peut le lever.');
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: `freeze:${frozen ? 'on' : 'off'}:${c.safeAddress}` });
    db.update((d) => {
      d.clients[c.clientId].frozen = frozen;
      d.clients[c.clientId].frozenBy = frozen ? 'client' : undefined;
    });
    logActivity({ clientId: c.clientId, actor: 'client', type: frozen ? 'client.frozen' : 'client.unfrozen', message: frozen ? 'Vous avez gelé la co-signature : Swissquote ne signe plus rien pour ce wallet. La sortie avec vos clés (appareil + secours) reste possible.' : 'Vous avez dégelé la co-signature.' });
    notify({ clientId: c.clientId, channel: 'email', subject: frozen ? 'Co-signature gelée' : 'Co-signature dégelée', body: frozen ? 'Aucune opération ne sera co-signée tant que le gel est actif.' : 'Les opérations peuvent à nouveau être co-signées.' });
    return publicClient(getClient(c.clientId));
  }));

  // ── Backup code ──
  app.post('/clients/:id/backup-code', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'backup-code' });
    setBackupCode(c.clientId, String(req.body.code ?? ''));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.backup-code', message: 'Code de secours configuré (seule une empreinte est conservée)' });
    return publicClient(getClient(c.clientId));
  }));
  app.post('/clients/:id/backup-code/revoke', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'backup-code' });
    revokeBackupCode(c.clientId);
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.backup-code', message: 'Code de secours révoqué' });
    return publicClient(getClient(c.clientId));
  }));
  /** Unlock with the backup code instead of the passkey: single-use challenge + attempt limiting. */
  app.post('/clients/:id/backup-code/challenge', route((req) => {
    const c = getClient(String(req.params.id));
    const id = newId();
    db.update((d) => (d.challenges[`${c.clientId}:code:${id}`] = { challenge: id, expiresAt: new Date(Date.now() + 120_000).toISOString(), purpose: 'unlock-code' }));
    return { challengeId: id };
  }));
  app.post('/clients/:id/backup-code/verify', route((req) => {
    const c = getClient(String(req.params.id));
    const key = `${c.clientId}:code:${req.body.challengeId}`;
    const ch = db.data.challenges[key];
    if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(401, 'Demande expirée, réessayez.');
    db.update((d) => delete d.challenges[key]); // single use, even on failure
    verifyBackupCode(c.clientId, String(req.body.code ?? ''));
    return { verified: true };
  }));

  // ── Preferences (display only — hiding a wallet never touches keys or assets) ──
  app.post('/clients/:id/preferences', route((req) => {
    const c = getClient(String(req.params.id));
    const cur = { ...DEFAULT_PREFERENCES, ...c.preferences };
    const b = req.body as Partial<Preferences> & { reset?: boolean };
    const next: Preferences = b.reset
      ? { ...DEFAULT_PREFERENCES }
      : {
          background: ['default', 'white', 'sand', 'mist'].includes(b.background as string) ? (b.background as Preferences['background']) : cur.background,
          accent: ['orange', 'blue', 'green', 'violet'].includes(b.accent as string) ? (b.accent as Preferences['accent']) : cur.accent,
          highlight: typeof b.highlight === 'boolean' ? b.highlight : cur.highlight,
          hiddenWallets: Array.isArray(b.hiddenWallets) ? b.hiddenWallets.filter((x) => ['mywall-usdc', 'mywall-eth', 'swissquote-account'].includes(x)) : cur.hiddenWallets,
          hideAmounts: typeof b.hideAmounts === 'boolean' ? b.hideAmounts : cur.hideAmounts,
        };
    db.update((d) => (d.clients[c.clientId].preferences = next));
    return publicClient(getClient(c.clientId));
  }));

  // ── Pricing & subscriptions (demo payment mode: no payment provider configured, nothing is charged) ──
  app.get('/pricing', route(() => ({
    currency: 'EUR',
    plans: PLANS,
    installments: { plus: installments(7000), pro: installments(15000) },
    breakEven: { freeToPlusCents: breakEvenCents('free', 'plus'), plusToProCents: breakEvenCents('plus', 'pro') },
    paymentMode: 'demo',
    commissionScope: 'Échanges éligibles uniquement — jamais sur les transferts entrants ou sortants. Les frais réseau et partenaires ne sont pas réduits.',
  })));
  app.get('/clients/:id/subscription', route((req) => {
    const c = getClient(String(req.params.id));
    const tier = effectiveTier(c);
    return { tier, commissionBps: PLANS[tier].commissionBps, subscription: c.subscription ?? null };
  }));
  app.post('/clients/:id/subscription', route((req) => {
    const c = getClient(String(req.params.id));
    const { tier, billing, acceptTerms } = req.body as { tier: Tier; billing: Billing; acceptTerms?: boolean };
    if (tier !== 'plus' && tier !== 'pro') throw new HttpError(400, 'Offre invalide');
    if (!['monthly', 'annual-upfront', 'annual-installments'].includes(billing)) throw new HttpError(400, 'Mode de paiement invalide');
    if (acceptTerms !== true) throw new HttpError(400, 'Acceptez les conditions (coût total et engagement) avant de souscrire.');
    const s = buildSubscription(tier, billing);
    db.update((d) => (d.clients[c.clientId].subscription = s));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'subscription.started', message: `Abonnement ${PLANS[tier].name} (${billing === 'monthly' ? 'mensuel' : billing === 'annual-upfront' ? 'annuel, paiement unique' : 'annuel en 12 mensualités'}) — paiement de démonstration, aucun débit` });
    return { tier: effectiveTier(getClient(c.clientId)), subscription: s };
  }));
  app.post('/clients/:id/subscription/cancel', route((req) => {
    const c = getClient(String(req.params.id));
    const s = c.subscription;
    if (!s || s.status === 'ended') throw new HttpError(400, 'Aucun abonnement actif');
    db.update((d) => (d.clients[c.clientId].subscription!.status = 'cancel-at-period-end'));
    const end = new Date(s.currentPeriodEnd).toLocaleDateString('fr-CH');
    const msg =
      s.billing === 'annual-installments'
        ? `Engagement de 12 mois : les mensualités restantes restent dues, l’abonnement ne sera pas renouvelé après le ${end}.`
        : `L’abonnement reste actif jusqu’au ${end}, puis ne sera pas renouvelé.`;
    logActivity({ clientId: c.clientId, actor: 'client', type: 'subscription.cancel', message: msg });
    return { tier: effectiveTier(getClient(c.clientId)), subscription: getClient(c.clientId).subscription, message: msg };
  }));

  // ── Demo swap (no liquidity on Sepolia for this pair: quote + confirmation only, NEVER executed) ──
  app.post('/swap/quote', route(async (req) => {
    const { clientId, from = 'USDC', amount, slippageBps = POLICY.defaultSlippageBps } = req.body as { clientId: string; from: 'USDC' | 'ETH'; amount: string; slippageBps?: number };
    const c = getClient(clientId);
    if (!c.safeAddress) throw new HttpError(400, 'Wallet pas encore ouvert');
    const tier = effectiveTier(c);
    const q = quoteSwap({ from, amount, slippageBps: Number(slippageBps), tier });
    const bal = await balancesOf(c.safeAddress);
    const fee = await provider.getFeeData().catch(() => null);
    const gasWei = 180_000n * (fee?.maxFeePerGas ?? fee?.gasPrice ?? 0n);
    const networkFeeChf = typeof c.demoFeeChf === 'number' ? c.demoFeeChf : Math.round(Number(formatEther(gasWei)) * MOCK_ETH_CHF * 100) / 100;
    const inUsdc = from === 'USDC';
    const balIn = inUsdc ? bal.usdc : bal.eth;
    const amountInRaw = BigInt(q.raw.amountIn);
    const id = newId();
    const quote = {
      id,
      clientId,
      demo: true,
      from,
      to: inUsdc ? 'ETH' : 'USDC',
      slippageBps: Number(slippageBps),
      tier,
      ...q,
      networkFee: { chf: networkFeeChf, paidBy: 'Swissquote', demo: typeof c.demoFeeChf === 'number' },
      balances: {
        before: { usdc: formatUnits(bal.usdc, USDC_DECIMALS), eth: formatEther(bal.eth) },
        after: inUsdc
          ? { usdc: formatUnits(bal.usdc - amountInRaw, USDC_DECIMALS), eth: `${formatEther(bal.eth)} + ≥ ${q.minOut}` }
          : { usdc: `${formatUnits(bal.usdc, USDC_DECIMALS)} + ≥ ${q.minOut}`, eth: formatEther(bal.eth - amountInRaw) },
        ethForFees: formatEther(bal.eth),
      },
      insufficient: balIn < amountInRaw,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
    const challenge = keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'uint256', 'address', 'bytes32'], ['MyWall/swap-demo/v1', CHAIN_ID, c.safeAddress, keccak256(toUtf8Bytes(id))]));
    db.update((d) => {
      d.swapQuotes ??= {};
      d.swapQuotes[id] = { ...quote, challenge, used: false };
    });
    return { ...quote, authOptions: c.headless ? null : await authOptionsForHash(c, challenge), backupCodeAvailable: !!c.backupCode };
  }));
  app.post('/swap/confirm', route(async (req) => {
    const { clientId, quoteId, webauthn, backupCode } = req.body;
    const c = getClient(clientId);
    const q = db.data.swapQuotes?.[quoteId];
    if (!q || q.clientId !== clientId) throw new HttpError(404, 'Cotation introuvable');
    if (q.used) throw new HttpError(409, 'Cotation déjà utilisée', { code: 'preview-used' });
    if (new Date(q.expiresAt).getTime() < Date.now()) throw new HttpError(410, 'La cotation a expiré : demandez une nouvelle cotation.', { code: 'preview-expired' });
    db.update((d) => (d.swapQuotes![quoteId].used = true));
    const now = quoteSwap({ from: q.from, amount: q.amountIn, slippageBps: q.slippageBps, tier: effectiveTier(c) });
    if (conditionsChanged(Number(q.expectedOut), Number(now.expectedOut), POLICY.quoteChange) || now.commissionBps !== q.commissionBps)
      throw new HttpError(409, `La cotation a changé (${q.expectedOut} → ${now.expectedOut} ${q.to}). Vérifiez les nouvelles conditions avant de continuer.`, { code: 'conditions-changed' });
    if (backupCode) verifyBackupCode(clientId, backupCode);
    else await verifyAssertion(clientId, webauthn, { hash: q.challenge });
    logActivity({ clientId, actor: 'client', type: 'swap.demo', message: `Échange de démonstration confirmé (${q.amountIn} ${q.from} → ≥ ${q.minOut} ${q.to}) — aucune transaction exécutée` });
    return { status: 'demo-confirmed', executed: false, message: 'Échange de démonstration : aucune transaction n’a été exécutée et vos soldes n’ont pas changé.' };
  }));

  // ── Authorised apps (ERC-20 allowances read on-chain) ──
  app.get('/clients/:id/allowances', route(async (req) => {
    const c = getClient(String(req.params.id));
    if (!c.safeAddress) return [];
    const approvals = Object.values(db.data.txRequests).filter((r) => r.clientId === c.clientId && r.status === 'executed' && r.safeTx.data.startsWith('0x095ea7b3'));
    const spenders = new Set<string>([...Object.keys(DAPP_WHITELIST), ...approvals.map((r) => '0x' + r.safeTx.data.slice(34, 74))].map((a) => a.toLowerCase()));
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const rows = await Promise.all(
      [...spenders].map(async (s) => {
        const allowance: bigint = await usdc.allowance(c.safeAddress, s).catch(() => 0n);
        const last = approvals.filter((r) => r.safeTx.data.slice(34, 74).toLowerCase() === s.slice(2)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        return {
          spender: getAddress(s),
          name: DAPP_WHITELIST[s]?.name ?? c.contacts.find((x) => x.address.toLowerCase() === s)?.name ?? null,
          whitelisted: !!DAPP_WHITELIST[s],
          network: 'Ethereum Sepolia',
          token: 'USDC',
          tokenAddress: USDC_ADDRESS,
          allowanceRaw: allowance.toString(),
          allowance: allowance >= 2n ** 255n ? 'illimité' : formatUnits(allowance, USDC_DECIMALS),
          unlimited: allowance >= 2n ** 255n,
          authorizedAt: last?.updatedAt ?? null,
          txHash: last?.txHash ?? null,
        };
      }),
    );
    return rows.filter((r) => r.allowanceRaw !== '0');
  }));

  // ── Scheduled payments & reminders: never signed automatically — they become "à confirmer" at the due date ──
  const own = (id: string, clientId: string) => {
    const s = db.data.scheduled?.[id];
    if (!s || s.clientId !== clientId) throw new HttpError(404, 'Élément planifié introuvable');
    return s;
  };
  const validateScheduled = (b: any) => {
    const kind = b.kind === 'reminder' ? 'reminder' : 'payment';
    const asset = b.asset === 'ETH' ? 'ETH' : 'USDC';
    if (!(Number(b.amount) > 0) && kind === 'payment') throw new HttpError(400, 'Montant invalide');
    const due = new Date(b.dueAt);
    if (isNaN(due.getTime())) throw new HttpError(400, 'Date invalide');
    if (due.getTime() < Date.now() - 60_000) throw new HttpError(400, 'La date doit être dans le futur');
    if (kind === 'payment' && !/^0x[0-9a-fA-F]{40}$/.test(b.recipient ?? '')) throw new HttpError(400, 'Destinataire invalide');
    return { kind, asset, amount: String(b.amount ?? '0'), dueAt: due.toISOString(), recipient: b.recipient ? getAddress(b.recipient) : undefined, recipientName: b.recipientName?.slice(0, 60), note: b.note?.slice(0, 140) } as const;
  };
  app.get('/clients/:id/scheduled', route((req) => Object.values(db.data.scheduled ?? {}).filter((s) => s.clientId === req.params.id && s.status !== 'cancelled').sort((a, b) => a.dueAt.localeCompare(b.dueAt))));
  app.post('/clients/:id/scheduled', route((req) => {
    const c = getClient(String(req.params.id));
    const v = validateScheduled(req.body);
    const s: Scheduled = { id: newId(), clientId: c.clientId, ...v, timeZone: 'Europe/Zurich', status: 'scheduled', createdAt: nowIso(), updatedAt: nowIso() };
    db.update((d) => ((d.scheduled ??= {})[s.id] = s));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'scheduled.created', message: `${s.kind === 'payment' ? 'Dépense planifiée' : 'Rappel'} : ${s.amount} ${s.asset} — ${new Date(s.dueAt).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}` });
    return s;
  }));
  app.post('/scheduled/:sid', route((req) => {
    const s = own(String(req.params.sid), req.body.clientId);
    const v = validateScheduled({ ...s, ...req.body });
    db.update((d) => Object.assign(d.scheduled![s.id], v, { status: 'scheduled', updatedAt: nowIso() }));
    return db.data.scheduled![s.id];
  }));
  app.post('/scheduled/:sid/delete', route((req) => {
    const s = own(String(req.params.sid), req.body.clientId);
    db.update((d) => Object.assign(d.scheduled![s.id], { status: 'cancelled', updatedAt: nowIso() }));
    return { ok: true };
  }));
  app.post('/scheduled/:sid/done', route((req) => {
    const s = own(String(req.params.sid), req.body.clientId);
    db.update((d) => Object.assign(d.scheduled![s.id], { status: 'done', updatedAt: nowIso() }));
    return { ok: true };
  }));

  // ── Demo-only: simulate a network-fee change during confirmation (clearly labelled in the UI) ──
  app.post('/clients/:id/demo/fees', route((req) => {
    const c = getClient(String(req.params.id));
    const chf = req.body.chf === null ? undefined : Number(req.body.chf);
    db.update((d) => (d.clients[c.clientId].demoFeeChf = chf !== undefined && chf >= 0 ? chf : undefined));
    return { demoFeeChf: getClient(c.clientId).demoFeeChf ?? null };
  }));
}

/** Called by the ticker: due scheduled items become "à confirmer" + a notification. No signature, no transfer. */
export function tickScheduled() {
  for (const s of Object.values(db.data.scheduled ?? {})) {
    if (s.status !== 'scheduled' || new Date(s.dueAt).getTime() > Date.now()) continue;
    db.update((d) => Object.assign(d.scheduled![s.id], { status: 'due', updatedAt: nowIso() }));
    notify({
      clientId: s.clientId,
      channel: 'app',
      subject: s.kind === 'payment' ? 'Dépense planifiée à confirmer' : 'Rappel',
      body: s.kind === 'payment' ? `${s.amount} ${s.asset} à ${s.recipientName ?? s.recipient} : ouvrez My Wall pour vérifier les frais et confirmer. Rien n’a été envoyé automatiquement.` : `${s.note ?? 'Rappel'} — ${s.amount} ${s.asset}`,
    });
  }
}
