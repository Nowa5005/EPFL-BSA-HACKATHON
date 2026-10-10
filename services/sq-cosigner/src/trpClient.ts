// #9 — Swissquote as ORIGINATING VASP on a TRP-like Travel Rule network: builds the IVMS101 inquiry, signs it with
// Swissquote's Ed25519 key (node:crypto), sends it to the beneficiary VASP and verifies its SIGNED answer
// (pinned key, same requestIdentifier, digest of our exact inquiry, same address). Only a verified "approved" lets
// K2 co-sign (travelRuleGlue.ts). Keys: data/trp-ed25519.json (git-ignored, encrypted with SERVICE_MASTER_KEY when
// set); peers: data/trp-peers.json. No personal data in logs.

import path from 'node:path';
import { getAddress } from 'ethers';
import {
  SWISSQUOTE_VASP,
  TRP,
  USDC_ADDRESS,
  caip19,
  personFromName,
  addressFromParts,
  vaspLegalPerson,
  validateIvms101,
  type BeneficiaryInput,
  type Ivms101Message,
  type Person,
  type TrpInquiry,
  type TrpResponse,
  type VaspInfo,
} from '@sq/shared';
import { EnvelopeError, PeerKeys, fetchVaspIdentity, loadOrCreateVaspKey, newId, sha256Hex, signEnvelope, verifyEnvelope, type VaspKey } from '@sq/shared/server';
import { DATA_DIR } from './paths';
import type { TrpOutcome } from './travelRule';

let key: VaspKey | null = null;
/** Swissquote's Travel Rule signing key (created on first use, never regenerated). */
export function swissquoteVaspKey(): VaspKey {
  key ??= loadOrCreateVaspKey(path.join(DATA_DIR, 'trp-ed25519.json'), SWISSQUOTE_VASP.vaspId, process.env.SERVICE_MASTER_KEY || undefined);
  return key;
}

let peers: PeerKeys | null = null;
const peerKeys = () => (peers ??= new PeerKeys(path.join(DATA_DIR, 'trp-peers.json')));

/** Pinned public key of a counterparty VASP (fetched from its identity endpoint on first contact). */
export async function counterpartyKey(v: VaspInfo): Promise<string> {
  const pinned = peerKeys().get(v.vaspId);
  if (pinned) return pinned;
  const id = await fetchVaspIdentity(v.endpoint, TRP.identityPath);
  if (id.vaspId !== v.vaspId) throw new EnvelopeError('The counterparty identity does not match the directory');
  return peerKeys().pin(v.vaspId, id.publicKeyPem);
}

/** IVMS101 message for a transfer from our client's Safe to a beneficiary at another VASP. */
export function buildIvms101(o: { originator: Person; safeAddress: string; beneficiary: BeneficiaryInput; recipient: string; vasp: VaspInfo }): Ivms101Message {
  const address = addressFromParts({ street: o.beneficiary.street, postcode: o.beneficiary.postcode, city: o.beneficiary.city, country: o.beneficiary.country });
  return {
    originator: { originatorPersons: [o.originator], accountNumber: [getAddress(o.safeAddress)] },
    beneficiary: { beneficiaryPersons: [personFromName(o.beneficiary.name, address ? { address } : {})], accountNumber: [getAddress(o.recipient)] },
    originatingVASP: { originatingVASP: { legalPerson: vaspLegalPerson(SWISSQUOTE_VASP) } },
    beneficiaryVASP: { beneficiaryVASP: { legalPerson: vaspLegalPerson(o.vasp) } },
  };
}

export function buildInquiry(o: { ivms101: Ivms101Message; vasp: VaspInfo; asset: 'ETH' | 'USDC'; amount: string; recipient: string; now?: Date }): TrpInquiry {
  return {
    version: TRP.version,
    requestIdentifier: newId(),
    createdAt: (o.now ?? new Date()).toISOString(),
    originatorVasp: SWISSQUOTE_VASP.vaspId,
    beneficiaryVasp: o.vasp.vaspId,
    asset: { caip19: caip19(o.asset, USDC_ADDRESS), symbol: o.asset },
    amount: o.amount,
    beneficiaryAddress: getAddress(o.recipient),
    ivms101: o.ivms101,
  };
}

export interface TransmitDeps {
  key?: VaspKey;
  /** Public key of the counterparty (tests); default: pinned key / identity endpoint. */
  counterpartyKey?: (v: VaspInfo) => Promise<string>;
  fetchImpl?: typeof fetch;
}

/**
 * Sends the signed inquiry and returns a VERIFIED outcome. Anything unexpected (network error, HTTP error, bad
 * signature, answer not bound to our inquiry) → status 'error' — never treated as approved.
 */
export async function transmitInquiry(inquiry: TrpInquiry, vasp: VaspInfo, deps: TransmitDeps = {}): Promise<TrpOutcome> {
  const k = deps.key ?? swissquoteVaspKey();
  const errors = validateIvms101(inquiry.ivms101, { requireBeneficiaryVasp: true });
  const base = { requestIdentifier: inquiry.requestIdentifier, vaspId: vasp.vaspId, vaspName: vasp.name, transmittedAt: new Date().toISOString(), responseVerified: false };
  const env = signEnvelope(inquiry, k);
  const digest = sha256Hex(env.payload);
  if (errors.length) return { ...base, status: 'error', reasonCode: 'invalid-ivms101-local', inquiryDigest: digest };
  let resJson: unknown;
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${vasp.endpoint}${TRP.inquiryPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-version': TRP.apiVersion, 'request-identifier': inquiry.requestIdentifier },
      body: JSON.stringify(env),
      signal: AbortSignal.timeout(8000),
    });
    resJson = await res.json().catch(() => null);
    if (!res.ok) return { ...base, status: 'error', reasonCode: `http-${res.status}`, inquiryDigest: digest };
  } catch {
    return { ...base, status: 'error', reasonCode: 'unreachable', inquiryDigest: digest };
  }
  let resp: TrpResponse;
  try {
    const pem = await (deps.counterpartyKey ?? counterpartyKey)(vasp);
    resp = verifyEnvelope<TrpResponse>(resJson, pem, vasp.vaspId);
  } catch {
    return { ...base, status: 'error', reasonCode: 'bad-response-signature', inquiryDigest: digest };
  }
  // The answer must be about THIS inquiry (digest of the exact bytes we signed) and come from that VASP.
  if (resp.requestIdentifier !== inquiry.requestIdentifier || resp.inquiryDigest !== digest || resp.vasp !== vasp.vaspId)
    return { ...base, status: 'error', reasonCode: 'response-not-bound', inquiryDigest: digest };
  const verified = { ...base, responseVerified: true, decidedAt: resp.decidedAt, inquiryDigest: digest };
  if (resp.approved && !resp.rejected) {
    if (resp.approved.address.toLowerCase() !== inquiry.beneficiaryAddress.toLowerCase()) return { ...verified, status: 'error', reasonCode: 'approved-other-address' };
    return { ...verified, status: 'approved', reference: String(resp.approved.reference).slice(0, 64) };
  }
  return { ...verified, status: 'rejected', reasonCode: resp.rejected?.code ?? 'unspecified' };
}
