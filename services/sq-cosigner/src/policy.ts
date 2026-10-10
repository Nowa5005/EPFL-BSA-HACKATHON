// Policy engine: K2 only co-signs if every rule passes. Pure function → unit-tested.

import { formatEther, formatUnits } from 'ethers';
import { MOCK_ETH_CHF, MOCK_USDC_CHF, POLICY, USDC_DECIMALS, short } from '@sq/shared';
import type { DecodedAction, PolicyCheck, PolicyResult, SafeTx } from '@sq/shared';

// MOCK sanctions list (in production: Chainalysis / Elliptic / SECO+OFAC feeds).
// The first two entries are real OFAC-listed Ethereum addresses (public SDN list).
export const SANCTIONED: Record<string, string> = {
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
  spentTodayUsdc: number;
  sponsoredToday: number;
  balances: { eth: bigint; usdc: bigint };
  now?: Date;
  /** Recovery flow (owner rotation) is handled by its own procedure, not by this engine. */
  allowSelfCall?: boolean;
}

/** Value of the action expressed in USDC-equivalent (mock rates). */
export function usdcEquivalent(decoded: DecodedAction, tx: SafeTx): number {
  if (decoded.kind === 'erc20-transfer' && decoded.token === 'USDC') return Number(formatUnits(BigInt(decoded.amountRaw!), USDC_DECIMALS));
  const eth = Number(formatEther(BigInt(tx.value)));
  return (eth * MOCK_ETH_CHF) / MOCK_USDC_CHF;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { tx, decoded, safeAddress } = input;
  const checks: PolicyCheck[] = [];
  const add = (c: PolicyCheck) => checks.push(c);
  const lc = (a?: string) => (a ?? '').toLowerCase();

  // 1. Operation type
  add(
    tx.operation === 0
      ? { id: 'operation', label: 'Opération simple (pas de DELEGATECALL)', status: 'pass' }
      : { id: 'operation', label: 'Opération simple (pas de DELEGATECALL)', status: 'fail', detail: "DELEGATECALL n'est jamais co-signé" },
  );

  // 2. Wallet configuration changes only via the recovery procedure
  if (lc(tx.to) === lc(safeAddress) && !input.allowSelfCall) {
    add({ id: 'self-call', label: 'Configuration du wallet inchangée', status: 'fail', detail: 'Les changements de clés passent par la procédure de récupération (avec délai)' });
  }

  // 3. Sanctions screening on every counterparty
  const parties = [tx.to, decoded.recipient, decoded.spender].filter(Boolean).map(lc);
  const hit = parties.find((p) => SANCTIONED[p]);
  add(
    hit
      ? { id: 'sanctions', label: 'Filtrage des sanctions', status: 'fail', detail: `${short(hit)} figure sur une liste de sanctions (${SANCTIONED[hit]})` }
      : { id: 'sanctions', label: 'Filtrage des sanctions', status: 'pass', detail: 'Aucune correspondance (liste OFAC / SECO simulée)' },
  );

  // 4. Funds available on-chain
  let fundsOk = true;
  if (decoded.kind === 'erc20-transfer' && decoded.token === 'USDC') fundsOk = BigInt(decoded.amountRaw!) <= input.balances.usdc;
  if (BigInt(tx.value) > input.balances.eth) fundsOk = false;
  add(
    fundsOk
      ? { id: 'funds', label: 'Fonds disponibles sur la blockchain', status: 'pass' }
      : { id: 'funds', label: 'Fonds disponibles sur la blockchain', status: 'fail', detail: 'Solde insuffisant sur le wallet' },
  );

  // 5. dApp interaction: whitelist + step-up
  const isDapp = decoded.kind === 'contract-call' || decoded.kind === 'erc20-approve';
  if (isDapp) {
    const target = decoded.kind === 'erc20-approve' ? lc(decoded.spender) : lc(tx.to);
    const dapp = DAPP_WHITELIST[target];
    if (!dapp) add({ id: 'dapp', label: 'Liste des dApps approuvées', status: 'fail', detail: `${short(target)} n'est pas une dApp approuvée` });
    else add({ id: 'dapp', label: 'Liste des dApps approuvées', status: 'step-up', detail: `${dapp.name} est approuvée — les dApps demandent des contrôles renforcés` });
    if (decoded.unlimited) add({ id: 'unlimited-approve', label: 'Autorisation illimitée', status: 'step-up', detail: 'Autorisation de dépense illimitée — contrôles renforcés' });
  }

  // 6. Amount threshold
  const amount = usdcEquivalent(decoded, tx);
  add(
    amount >= POLICY.stepUpThresholdUsdc
      ? { id: 'threshold', label: `Montant inférieur à ${POLICY.stepUpThresholdUsdc} USDC`, status: 'step-up', detail: `${amount.toFixed(2)} USDC (équivalent) ≥ seuil` }
      : { id: 'threshold', label: `Montant inférieur à ${POLICY.stepUpThresholdUsdc} USDC`, status: 'pass' },
  );

  // 7. Known recipient
  if (decoded.kind === 'erc20-transfer' || decoded.kind === 'eth-transfer') {
    const known = input.contacts.some((c) => lc(c.address) === lc(decoded.recipient));
    add(
      known
        ? { id: 'recipient', label: 'Destinataire connu', status: 'pass' }
        : { id: 'recipient', label: 'Destinataire connu', status: 'step-up', detail: 'Premier paiement vers cette adresse' },
    );
  }

  // 8. Daily limit
  const dailyOk = input.spentTodayUsdc + amount <= POLICY.dailyLimitUsdc;
  add(
    dailyOk
      ? { id: 'daily', label: `Limite journalière (${POLICY.dailyLimitUsdc} USDC)`, status: 'pass' }
      : { id: 'daily', label: `Limite journalière (${POLICY.dailyLimitUsdc} USDC)`, status: 'fail', detail: 'La limite journalière serait dépassée' },
  );

  // 9. Gas sponsoring quota (anti-abuse)
  const quotaOk = input.sponsoredToday < POLICY.sponsoredTxPerDay;
  add(
    quotaOk
      ? { id: 'gas-quota', label: 'Quota de frais offerts', status: 'pass', detail: `${input.sponsoredToday}/${POLICY.sponsoredTxPerDay} aujourd'hui` }
      : { id: 'gas-quota', label: 'Quota de frais offerts', status: 'fail', detail: 'Quota journalier de transactions offertes atteint' },
  );

  const failed = checks.filter((c) => c.status === 'fail');
  const stepUp = checks.filter((c) => c.status === 'step-up');
  if (failed.length) {
    return { decision: 'reject', level: stepUp.length ? 'step-up' : 'standard', checks, reasons: failed.map((c) => c.detail ?? c.label) };
  }
  if (stepUp.length) return { decision: 'step-up', level: 'step-up', checks, reasons: stepUp.map((c) => c.detail ?? c.label) };
  return { decision: 'approve', level: 'standard', checks, reasons: [] };
}
