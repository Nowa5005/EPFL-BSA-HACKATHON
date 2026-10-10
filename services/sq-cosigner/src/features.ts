// Client-facing features added on top of the co-signing core: freeze, backup code, preferences,
// subscriptions & commissions (server-side), demo swap quotes, authorised apps, scheduled payments.

import type { Express, Request } from 'express';
import { AbiCoder, Contract, formatUnits, getAddress, keccak256, parseUnits, toUtf8Bytes, formatEther } from 'ethers';
import {
  CHAIN_ID,
  ERC20_ABI,
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
import { fetchWalletRates, newId, nowIso, t, type WalletRates } from '@sq/shared/server';
import { both } from '@sq/shared';
import { validateWidgetsPatch } from '@sq/shared/widgets';
import { feeChf } from './rates';
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

/** ETH price in USDC derived from the real indicative CHF rates (market-data service); null if a rate is missing. */
export function ethPriceUsdcFromRates(rates: WalletRates): number | null {
  const e = rates.ETH?.chf;
  const u = rates.USDC?.chf;
  return typeof e === 'number' && e > 0 && typeof u === 'number' && u > 0 ? e / u : null;
}

// DEMO swap price: the real indicative ETH/USDC market price with a small artificial drift so quotes age.
// It is NOT an executable quote (no liquidity for this pair on Sepolia; the swap is never executed).
export function demoEthPriceUsdc(base: number, t = Date.now()) {
  return base * (1 + 0.004 * Math.sin(t / 20_000));
}

async function demoSwapBase() {
  const base = ethPriceUsdcFromRates(await fetchWalletRates());
  if (base === null) throw new HttpError(503, t('Demo quote unavailable: no recent ETH/USDC market price. Try again shortly.', 'Cotation de démonstration indisponible : aucun cours ETH/USDC récent. Réessayez dans un instant.'));
  return base;
}

export function quoteSwap(input: { from: 'USDC' | 'ETH'; amount: string; slippageBps: number; tier: Tier; ethPriceUsdc: number; now?: number }) {
  const decIn = input.from === 'USDC' ? USDC_DECIMALS : 18;
  const decOut = input.from === 'USDC' ? 18 : USDC_DECIMALS;
  const amountIn = parseUnits(input.amount, decIn);
  if (amountIn <= 0n) throw new HttpError(400, t('Invalid amount', 'Montant invalide'));
  if (!(input.slippageBps >= 1 && input.slippageBps <= 300)) throw new HttpError(400, t('Slippage tolerance must be between 0.01% and 3%', 'Tolérance de glissement entre 0,01 % et 3 %'));
  const bps = PLANS[input.tier].commissionBps;
  const fee = commission(amountIn, bps);
  const net = amountIn - fee;
  // price as an integer ratio (1e6 precision) to keep bigint arithmetic
  const p = BigInt(Math.round(demoEthPriceUsdc(input.ethPriceUsdc, input.now) * 1e6));
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
    if (!c.safeAddress) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
    if (!frozen && c.frozenBy === 'compliance') throw new HttpError(403, t('This freeze was decided by Swissquote compliance: only an officer can lift it.', 'Ce gel a été décidé par la conformité Swissquote : seul un responsable peut le lever.'));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: `freeze:${frozen ? 'on' : 'off'}:${c.safeAddress}` });
    db.update((d) => {
      d.clients[c.clientId].frozen = frozen;
      d.clients[c.clientId].frozenBy = frozen ? 'client' : undefined;
    });
    logActivity({ clientId: c.clientId, actor: 'client', type: frozen ? 'client.frozen' : 'client.unfrozen', message: frozen
        ? both(
            'You froze co-signing: Swissquote no longer signs anything for this wallet. Exiting with your own keys (device + recovery) remains possible.',
            'Vous avez gelé la co-signature : Swissquote ne signe plus rien pour ce wallet. La sortie avec vos clés (appareil + secours) reste possible.',
          )
        : both('You unfroze co-signing.', 'Vous avez dégelé la co-signature.'),
    });
    notify({
      clientId: c.clientId,
      channel: 'email',
      subject: frozen ? both('Co-signing frozen', 'Co-signature gelée') : both('Co-signing unfrozen', 'Co-signature dégelée'),
      body: frozen ? both('No operation will be co-signed while the freeze is active.', 'Aucune opération ne sera co-signée tant que le gel est actif.') : both('Operations can be co-signed again.', 'Les opérations peuvent à nouveau être co-signées.'),
    });
    return publicClient(getClient(c.clientId));
  }));

  // ── Backup code ──
  app.post('/clients/:id/backup-code', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'backup-code' });
    setBackupCode(c.clientId, String(req.body.code ?? ''));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.backup-code', message: both('Backup code set (only a fingerprint is kept)', 'Code de secours configuré (seule une empreinte est conservée)') });
    return publicClient(getClient(c.clientId));
  }));
  app.post('/clients/:id/backup-code/revoke', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'backup-code' });
    revokeBackupCode(c.clientId);
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.backup-code', message: both('Backup code revoked', 'Code de secours révoqué') });
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
    if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(401, t('Request expired, please try again.', 'Demande expirée, réessayez.'));
    db.update((d) => delete d.challenges[key]); // single use, even on failure
    verifyBackupCode(c.clientId, String(req.body.code ?? ''));
    return { verified: true };
  }));

  // ── Preferences (display only — hiding a wallet never touches keys or assets) ──
  app.post('/clients/:id/preferences', route((req) => {
    const c = getClient(String(req.params.id));
    const cur = { ...DEFAULT_PREFERENCES, ...c.preferences };
    const b = req.body as Partial<Preferences> & { reset?: boolean };
    // Home widget layouts (N6): strict shape check, unknown ids dropped, required widgets re-added; each layout
    // (mobile / desktop) is replaced independently. "reset" (display personalisation) keeps the widget layouts:
    // they have their own "Reset to default" in Customize mode.
    let widgets = cur.widgets;
    if (b.widgets !== undefined) {
      const v = validateWidgetsPatch(b.widgets);
      if (!v.ok) throw new HttpError(400, t(`Invalid widget layout: ${v.error}`, `Disposition des widgets invalide : ${v.error}`));
      widgets = { ...cur.widgets, ...v.value };
    }
    const next: Preferences = b.reset
      ? { ...DEFAULT_PREFERENCES, ...(widgets ? { widgets } : {}) }
      : {
          background: ['default', 'white', 'sand', 'mist'].includes(b.background as string) ? (b.background as Preferences['background']) : cur.background,
          accent: ['orange', 'blue', 'green', 'violet'].includes(b.accent as string) ? (b.accent as Preferences['accent']) : cur.accent,
          highlight: typeof b.highlight === 'boolean' ? b.highlight : cur.highlight,
          hiddenWallets: Array.isArray(b.hiddenWallets) ? b.hiddenWallets.filter((x) => ['mywall-usdc', 'mywall-eth', 'swissquote-account'].includes(x)) : cur.hiddenWallets,
          hideAmounts: typeof b.hideAmounts === 'boolean' ? b.hideAmounts : cur.hideAmounts,
          ...(widgets ? { widgets } : {}),
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
    commissionScope: t(
      'Eligible swaps only — never on incoming or outgoing transfers. Network and partner fees are not reduced.',
      'Échanges éligibles uniquement — jamais sur les transferts entrants ou sortants. Les frais réseau et partenaires ne sont pas réduits.',
    ),
  })));
  app.get('/clients/:id/subscription', route((req) => {
    const c = getClient(String(req.params.id));
    const tier = effectiveTier(c);
    return { tier, commissionBps: PLANS[tier].commissionBps, subscription: c.subscription ?? null };
  }));
  app.post('/clients/:id/subscription', route((req) => {
    const c = getClient(String(req.params.id));
    const { tier, billing, acceptTerms } = req.body as { tier: Tier; billing: Billing; acceptTerms?: boolean };
    if (tier !== 'plus' && tier !== 'pro') throw new HttpError(400, t('Invalid plan', 'Offre invalide'));
    if (!['monthly', 'annual-upfront', 'annual-installments'].includes(billing)) throw new HttpError(400, t('Invalid billing option', 'Mode de paiement invalide'));
    if (acceptTerms !== true) throw new HttpError(400, t('Accept the terms (total cost and commitment) before subscribing.', 'Acceptez les conditions (coût total et engagement) avant de souscrire.'));
    const s = buildSubscription(tier, billing);
    db.update((d) => (d.clients[c.clientId].subscription = s));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'subscription.started', message: both(
        `${PLANS[tier].name} subscription (${billing === 'monthly' ? 'monthly' : billing === 'annual-upfront' ? 'annual, single payment' : 'annual in 12 instalments'}) — demo payment, nothing charged`,
        `Abonnement ${PLANS[tier].name} (${billing === 'monthly' ? 'mensuel' : billing === 'annual-upfront' ? 'annuel, paiement unique' : 'annuel en 12 mensualités'}) — paiement de démonstration, aucun débit`,
      ),
    });
    return { tier: effectiveTier(getClient(c.clientId)), subscription: s };
  }));
  app.post('/clients/:id/subscription/cancel', route((req) => {
    const c = getClient(String(req.params.id));
    const s = c.subscription;
    if (!s || s.status === 'ended') throw new HttpError(400, t('No active subscription', 'Aucun abonnement actif'));
    db.update((d) => (d.clients[c.clientId].subscription!.status = 'cancel-at-period-end'));
    const endEn = new Date(s.currentPeriodEnd).toLocaleDateString('en-CH', { timeZone: 'Europe/Zurich' });
    const endFr = new Date(s.currentPeriodEnd).toLocaleDateString('fr-CH', { timeZone: 'Europe/Zurich' });
    const msg =
      s.billing === 'annual-installments'
        ? both(
            `12-month commitment: the remaining instalments are still due; the subscription will not renew after ${endEn}.`,
            `Engagement de 12 mois : les mensualités restantes restent dues, l’abonnement ne sera pas renouvelé après le ${endFr}.`,
          )
        : both(`The subscription stays active until ${endEn}, then will not renew.`, `L’abonnement reste actif jusqu’au ${endFr}, puis ne sera pas renouvelé.`);
    logActivity({ clientId: c.clientId, actor: 'client', type: 'subscription.cancel', message: msg });
    return { tier: effectiveTier(getClient(c.clientId)), subscription: getClient(c.clientId).subscription, message: t(msg.en, msg.fr) };
  }));

  // ── Demo swap (no liquidity on Sepolia for this pair: quote + confirmation only, NEVER executed) ──
  app.post('/swap/quote', route(async (req) => {
    const { clientId, from = 'USDC', amount, slippageBps = POLICY.defaultSlippageBps } = req.body as { clientId: string; from: 'USDC' | 'ETH'; amount: string; slippageBps?: number };
    const c = getClient(clientId);
    if (!c.safeAddress) throw new HttpError(400, t('Wallet not opened yet', 'Wallet pas encore ouvert'));
    const tier = effectiveTier(c);
    const q = quoteSwap({ from, amount, slippageBps: Number(slippageBps), tier, ethPriceUsdc: await demoSwapBase() });
    const bal = await balancesOf(c.safeAddress);
    const fee = await provider.getFeeData().catch(() => null);
    const gasWei = 180_000n * (fee?.maxFeePerGas ?? fee?.gasPrice ?? 0n);
    // Real ETH rate for the CHF estimate; null = "CHF value unavailable" (fee still shown in ETH)
    const feeV = feeChf(formatEther(gasWei), (await fetchWalletRates()).ETH);
    const networkFeeChf = typeof c.demoFeeChf === 'number' ? c.demoFeeChf : feeV.chf;
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
      networkFee: { chf: networkFeeChf, eth: formatEther(gasWei), rate: typeof c.demoFeeChf === 'number' ? null : feeV.rate, paidBy: 'Swissquote', demo: typeof c.demoFeeChf === 'number' },
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
    if (!q || q.clientId !== clientId) throw new HttpError(404, t('Quote not found', 'Cotation introuvable'));
    if (q.used) throw new HttpError(409, t('Quote already used', 'Cotation déjà utilisée'), { code: 'preview-used' });
    if (new Date(q.expiresAt).getTime() < Date.now()) throw new HttpError(410, t('The quote has expired: request a new quote.', 'La cotation a expiré : demandez une nouvelle cotation.'), { code: 'preview-expired' });
    db.update((d) => (d.swapQuotes![quoteId].used = true));
    const now = quoteSwap({ from: q.from, amount: q.amountIn, slippageBps: q.slippageBps, tier: effectiveTier(c), ethPriceUsdc: await demoSwapBase() });
    if (conditionsChanged(Number(q.expectedOut), Number(now.expectedOut), POLICY.quoteChange) || now.commissionBps !== q.commissionBps)
      throw new HttpError(
        409,
        t(
          `The quote changed (${q.expectedOut} → ${now.expectedOut} ${q.to}). Review the new conditions before continuing.`,
          `La cotation a changé (${q.expectedOut} → ${now.expectedOut} ${q.to}). Vérifiez les nouvelles conditions avant de continuer.`,
        ),
        { code: 'conditions-changed' },
      );
    if (backupCode) verifyBackupCode(clientId, backupCode);
    else await verifyAssertion(clientId, webauthn, { hash: q.challenge });
    logActivity({ clientId, actor: 'client', type: 'swap.demo', message: both(
        `Demo swap confirmed (${q.amountIn} ${q.from} → ≥ ${q.minOut} ${q.to}) — no transaction executed`,
        `Échange de démonstration confirmé (${q.amountIn} ${q.from} → ≥ ${q.minOut} ${q.to}) — aucune transaction exécutée`,
      ),
    });
    return {
      status: 'demo-confirmed',
      executed: false,
      message: t('Demo swap: no transaction was executed and your balances did not change.', 'Échange de démonstration : aucune transaction n’a été exécutée et vos soldes n’ont pas changé.'),
    };
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
          allowance: allowance >= 2n ** 255n ? t('unlimited', 'illimité') : formatUnits(allowance, USDC_DECIMALS),
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
    if (!s || s.clientId !== clientId) throw new HttpError(404, t('Scheduled item not found', 'Élément planifié introuvable'));
    return s;
  };
  const validateScheduled = (b: any) => {
    const kind = b.kind === 'reminder' ? 'reminder' : 'payment';
    const asset = b.asset === 'ETH' ? 'ETH' : 'USDC';
    if (!(Number(b.amount) > 0) && kind === 'payment') throw new HttpError(400, t('Invalid amount', 'Montant invalide'));
    const due = new Date(b.dueAt);
    if (isNaN(due.getTime())) throw new HttpError(400, t('Invalid date', 'Date invalide'));
    if (due.getTime() < Date.now() - 60_000) throw new HttpError(400, t('The date must be in the future', 'La date doit être dans le futur'));
    if (kind === 'payment' && !/^0x[0-9a-fA-F]{40}$/.test(b.recipient ?? '')) throw new HttpError(400, t('Invalid recipient', 'Destinataire invalide'));
    return { kind, asset, amount: String(b.amount ?? '0'), dueAt: due.toISOString(), recipient: b.recipient ? getAddress(b.recipient) : undefined, recipientName: b.recipientName?.slice(0, 60), note: b.note?.slice(0, 140) } as const;
  };
  app.get('/clients/:id/scheduled', route((req) => Object.values(db.data.scheduled ?? {}).filter((s) => s.clientId === req.params.id && s.status !== 'cancelled').sort((a, b) => a.dueAt.localeCompare(b.dueAt))));
  app.post('/clients/:id/scheduled', route((req) => {
    const c = getClient(String(req.params.id));
    const v = validateScheduled(req.body);
    const s: Scheduled = { id: newId(), clientId: c.clientId, ...v, timeZone: 'Europe/Zurich', status: 'scheduled', createdAt: nowIso(), updatedAt: nowIso() };
    db.update((d) => ((d.scheduled ??= {})[s.id] = s));
    logActivity({ clientId: c.clientId, actor: 'client', type: 'scheduled.created', message: both(
        `${s.kind === 'payment' ? 'Scheduled payment' : 'Reminder'}: ${s.amount} ${s.asset} — ${new Date(s.dueAt).toLocaleString('en-CH', { timeZone: 'Europe/Zurich' })}`,
        `${s.kind === 'payment' ? 'Dépense planifiée' : 'Rappel'} : ${s.amount} ${s.asset} — ${new Date(s.dueAt).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}`,
      ),
    });
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
      subject: s.kind === 'payment' ? both('Scheduled payment to confirm', 'Dépense planifiée à confirmer') : both('Reminder', 'Rappel'),
      body:
        s.kind === 'payment'
          ? both(
              `${s.amount} ${s.asset} to ${s.recipientName ?? s.recipient}: open My Wall to check the fees and confirm. Nothing was sent automatically.`,
              `${s.amount} ${s.asset} à ${s.recipientName ?? s.recipient} : ouvrez My Wall pour vérifier les frais et confirmer. Rien n’a été envoyé automatiquement.`,
            )
          : both(`${s.note ?? 'Reminder'} — ${s.amount} ${s.asset}`, `${s.note ?? 'Rappel'} — ${s.amount} ${s.asset}`),
    });
  }
}
