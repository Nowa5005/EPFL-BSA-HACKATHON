// Token whitelist, look-alike addresses (address poisoning) and pre-send address checks (#3, #19, #20).
// Shared by the co-signer (policy / indexer) and the web app (wallet, send flow). No network access here.

import { getAddress, isAddress } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS } from './constants';

/** Whitelisted ERC-20 tokens on Ethereum Sepolia. Anything else received is "unrecognised": never valued,
 *  never interacted with (see policy.ts / validate.ts). */
export const KNOWN_TOKENS: Record<string, { symbol: 'USDC'; name: string; decimals: number }> = {
  [USDC_ADDRESS.toLowerCase()]: { symbol: 'USDC', name: 'USD Coin (Circle, Sepolia)', decimals: USDC_DECIMALS },
};

export const isKnownToken = (address: string) => !!KNOWN_TOKENS[address.toLowerCase()];

/** ERC-20 / ERC-721 / permit-style selectors: a call with one of these to an unrecognised contract is a token interaction. */
export const TOKEN_SELECTORS: Record<string, string> = {
  '0xa9059cbb': 'transfer',
  '0x095ea7b3': 'approve',
  '0x23b872dd': 'transferFrom',
  '0x39509351': 'increaseAllowance',
  '0xd505accf': 'permit',
  '0xa22cb465': 'setApprovalForAll',
  '0x42842e0e': 'safeTransferFrom',
  '0xb88d4fde': 'safeTransferFrom',
};

/**
 * Address poisoning look-alike: a DIFFERENT address with the same first 4 AND last 4 hex characters
 * (what wallets usually show: 0x1234…abcd). Case-insensitive.
 */
export function isLookalike(a: string, b: string): boolean {
  if (!isAddress(a) || !isAddress(b)) return false;
  const x = a.toLowerCase().slice(2);
  const y = b.toLowerCase().slice(2);
  return x !== y && x.slice(0, 4) === y.slice(0, 4) && x.slice(-4) === y.slice(-4);
}

/** First known address (contact, own wallet, past recipient) that `address` imitates, if any. */
export function lookalikeOf<T extends { address: string }>(address: string, known: T[]): T | undefined {
  return known.find((k) => isLookalike(address, k.address));
}

/** Address formats of OTHER chains pasted into an Ethereum field (#20). Returns the chain name, or null. */
export function foreignAddressFormat(input: string): string | null {
  const s = input.trim();
  if (!s || /^0x[0-9a-fA-F]{40}$/.test(s)) return null;
  if (/^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{8,87}$/i.test(s)) return 'Bitcoin';
  if (/^[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return 'Bitcoin';
  if (/^(ltc1|tltc1)[02-9ac-hj-np-z]{8,87}$/i.test(s) || /^[LM][1-9A-HJ-NP-Za-km-z]{26,33}$/.test(s)) return 'Litecoin';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return 'Tron';
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s)) return 'XRP Ledger';
  if (/^(addr1|addr_test1)[0-9a-z]{20,}$/.test(s)) return 'Cardano';
  if (/^cosmos1[0-9a-z]{38}$/.test(s)) return 'Cosmos';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return 'Solana';
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return 'Aptos / Sui (or a transaction hash)';
  return null;
}

/** EIP-681 payment URI for a receive QR: ethereum:<checksummed address>@<chainId>. */
export function eip681Uri(address: string, chainId: number): string {
  return `ethereum:${getAddress(address)}@${chainId}`;
}

/** Parses `ethereum:<address>[@chainId][/function][?params]` (EIP-681) → { address, chainId? }. */
export function parseEip681(uri: string): { address: string; chainId?: number } | null {
  const m = uri.trim().match(/^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:[/?].*)?$/);
  if (!m || !isAddress(m[1])) return null;
  return { address: getAddress(m[1]), ...(m[2] ? { chainId: Number(m[2]) } : {}) };
}

/** Scam token names often carry a URL or bait text: shown only as a short, inert label. */
export function inertTokenLabel(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const clean = s.replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || '?';
}
