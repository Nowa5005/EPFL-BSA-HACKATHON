// Plans and service commission — integer arithmetic only (euro cents, basis points, token minor units).
// The commission applies ONLY to eligible exchanges (swaps). It never applies to incoming/outgoing transfers,
// and plan discounts apply to OUR commission only (not to network or partner fees).

export type Tier = 'free' | 'plus' | 'pro';
export type Billing = 'monthly' | 'annual-upfront' | 'annual-installments';

export interface Plan {
  tier: Tier;
  name: string;
  commissionBps: number; // 80 bps = 0.80 %
  monthlyCents: number;
  annualUpfrontCents?: number;
  annualInstallmentsTotalCents?: number;
}

export const PLANS: Record<Tier, Plan> = {
  free: { tier: 'free', name: 'Gratuit', commissionBps: 80, monthlyCents: 0 },
  plus: { tier: 'plus', name: 'Plus', commissionBps: 40, monthlyCents: 700, annualUpfrontCents: 7000, annualInstallmentsTotalCents: 7000 },
  pro: { tier: 'pro', name: 'Pro', commissionBps: 20, monthlyCents: 1500, annualUpfrontCents: 15000, annualInstallmentsTotalCents: 15000 },
};
export const PRICING_CURRENCY = 'EUR';

/** Splits a total into 12 instalments (cents): equal floor amounts, the remainder on the LAST one (Plus: 11 × 5.83 + 5.87). */
export function installments(totalCents: number, n = 12): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('total must be integer cents');
  const base = Math.floor(totalCents / n);
  return [...Array(n - 1).fill(base), totalCents - base * (n - 1)];
}

/** Commission in token minor units, rounded half-up (bigint-safe). */
export function commission(amountMinor: bigint, bps: number): bigint {
  if (amountMinor < 0n) throw new Error('negative amount');
  return (amountMinor * BigInt(bps) + 5000n) / 10000n;
}

/** Monthly cost of a plan for a monthly exchanged volume (cents): subscription + commission, third-party fees excluded. */
export function monthlyCostCents(tier: Tier, volumeCents: number): number {
  const p = PLANS[tier];
  return p.monthlyCents + Math.round((volumeCents * p.commissionBps) / 10000);
}

/** Volume (cents) above which plan `b` costs less than plan `a` (monthly billing). */
export function breakEvenCents(a: Tier, b: Tier): number {
  const pa = PLANS[a];
  const pb = PLANS[b];
  return Math.round(((pb.monthlyCents - pa.monthlyCents) * 10000) / (pa.commissionBps - pb.commissionBps));
}

export function cheapestTier(volumeCents: number): Tier {
  return (['free', 'plus', 'pro'] as Tier[]).reduce((best, t) => (monthlyCostCents(t, volumeCents) < monthlyCostCents(best, volumeCents) ? t : best), 'free');
}

export const euros = (cents: number) => (cents / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
