// CHF valuation helpers for the co-signer. Rates come from the market-data service (fetchWalletRates in
// @sq/shared/server: CoinGecko CHF, timestamped). There is NO fixed fallback rate: a missing rate is reported
// as such (fee "CHF value unavailable") or handled fail-safe by the policy engine (never valued at 0).

import type { ServerRate, WalletRates } from '@sq/shared/server';
import type { PolicyRates } from './policy';

/** A rate older than this is not used for limits/thresholds (treated as missing → fail-safe step-up). */
export const POLICY_RATE_MAX_AGE_MS = 60 * 60 * 1000;

const usable = (r: ServerRate | undefined, now: number, maxAgeMs: number) =>
  !!r && Number.isFinite(r.chf) && r.chf > 0 && now - new Date(r.asOf).getTime() <= maxAgeMs;

/** Rates usable by the policy engine (recent only). */
export function policyRates(rates: WalletRates, now = Date.now(), maxAgeMs = POLICY_RATE_MAX_AGE_MS): PolicyRates {
  const out: PolicyRates = {};
  if (usable(rates.ETH, now, maxAgeMs)) out.ETH = rates.ETH!.chf;
  if (usable(rates.USDC, now, maxAgeMs)) out.USDC = rates.USDC!.chf;
  return out;
}

/** Network fee (ETH string) in CHF with the real ETH rate; chf null when no rate is available. */
export function feeChf(eth: string, rate: ServerRate | undefined) {
  if (!rate || !(rate.chf > 0)) return { chf: null, rate: null };
  return {
    chf: Math.round(Number(eth) * rate.chf * 100) / 100,
    rate: { chf: rate.chf, asOf: rate.asOf, provider: rate.provider, stale: rate.stale },
  };
}
