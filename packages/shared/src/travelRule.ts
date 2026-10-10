// Travel Rule / third-party transfer policy — shared by the co-signer (authoritative, server-side) and the web app
// (same field rules, for a helpful form). Sources and limits: docs/COMPLIANCE.md. NOT legal advice; to be validated
// by compliance. Server-side env overrides: TRAVEL_RULE_THRESHOLD_CHF, TRAVEL_RULE_RATE_MAX_AGE_SEC,
// TRAVEL_RULE_LINKED_WINDOW_DAYS (see services/sq-cosigner/src/travelRule.ts). #9: transmission over a TRP-like
// network (packages/shared/src/trp.ts, IVMS101 in ivms101.ts) to a simulated counterparty VASP (services/vasp-mock).

export const TRAVEL_RULE = {
  /** Bumped whenever the rules below change; recorded in every audit entry. */
  version: 'TR-2026-10-11.1',
  /**
   * Enhanced beneficiary-data collection from this CHF counter-value INCLUDED (≥). Product hypothesis from the brief,
   * aligned on the CHF 1'000 / 30 days figure of the 2023 AMLO-FINMA revision (which concerns exchange transactions
   * against cash/anonymous means of payment — see docs). It never switches off stricter obligations: the beneficiary's
   * full name is required for EVERY third-party transfer, and the transmission obligation has no threshold.
   */
  enhancedThresholdChf: 1000,
  /** Linked operations: outgoing third-party transfers to the same beneficiary within this rolling window are summed. */
  linkedWindowDays: 30,
  linkedAggregation: 'same-beneficiary' as const,
  /** A CHF rate older than this (or flagged stale) is not trusted: the transfer is treated as ≥ threshold. */
  rateMaxAgeSec: 15 * 60,
  /**
   * #9 — Transmission: IVMS101 messages signed with Ed25519, sent over a TRP-like API to the beneficiary VASP BEFORE
   * co-signing. In this prototype the network is SIMULATED (one counterparty: services/vasp-mock, "Demo Exchange AG").
   * Production: a real Travel Rule network (TRP / OpenVASP, or a commercial provider), to be chosen with compliance.
   */
  transmissionIntegration: 'TRP-like, simulated network (vasp-mock)' as null | string,
  /** A beneficiary's ownership proof (signed message) must have been requested less than this long ago. */
  ownershipProofMaxAgeSec: 24 * 3600,
  /** Retention of beneficiary records (configured value, see docs/COMPLIANCE.md). */
  retentionYears: 10,
};

export type BeneficiaryWalletType = 'hosted' | 'unhosted';

export interface BeneficiaryInput {
  /** Full name (natural person) or company name — always required for a third party. */
  name: string;
  /** Exchange / bank account (hosted, a service provider holds the keys) or a personal wallet (unhosted). */
  walletType: BeneficiaryWalletType;
  /** Name of the exchange / institution when hosted. */
  providerName?: string;
  // Enhanced fields (counter-value ≥ threshold, alone or with linked operations)
  street?: string;
  postcode?: string;
  city?: string;
  country?: string; // ISO 3166-1 alpha-2
  relationship?: string;
  purpose?: string;
  accuracyConfirmed?: boolean;
  /**
   * #9 — Personal (unhosted) wallet of a third party: proof that the beneficiary controls the address — a message
   * produced by the co-signer (ownershipProofMessage) signed by that address (EIP-191 personal_sign).
   */
  ownershipProof?: { message: string; signature: string };
  /** #9 — Personal wallet, below the threshold only: the client declares the wallet belongs to the beneficiary. */
  declaresOwnership?: boolean;
}

/** What the client declares in the send flow. */
export type TransferDeclaration = { kind: 'own' } | { kind: 'third-party'; beneficiary: BeneficiaryInput };

export const RELATIONSHIPS = ['family', 'friend', 'business', 'self-other-institution', 'other'] as const;

/** Field ids that are missing for this beneficiary (same rule on both sides; the server's answer is authoritative). */
export function missingBeneficiaryFields(b: Partial<BeneficiaryInput> | undefined, enhanced: boolean): string[] {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const miss: string[] = [];
  if (!b || s(b.name).length < 2 || !/\s/.test(s(b.name))) miss.push('name'); // full name: at least two words
  if (!b || (b.walletType !== 'hosted' && b.walletType !== 'unhosted')) miss.push('walletType');
  if (b?.walletType === 'hosted' && !s(b.providerName)) miss.push('providerName');
  if (enhanced) {
    if (!s(b?.street)) miss.push('street');
    if (!s(b?.city)) miss.push('city');
    if (!/^[A-Z]{2}$/.test(s(b?.country).toUpperCase())) miss.push('country');
    if (!s(b?.relationship)) miss.push('relationship');
    if (!s(b?.purpose)) miss.push('purpose');
    if (b?.accuracyConfirmed !== true) miss.push('accuracyConfirmed');
  }
  return miss;
}

/** Normalised key used to link operations to the "same beneficiary" (name, case/space/accents-insensitive). */
export const beneficiaryKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
