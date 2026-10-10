// vasp-mock — a SIMULATED counterparty VASP ("Demo Exchange AG") on a TRP-like Travel Rule network (#9).
// Separate process, own data directory (customers, received inquiries, its Ed25519 key, pinned peer keys).
// It is a counterparty, not part of Swissquote: it does NOT use our client-session guard. Every inquiry must be
// signed (Ed25519) by a known originating VASP whose public key is fetched from that VASP's identity endpoint and
// pinned on first use. Answers are signed with this VASP's own key.
//
// Decision (what a real beneficiary VASP checks before accepting a transfer): the deposit address belongs to one of
// its customers AND the beneficiary named in the IVMS101 payload matches that customer → "approved" (+ reference);
// otherwise "rejected" with a reason code. Personal data is kept in its records only — never in console logs.

import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getAddress } from 'ethers';
import {
  SWISSQUOTE_VASP,
  TRP,
  VASPS,
  beneficiaryKey,
  personName,
  validateIvms101,
  type Person,
  type TrpInquiry,
  type TrpResponse,
  type VaspInfo,
} from '@sq/shared';
import { EnvelopeError, JsonStore, PeerKeys, fetchVaspIdentity, loadOrCreateVaspKey, newId, sha256Hex, signEnvelope, verifyEnvelope } from '@sq/shared/server';

export interface Customer {
  customerId: string;
  name: string;
  country: string;
}

export interface InquiryRecord {
  requestIdentifier: string;
  from: string;
  receivedAt: string;
  inquiryDigest: string;
  decision: 'approved' | 'rejected';
  reference?: string;
  reasonCode?: string;
  /** The IVMS101 payload as received — this VASP's own Travel Rule record (personal data, never logged). */
  inquiry: TrpInquiry;
}

interface VaspDb {
  customers: Record<string, Customer>; // lower-case deposit address → customer
  inquiries: Record<string, InquiryRecord>;
}

/** Fictitious customers of Demo Exchange AG (deposit addresses listed in the shared VASP directory). */
export const DEMO_CUSTOMERS: Record<string, Customer> = {
  '0xde0e0000000000000000000000000000000d0e01': { customerId: 'DEX-C-1001', name: 'Dana Example', country: 'CH' },
  '0xde0e0000000000000000000000000000000d0e02': { customerId: 'DEX-C-1002', name: 'Elias Beispiel', country: 'DE' },
};

/** Same person? Case, accents, spacing and word order are ignored (e.g. "EXAMPLE Dana" = "Dana Example"). */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => beneficiaryKey(s).replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter(Boolean).sort().join(' ');
  return !!norm(a) && norm(a) === norm(b);
}

export interface VaspAppOptions {
  dataDir: string;
  self?: VaspInfo;
  /** Originating VASPs allowed to send inquiries (vaspId → info). Default: Swissquote. */
  senders?: Record<string, VaspInfo>;
  /** Public key of a sender (tests inject it); default: fetched from its identity endpoint and pinned. */
  resolveSenderKey?: (vaspId: string) => Promise<string>;
  now?: () => Date;
  log?: (line: string) => void;
}

export function createVaspApp(opts: VaspAppOptions) {
  const self = opts.self ?? VASPS['demo-exchange-ag'];
  const senders = opts.senders ?? { [SWISSQUOTE_VASP.vaspId]: SWISSQUOTE_VASP };
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((l: string) => console.log(l));
  const key = loadOrCreateVaspKey(path.join(opts.dataDir, 'vasp-ed25519.json'), self.vaspId);
  const peers = new PeerKeys(path.join(opts.dataDir, 'trp-peers.json'));
  const store = new JsonStore<VaspDb>(opts.dataDir, 'vasp', () => ({ customers: { ...DEMO_CUSTOMERS }, inquiries: {} }));
  const resolveSenderKey =
    opts.resolveSenderKey ??
    (async (vaspId: string) => {
      const pinned = peers.get(vaspId);
      if (pinned) return pinned;
      const id = await fetchVaspIdentity(senders[vaspId].endpoint, TRP.identityPath);
      if (id.vaspId !== vaspId) throw new EnvelopeError('Identity does not match the sender');
      return peers.pin(vaspId, id.publicKeyPem);
    });

  const app = express();
  app.disable('x-powered-by');
  // Server-to-server API only: a browser (any request with an Origin header) is refused; JSON bodies only.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.origin !== undefined) return res.status(403).json({ error: 'Browser requests are not accepted' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (req.method === 'POST' && String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(415).json({ error: 'application/json required' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ service: 'vasp-mock', vasp: self.name, vaspId: self.vaspId, protocol: TRP.version, simulated: true });
  });

  /** Public identity (what a Travel Rule directory would publish): id, legal name, LEI, Ed25519 public key. */
  app.get(TRP.identityPath, (_req, res) => {
    res.json({ vaspId: self.vaspId, name: self.name, lei: self.lei, country: self.country, publicKeyPem: key.publicKeyPem, keyId: key.keyId, alg: 'Ed25519' });
  });

  const answer = (inquiryPayload: string, inq: Pick<TrpInquiry, 'requestIdentifier'>, decision: Pick<TrpResponse, 'approved' | 'rejected'>) => {
    const resp: TrpResponse = { version: TRP.version, requestIdentifier: inq.requestIdentifier, inquiryDigest: sha256Hex(inquiryPayload), vasp: self.vaspId, decidedAt: now().toISOString(), ...decision };
    return signEnvelope(resp, key);
  };

  /** TRP-like transfer inquiry: signed IVMS101 payload in, signed approved / rejected out. */
  app.post(TRP.inquiryPath, async (req: Request, res: Response) => {
    const env = req.body;
    const keyId = typeof env?.keyId === 'string' ? env.keyId : '';
    const sender = keyId.split('#')[0];
    if (!senders[sender]) return res.status(401).json({ error: 'Unknown originating VASP' });
    let inq: TrpInquiry;
    try {
      const pem = await resolveSenderKey(sender);
      inq = verifyEnvelope<TrpInquiry>(env, pem, sender);
    } catch (e) {
      log(`[vasp-mock] inquiry refused: ${e instanceof EnvelopeError ? e.message : 'sender key unavailable'}`);
      return res.status(401).json({ error: e instanceof EnvelopeError ? e.message : 'Could not authenticate the originating VASP' });
    }
    // Authenticated from here: content problems get a SIGNED rejection.
    const payload = env.payload as string;
    const reject = (code: NonNullable<TrpResponse['rejected']>['code'], reason: string) => {
      record(inq, sender, payload, 'rejected', undefined, code);
      log(`[vasp-mock] inquiry ${String(inq.requestIdentifier).slice(0, 8)} from ${sender} → rejected (${code})`);
      return res.json(answer(payload, inq, { rejected: { code, reason } }));
    };
    if (inq?.version !== TRP.version || typeof inq.requestIdentifier !== 'string' || !/^[0-9a-f-]{36}$/.test(inq.requestIdentifier))
      return res.status(400).json({ error: 'Invalid inquiry (version / requestIdentifier)' });
    if (store.data.inquiries[inq.requestIdentifier]) return res.status(409).json({ error: 'Duplicate requestIdentifier (replay refused)' });
    const age = (now().getTime() - Date.parse(inq.createdAt)) / 1000;
    if (!Number.isFinite(age) || Math.abs(age) > TRP.clockSkewSec) return reject('invalid-inquiry', 'Inquiry timestamp outside the accepted window');
    if (inq.originatorVasp !== sender || inq.beneficiaryVasp !== self.vaspId) return reject('invalid-inquiry', 'Inquiry not addressed to this VASP');
    let address: string;
    try {
      address = getAddress(inq.beneficiaryAddress);
    } catch {
      return reject('invalid-inquiry', 'Invalid beneficiary address');
    }
    if (!['ETH', 'USDC'].includes(inq.asset?.symbol) || !(Number(inq.amount) >= 0)) return reject('invalid-inquiry', 'Unsupported asset or amount');
    const errors = validateIvms101(inq.ivms101, { requireBeneficiaryVasp: true });
    if (errors.length) return reject('invalid-ivms101', `IVMS101 payload invalid: ${errors.slice(0, 5).join('; ')}`);
    if (!inq.ivms101.beneficiary.accountNumber.some((a) => a.toLowerCase() === address.toLowerCase())) return reject('invalid-ivms101', 'Beneficiary account number does not match the transfer address');
    const customer = store.data.customers[address.toLowerCase()];
    if (!customer) return reject('unknown-address', `${address} is not a deposit address of ${self.name}`);
    const named = inq.ivms101.beneficiary.beneficiaryPersons.map((p: Person) => personName(p));
    if (!named.some((n) => namesMatch(n, customer.name)))
      return reject('beneficiary-name-mismatch', `The beneficiary named in the Travel Rule data does not match the holder of this ${self.name} account`);
    const reference = `DEX-TR-${now().toISOString().slice(0, 10).replace(/-/g, '')}-${newId().slice(0, 6).toUpperCase()}`;
    record(inq, sender, payload, 'approved', reference);
    log(`[vasp-mock] inquiry ${inq.requestIdentifier.slice(0, 8)} from ${sender} → approved (${reference})`);
    return res.json(answer(payload, inq, { approved: { address, reference } }));
  });

  function record(inq: TrpInquiry, from: string, payload: string, decision: 'approved' | 'rejected', reference?: string, reasonCode?: string) {
    if (typeof inq?.requestIdentifier !== 'string') return;
    store.update((d) => {
      d.inquiries[inq.requestIdentifier] = { requestIdentifier: inq.requestIdentifier, from, receivedAt: now().toISOString(), inquiryDigest: sha256Hex(payload), decision, reference, reasonCode, inquiry: inq };
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err instanceof SyntaxError ? 'Malformed JSON' : 'Bad request' });
  });

  return { app, key, store, self };
}
