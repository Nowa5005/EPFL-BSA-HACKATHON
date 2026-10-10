// #9 — Travel Rule transmission between VASPs, modelled on the Travel Rule Protocol (TRP, OpenVASP association):
// the originating VASP POSTs a "transfer inquiry" (asset, amount, beneficiary address, IVMS101 payload) to the
// beneficiary VASP, which answers "approved" (the address is its customer's) or "rejected" — BEFORE the transfer is
// broadcast. Differences with real TRP v3 (documented in docs/COMPLIANCE.md): authentication here is an Ed25519
// signature on each message (node:crypto) instead of mutual TLS, and the address → VASP directory is a static demo
// list instead of Travel Addresses / a network directory. Isomorphic file (types, directory, message builders);
// the signing helpers are node-only (trpCrypto.ts, exported from '@sq/shared/server').

import { SERVICE_URLS } from './constants';
import type { LegalPerson, Ivms101Message } from './ivms101';

export const TRP = {
  /** Our message format version (TRP-like, NOT wire-compatible with TRP v3). */
  version: 'mywall-trp-mock/1',
  /** TRP's `api-version` header value we imitate. */
  apiVersion: '3.1.0',
  network: 'eip155:11155111', // CAIP-2: Ethereum Sepolia
  /** A message older/newer than this is refused (replay window). */
  clockSkewSec: 300,
  inquiryPath: '/trp/transfers',
  identityPath: '/trp/identity',
} as const;

export interface VaspInfo {
  vaspId: string;
  /** Legal name (IVMS101 legalPersonName, LEGL). */
  name: string;
  /** ISO 17442 LEI — FICTITIOUS demo values (valid check digits, not registered with GLEIF). */
  lei: string;
  country: string;
  /** Base URL of its TRP endpoint (inquiry + identity). */
  endpoint: string;
}

/** Our own identity as an originating VASP. */
export const SWISSQUOTE_VASP: VaspInfo = { vaspId: 'swissquote', name: 'Swissquote Bank SA', lei: 'DEMO00SWISSQUOTE0177', country: 'CH', endpoint: SERVICE_URLS.cosigner };

/** Counterparty VASPs reachable on the (simulated) Travel Rule network. */
export const VASPS: Record<string, VaspInfo> = {
  'demo-exchange-ag': { vaspId: 'demo-exchange-ag', name: 'Demo Exchange AG', lei: 'DEMO00DEMOEXCHG00166', country: 'CH', endpoint: SERVICE_URLS.vasp },
};

/**
 * DEMO directory: deposit address → VASP that manages it. In production this comes from the Travel Rule network
 * (Travel Address / directory lookups, or the beneficiary VASP answering an address-ownership query). Addresses are
 * public data; the names of the VASP's customers are NOT here (they stay with that VASP).
 */
export const VASP_DIRECTORY: Record<string, string> = {
  '0xde0e0000000000000000000000000000000d0e01': 'demo-exchange-ag',
  '0xde0e0000000000000000000000000000000d0e02': 'demo-exchange-ag',
};

export const vaspForAddress = (address: string): VaspInfo | null => {
  const id = VASP_DIRECTORY[address.toLowerCase()];
  return id ? VASPS[id] ?? null : null;
};

/** IVMS101 legal person of a VASP (name + LEI + country). */
export function vaspLegalPerson(v: VaspInfo): LegalPerson {
  return {
    name: { nameIdentifier: [{ legalPersonName: v.name, legalPersonNameIdentifierType: 'LEGL' }] },
    nationalIdentification: { nationalIdentifier: v.lei, nationalIdentifierType: 'LEIX' },
    countryOfRegistration: v.country,
  };
}

/** Transfer inquiry (signed by the originating VASP). */
export interface TrpInquiry {
  version: typeof TRP.version;
  requestIdentifier: string;
  createdAt: string;
  originatorVasp: string;
  beneficiaryVasp: string;
  asset: { caip19: string; symbol: 'ETH' | 'USDC' };
  amount: string;
  beneficiaryAddress: string;
  ivms101: Ivms101Message;
}

/** Answer of the beneficiary VASP (signed by it). */
export interface TrpResponse {
  version: typeof TRP.version;
  requestIdentifier: string;
  /** sha256 (hex) of the exact inquiry payload bytes it answers. */
  inquiryDigest: string;
  vasp: string;
  decidedAt: string;
  approved?: { address: string; reference: string };
  rejected?: { code: 'beneficiary-name-mismatch' | 'unknown-address' | 'invalid-ivms101' | 'invalid-inquiry' | 'policy'; reason: string };
}

/** Signed envelope: the signature covers the exact UTF-8 bytes of `payload` (no canonicalisation needed). */
export interface SignedEnvelope {
  payload: string;
  signature: string; // base64url Ed25519 signature
  keyId: string; // "<vaspId>#<fingerprint>"
  alg: 'Ed25519';
}

export const caip19 = (asset: 'ETH' | 'USDC', usdcAddress: string) => (asset === 'ETH' ? `${TRP.network}/slip44:60` : `${TRP.network}/erc20:${usdcAddress.toLowerCase()}`);

// ───────────── Self-hosted wallet: ownership proof signed by the beneficiary (EIP-191 personal_sign) ─────────────

export interface OwnershipChallenge {
  address: string;
  name: string;
  nonce: string;
  issuedAt: string;
}

/** Exact text the beneficiary signs with the wallet that receives the transfer (EIP-191 personal_sign). */
export function ownershipProofMessage(c: OwnershipChallenge): string {
  return [
    'My Wall — proof of wallet ownership (Travel Rule)',
    '',
    `I, ${c.name}, control the address ${c.address} and I am the beneficiary of transfers sent to it.`,
    '',
    `Network: Ethereum Sepolia (${TRP.network})`,
    `Nonce: ${c.nonce}`,
    `Issued at: ${c.issuedAt}`,
    '',
    'This signature costs nothing, sends no transaction and gives no access to your funds.',
  ].join('\n');
}

/** Parses a message produced by ownershipProofMessage (null if the text was altered). */
export function parseOwnershipProofMessage(msg: string): OwnershipChallenge | null {
  const m = msg.match(/^My Wall — proof of wallet ownership \(Travel Rule\)\n\nI, (.+), control the address (0x[0-9a-fA-F]{40}) and I am the beneficiary of transfers sent to it\.\n\nNetwork: Ethereum Sepolia \(eip155:11155111\)\nNonce: ([0-9a-f]{32})\nIssued at: (\S+)\n\nThis signature costs nothing, sends no transaction and gives no access to your funds\.$/);
  if (!m) return null;
  const c = { name: m[1], address: m[2], nonce: m[3], issuedAt: m[4] };
  return ownershipProofMessage(c) === msg ? c : null;
}
