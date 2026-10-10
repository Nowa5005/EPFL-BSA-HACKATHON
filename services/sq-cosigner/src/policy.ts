// Policy engine: K2 only co-signs if every rule passes. Pure function → unit-tested.

import { formatEther, formatUnits } from 'ethers';
import { POLICY, TOKEN_SELECTORS, USDC_DECIMALS, checkRecipient, decodeSafeTx, isKnownToken, short } from '@sq/shared';
import type { DecodedAction, Lang, PolicyCheck, PolicyResult, SafeTx } from '@sq/shared';

// MOCK sanctions list (in production: Chainalysis / Elliptic / SECO+OFAC feeds).
// The first two entries are real OFAC-listed Ethereum addresses (public SDN list).
export const SANCTIONED: Record<string, string> = {
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96': 'OFAC SDN — Lazarus Group (Ronin bridge hack)',
  '0x7f367cc41522ce07553e823bf3be79a889debe1b': 'OFAC SDN — sanctioned person',
  '0x00000000000000000000000000000000000bad01': 'SECO, demo entry — “Sanctioned Demo Corp”',
};
const SANCTIONED_FR: Record<string, string> = {
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96': 'OFAC SDN — Lazarus Group (piratage du pont Ronin)',
  '0x7f367cc41522ce07553e823bf3be79a889debe1b': 'OFAC SDN — personne sanctionnée',
  '0x00000000000000000000000000000000000bad01': 'SECO, entrée de démo — « Sanctioned Demo Corp »',
};

// Whitelisted dApps (contracts verified on Sepolia).
export const DAPP_WHITELIST: Record<string, { name: string; category: string }> = {
  '0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e': { name: 'Uniswap (SwapRouter02, Sepolia)', category: 'DEX' },
  '0x6ae43d3271ff6888e7fc43fd7321a503ff738951': { name: 'Aave V3 Pool (Sepolia)', category: 'Lending' },
};

export interface PolicyInput {
  tx: SafeTx;
  decoded: DecodedAction;
  safeAddress: string;
  contacts: { address: string; addedAt: string }[];
  /** USDC-equivalent already spent today; null when part of it could not be valued (missing market rate). */
  spentTodayUsdc: number | null;
  sponsoredToday: number;
  /** Indicative CHF prices from the market-data service (no fixed fallback). A missing rate is NEVER read as 0. */
  rates?: PolicyRates;
  /** Ignored: checks always carry both languages (label/labelFr, detail/detailFr), localised when read. */
  lang?: Lang;
  balances: { eth: bigint; usdc: bigint };
  now?: Date;
  /** Recovery flow (owner rotation) is handled by its own procedure, not by this engine. */
  allowSelfCall?: boolean;
  /** #19 — unrecognised token contracts received by this wallet (on-chain indexer): any call to them is refused. */
  unrecognisedTokens?: string[];
  /** #19 — every saved contact (cooling-off included), with names: a look-alike of one of them is refused. */
  lookalikeRefs?: { name: string; address: string }[];
}

export type PolicyRates = { ETH?: number; USDC?: number };

/** ETH amount → USDC-equivalent with the real indicative rates, or null when a rate is missing. */
export function ethToUsdcEquivalent(eth: number, rates?: PolicyRates): number | null {
  if (eth === 0) return 0;
  const e = rates?.ETH;
  const u = rates?.USDC;
  if (!(typeof e === 'number' && e > 0 && typeof u === 'number' && u > 0)) return null;
  return (eth * e) / u;
}

/**
 * Value of the action in USDC-equivalent, using real indicative market rates (CHF per ETH / per USDC).
 * Returns null when ETH moves and no rate is available: callers must FAIL SAFE (treat as above threshold),
 * never as 0.
 */
export function usdcEquivalent(decoded: DecodedAction, tx: SafeTx, rates?: PolicyRates): number | null {
  if (decoded.kind === 'erc20-transfer' && decoded.token === 'USDC') return Number(formatUnits(BigInt(decoded.amountRaw!), USDC_DECIMALS));
  return ethToUsdcEquivalent(Number(formatEther(BigInt(tx.value))), rates);
}

type Txt = [en: string, fr: string];
/** A check with its English text and French twin (stored with the request, localised on read). */
const ck = (id: string, status: PolicyCheck['status'], label: Txt, detail?: Txt): PolicyCheck => ({
  id,
  status,
  label: label[0],
  labelFr: label[1],
  ...(detail ? { detail: detail[0], detailFr: detail[1] } : {}),
});

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { tx, decoded, safeAddress } = input;
  const checks: PolicyCheck[] = [];
  const add = (c: PolicyCheck) => checks.push(c);
  const lc = (a?: string) => (a ?? '').toLowerCase();

  // 1. Operation type
  const OP: Txt = ['Simple operation (no DELEGATECALL)', 'Opération simple (pas de DELEGATECALL)'];
  add(tx.operation === 0 ? ck('operation', 'pass', OP) : ck('operation', 'fail', OP, ['DELEGATECALL is never co-signed', "DELEGATECALL n'est jamais co-signé"]));

  // 2. Wallet configuration changes only via the recovery procedure
  if (lc(tx.to) === lc(safeAddress) && !input.allowSelfCall) {
    add(ck('self-call', 'fail', ['Wallet configuration unchanged', 'Configuration du wallet inchangée'], ['Key changes go through the recovery procedure (with a delay)', 'Les changements de clés passent par la procédure de récupération (avec délai)']));
  }

  // Revoking an approval (allowance → 0) only reduces risk: always allowed at standard level.
  const isRevocation = decoded.kind === 'erc20-approve' && decoded.amountRaw === '0';

  // 3. Sanctions screening on every counterparty (a revocation may target a sanctioned spender: allowed)
  const parties = [tx.to, decoded.recipient, isRevocation ? undefined : decoded.spender].filter(Boolean).map(lc);
  const hit = parties.find((p) => SANCTIONED[p]);
  const SAN: Txt = ['Sanctions screening', 'Filtrage des sanctions'];
  add(
    hit
      ? ck('sanctions', 'fail', SAN, [`${short(hit)} is on a sanctions list (${SANCTIONED[hit]})`, `${short(hit)} figure sur une liste de sanctions (${SANCTIONED_FR[hit] ?? SANCTIONED[hit]})`])
      : ck('sanctions', 'pass', SAN, ['No match (simulated OFAC / SECO list)', 'Aucune correspondance (liste OFAC / SECO simulée)']),
  );

  // 3b. #19 — Unrecognised tokens: no transfer, approval or arbitrary call on a contract outside the whitelist.
  const target = lc(tx.to);
  const selector = tx.data && tx.data !== '0x' ? tx.data.slice(0, 10).toLowerCase() : '';
  const unknownTokenCall =
    target !== lc(safeAddress) &&
    !isKnownToken(target) &&
    !DAPP_WHITELIST[target] &&
    ((input.unrecognisedTokens ?? []).some((a) => lc(a) === target) || (!!selector && !!TOKEN_SELECTORS[selector]));
  const TOK: Txt = ['Recognised tokens only', 'Jetons reconnus uniquement'];
  if (unknownTokenCall)
    add(ck('unknown-token', 'fail', TOK, [
      `${short(target)} is not a recognised token: Swissquote never co-signs a transfer, approval or any call on it. Unknown tokens are often scams — leave them untouched (use “Ignore”).`,
      `${short(target)} n’est pas un jeton reconnu : Swissquote ne co-signe jamais de transfert, d’autorisation ni d’appel sur ce contrat. Les jetons inconnus sont souvent des arnaques — n’y touchez pas (utilisez « Ignorer »).`,
    ]));

  // 3c. #19 — Address poisoning: never send to (or approve) a look-alike of a saved contact.
  const counterpartyAddr = decoded.recipient ?? (isRevocation ? undefined : decoded.spender);
  if (counterpartyAddr && input.lookalikeRefs?.length) {
    const r = checkRecipient(counterpartyAddr, input.lookalikeRefs);
    const LOOK: Txt = ['Not a look-alike of a contact', 'Pas un sosie d’un contact'];
    if (r.status === 'lookalike')
      add(ck('lookalike', 'fail', LOOK, [
        `${short(counterpartyAddr)} looks like the address saved for “${r.name}” (${short(r.saved)}) but is different — a typical address-poisoning scam. Pick “${r.name}” from your contacts instead of copying an address from your history.`,
        `${short(counterpartyAddr)} ressemble à l’adresse enregistrée pour « ${r.name} » (${short(r.saved)}) mais elle est différente — une arnaque typique par empoisonnement d’adresse. Choisissez « ${r.name} » dans vos contacts au lieu de copier une adresse depuis l’historique.`,
      ]));
  }

  // 4. Funds available on-chain
  let fundsOk = true;
  if (decoded.kind === 'erc20-transfer' && decoded.token === 'USDC') fundsOk = BigInt(decoded.amountRaw!) <= input.balances.usdc;
  if (BigInt(tx.value) > input.balances.eth) fundsOk = false;
  const FUNDS: Txt = ['Funds available on the blockchain', 'Fonds disponibles sur la blockchain'];
  add(fundsOk ? ck('funds', 'pass', FUNDS) : ck('funds', 'fail', FUNDS, ['Insufficient balance in the wallet', 'Solde insuffisant sur le wallet']));

  // 5. dApp interaction: whitelist + step-up
  const isDapp = decoded.kind === 'contract-call' || (decoded.kind === 'erc20-approve' && !isRevocation);
  if (isRevocation) add(ck('revoke', 'pass', ['Approval revocation', 'Révocation d’autorisation'], ['Removing access reduces risk: always allowed', 'Retirer un accès réduit le risque : toujours permis']));
  if (isDapp) {
    const target = decoded.kind === 'erc20-approve' ? lc(decoded.spender) : lc(tx.to);
    const dapp = DAPP_WHITELIST[target];
    const DAPP: Txt = ['Approved dApps list', 'Liste des dApps approuvées'];
    if (!dapp) add(ck('dapp', 'fail', DAPP, [`${short(target)} is not an approved dApp`, `${short(target)} n'est pas une dApp approuvée`]));
    else add(ck('dapp', 'step-up', DAPP, [`${dapp.name} is approved — dApps require enhanced checks`, `${dapp.name} est approuvée — les dApps demandent des contrôles renforcés`]));
    if (decoded.unlimited) add(ck('unlimited-approve', 'step-up', ['Unlimited approval', 'Autorisation illimitée'], ['Unlimited spending approval — enhanced checks', 'Autorisation de dépense illimitée — contrôles renforcés']));
  }

  // 6. Amount threshold
  const amount = usdcEquivalent(decoded, tx, input.rates);
  const THR: Txt = [`Amount below ${POLICY.stepUpThresholdUsdc} USDC`, `Montant inférieur à ${POLICY.stepUpThresholdUsdc} USDC`];
  add(
    amount === null
      ? ck('threshold', 'step-up', THR, ['ETH value unavailable (no recent market rate): treated as above the threshold', 'Contre-valeur de l’ETH indisponible (aucun cours récent) : traitée comme supérieure au seuil'])
      : amount >= POLICY.stepUpThresholdUsdc
        ? ck('threshold', 'step-up', THR, [`${amount.toFixed(2)} USDC (equivalent) ≥ threshold`, `${amount.toFixed(2)} USDC (équivalent) ≥ seuil`])
        : ck('threshold', 'pass', THR),
  );

  // 7. Known recipient
  if (decoded.kind === 'erc20-transfer' || decoded.kind === 'eth-transfer') {
    const known = input.contacts.some((c) => lc(c.address) === lc(decoded.recipient));
    const REC: Txt = ['Known recipient', 'Destinataire connu'];
    add(known ? ck('recipient', 'pass', REC) : ck('recipient', 'step-up', REC, ['First payment to this address', 'Premier paiement vers cette adresse']));
  }

  // 8. Daily limit
  const dailyUnknown = amount === null || input.spentTodayUsdc === null;
  const dailyOk = !dailyUnknown && input.spentTodayUsdc! + amount! <= POLICY.dailyLimitUsdc;
  const DAY: Txt = [`Daily limit (${POLICY.dailyLimitUsdc} USDC)`, `Limite journalière (${POLICY.dailyLimitUsdc} USDC)`];
  add(
    dailyUnknown
      ? ck('daily', 'step-up', DAY, ['Daily limit cannot be verified without a market rate: enhanced checks', 'Limite journalière invérifiable sans cours de marché : contrôles renforcés'])
      : dailyOk
        ? ck('daily', 'pass', DAY)
        : ck('daily', 'fail', DAY, ['The daily limit would be exceeded', 'La limite journalière serait dépassée']),
  );

  // 9. Gas sponsoring quota (anti-abuse)
  const quotaOk = input.sponsoredToday < POLICY.sponsoredTxPerDay;
  const GAS: Txt = ['Sponsored fees quota', 'Quota de frais offerts'];
  add(
    quotaOk
      ? ck('gas-quota', 'pass', GAS, [`${input.sponsoredToday}/${POLICY.sponsoredTxPerDay} today`, `${input.sponsoredToday}/${POLICY.sponsoredTxPerDay} aujourd'hui`])
      : ck('gas-quota', 'fail', GAS, ['Daily quota of sponsored transactions reached', 'Quota journalier de transactions offertes atteint']),
  );

  return decide(checks);
}

/** Decision from the checks; reasons in English with their French twin (reasonsFr). */
export function decide(checks: PolicyCheck[]): PolicyResult {
  const failed = checks.filter((c) => c.status === 'fail');
  const stepUp = checks.filter((c) => c.status === 'step-up');
  const why = (cs: PolicyCheck[]) => ({ reasons: cs.map((c) => c.detail ?? c.label), reasonsFr: cs.map((c) => c.detailFr ?? c.detail ?? c.labelFr ?? c.label) });
  if (failed.length) return { decision: 'reject', level: stepUp.length ? 'step-up' : 'standard', checks, ...why(failed) };
  if (stepUp.length) return { decision: 'step-up', level: 'step-up', checks, ...why(stepUp) };
  return { decision: 'approve', level: 'standard', checks, reasons: [], reasonsFr: [] };
}

/** decodeSafeTx in English with the French twins (summaryFr, warningsFr): stored texts are localised when read. */
export function decodeBilingual(tx: SafeTx, safeAddress?: string, contactName?: (a: string) => string | undefined): DecodedAction {
  const en = decodeSafeTx(tx, safeAddress, contactName, 'en');
  const fr = decodeSafeTx(tx, safeAddress, contactName, 'fr');
  return { ...en, summaryFr: fr.summary, warningsFr: fr.warnings };
}
