import { JsonStore, newId, nowIso, t } from '@sq/shared/server';
import { splitText, type ActivityEvent, type Bilingual, type PolicyResult, type SafeTx } from '@sq/shared';
import { DATA_DIR } from './paths';

export interface Device {
  credentialId: string; // base64url
  publicKey: string; // base64url (COSE)
  counter: number;
  transports?: string[];
  deviceType: 'mobile' | 'desktop';
  label: string;
  status: 'active' | 'pending-recovery' | 'revoked';
  createdAt: string;
}

export interface Client {
  clientId: string;
  name: string;
  email: string;
  headless?: boolean; // scripted demo client (no browser passkey)
  safeAddress?: string;
  deployTxHash?: string;
  owners?: { device: string; cosigner: string; recovery: string };
  devices: Device[];
  contacts: { name: string; address: string; addedAt: string; verifiedOwnership?: boolean; email?: string }[];
  /** unvaluedEth: ETH sent today while no market rate was available (valued later, never counted as 0). */
  usage: { day: string; spentUsdc: number; sponsoredTx: number; unvaluedEth?: number };
  privacy: 'full' | 'balance-only' | 'none';
  frozen?: boolean;
  frozenBy?: 'client' | 'compliance';
  preferences?: Preferences;
  subscription?: Subscription;
  /** Backup code (passkey alternative): only a scrypt hash is stored, never the code. */
  backupCode?: { salt: string; hash: string; createdAt: string; failed: number; lockedUntil?: string };
  /** Demo-only override of the network-fee estimate (CHF), to show a fee change during confirmation. */
  demoFeeChf?: number;
  /** Travel Rule beneficiary records (personal data: this client + compliance only; never in logs/activity/chain). */
  travelRule?: { records: import('./travelRule').TravelRuleRecord[] };
}

export interface Preferences {
  background: 'default' | 'white' | 'sand' | 'mist';
  accent: 'orange' | 'blue' | 'green' | 'violet';
  highlight: boolean;
  hiddenWallets: string[];
  hideAmounts: boolean;
}
export const DEFAULT_PREFERENCES: Preferences = { background: 'default', accent: 'orange', highlight: false, hiddenWallets: [], hideAmounts: false };

export interface Subscription {
  tier: 'free' | 'plus' | 'pro';
  billing: 'monthly' | 'annual-upfront' | 'annual-installments';
  status: 'active' | 'cancel-at-period-end' | 'ended';
  startedAt: string;
  currentPeriodEnd: string;
  commitmentEnd?: string; // annual instalments: 12-month commitment
  schedule: { dueAt: string; amountCents: number; status: 'paid-demo' | 'scheduled' }[];
  payment: 'demo';
}

export interface Preview {
  id: string;
  clientId: string;
  safeAddress: string;
  safeTx: SafeTx;
  safeTxHash: string;
  intent: unknown;
  challenge: string; // bytes32 hex used as WebAuthn challenge
  /** chf: null when no ETH market rate was available (fee shown in ETH, "CHF value unavailable"). */
  fee: { available: boolean; chf: number | null; eth: string; gasUnits: string; demo: boolean; rate?: { chf: number; asOf: string; provider: string; stale: boolean } | null };
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

export interface Scheduled {
  id: string;
  clientId: string;
  kind: 'payment' | 'reminder';
  recipient?: string;
  recipientName?: string;
  asset: 'USDC' | 'ETH';
  amount: string;
  dueAt: string; // ISO (UTC)
  timeZone: 'Europe/Zurich';
  note?: string;
  status: 'scheduled' | 'due' | 'done' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export type TxStatus = 'awaiting-otp' | 'cooling-off' | 'awaiting-approval' | 'executing' | 'executed' | 'rejected' | 'failed' | 'cancelled';

export interface TxRequest {
  id: string;
  clientId: string;
  safeAddress: string;
  safeTx: SafeTx;
  safeTxHash: string;
  summary: string; // English (legacy records: French)
  summaryFr?: string;
  warnings: string[];
  warningsFr?: string[];
  policy: PolicyResult;
  signatureK1: string;
  deviceAddress: string;
  note?: string;
  status: TxStatus;
  otp?: { code: string; expiresAt: string; verified: boolean };
  coolingOffUntil?: string;
  approval?: { by: string; at: string; decision: 'approved' | 'rejected'; note?: string };
  txHash?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecoveryStatus = 'pending-delay' | 'executing' | 'completed' | 'cancelled' | 'failed';

export interface RecoveryRequest {
  id: string;
  clientId: string;
  safeAddress: string;
  oldDevice: string;
  newDevice: string;
  safeTx: SafeTx;
  safeTxHash: string;
  signatureK3: string;
  partnerAttestationId: string;
  riskScore: number;
  newCredentialId?: string;
  status: RecoveryStatus;
  executeAfter: string;
  txHash?: string;
  error?: string;
  createdAt: string;
}

export interface InboxMessage {
  id: string;
  ts: string;
  clientId: string;
  channel: 'email' | 'sms' | 'app';
  subject: string;
  subjectFr?: string; // French twin (new records); legacy records only have a French subject/body
  body: string;
  bodyFr?: string;
  action?: { label: string; labelFr?: string; kind: 'cancel-recovery' | 'cancel-tx'; id: string };
}

export interface Db {
  clients: Record<string, Client>;
  txRequests: Record<string, TxRequest>;
  recoveries: Record<string, RecoveryRequest>;
  challenges: Record<string, { challenge: string; expiresAt: string; purpose: string }>;
  activity: ActivityEvent[];
  inbox: InboxMessage[];
  walletTxs?: Record<string, import('./walletTx').WalletTx>;
  previews?: Record<string, Preview>;
  scheduled?: Record<string, Scheduled>;
  swapQuotes?: Record<string, any>;
  documents?: Record<string, import('./walletTx').DocumentEntry>;
  /** Travel Rule decisions (rule version, threshold, rate, decision) — no personal data. */
  travelRuleAudit?: import('./travelRule').TravelRuleAudit[];
  /** Recorded portfolio snapshots per client (see snapshots.ts). */
  snapshots?: Record<string, import('./snapshots').Snapshot[]>;
  /** On-chain indexer state (#3): per-Safe block cursor, idempotency keys txHash:logIndex, pending receipts. */
  indexer?: import('./indexer').IndexerState;
  /** Unrecognised tokens received per client (#19) — never valued, never interacted with. */
  tokenSightings?: Record<string, Record<string, import('./indexer').TokenSighting>>;
}

export const db = new JsonStore<Db>(DATA_DIR, 'db', () => ({
  clients: {},
  txRequests: {},
  recoveries: {},
  challenges: {},
  activity: [],
  inbox: [],
}));

/** `message` may be a both(en, fr) pair: stored as `message` (English) + `messageFr`, localised on read. */
export function logActivity(e: Omit<ActivityEvent, 'id' | 'ts' | 'message' | 'messageFr'> & { message: string | Bilingual }) {
  const m = splitText(e.message);
  const ev: ActivityEvent = { id: newId(), ts: nowIso(), ...e, message: m.en, ...(m.fr !== m.en ? { messageFr: m.fr } : {}) };
  db.update((d) => {
    d.activity.push(ev);
    if (d.activity.length > 2000) d.activity.splice(0, d.activity.length - 2000);
  });
  console.log(`[activity] ${e.clientId} ${e.type}: ${ev.message}`);
  return ev;
}

/** MOCK notification service: email/SMS/app messages land in a "Mock Inbox" visible in the UI. */
type NotifyInput = Omit<InboxMessage, 'id' | 'ts' | 'subject' | 'subjectFr' | 'body' | 'bodyFr' | 'action'> & {
  subject: string | Bilingual;
  body: string | Bilingual;
  action?: { label: string | Bilingual; kind: 'cancel-recovery' | 'cancel-tx'; id: string };
};
/** subject/body/action label may be both(en, fr) pairs (stored with their French twin, localised on read). */
export function notify(m: NotifyInput) {
  const sub = splitText(m.subject);
  const body = splitText(m.body);
  const { action: a, subject: _s, body: _b, ...rest } = m;
  const label = a && splitText(a.label);
  const msg: InboxMessage = { id: newId(), ts: nowIso(), ...rest, subject: sub.en, subjectFr: sub.fr, body: body.en, bodyFr: body.fr, ...(a && label ? { action: { ...a, label: label.en, labelFr: label.fr } } : {}) };
  db.update((d) => {
    d.inbox.push(msg);
  });
  return msg;
}

export function getClient(clientId: string): Client {
  const c = db.data.clients[clientId];
  if (!c) throw new HttpError(404, t('Unknown client', 'Client inconnu'));
  return c;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function usageOf(c: Client) {
  if (c.usage.day !== today()) c.usage = { day: today(), spentUsdc: 0, sponsoredTx: 0 };
  return c.usage;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
