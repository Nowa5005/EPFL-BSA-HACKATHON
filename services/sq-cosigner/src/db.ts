import { JsonStore, newId, nowIso } from '@sq/shared/server';
import type { ActivityEvent, PolicyResult, SafeTx } from '@sq/shared';
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
  usage: { day: string; spentUsdc: number; sponsoredTx: number };
  privacy: 'full' | 'balance-only' | 'none';
  frozen?: boolean;
  frozenBy?: 'client' | 'compliance';
  preferences?: Preferences;
  subscription?: Subscription;
  /** Backup code (passkey alternative): only a scrypt hash is stored, never the code. */
  backupCode?: { salt: string; hash: string; createdAt: string; failed: number; lockedUntil?: string };
  /** Demo-only override of the network-fee estimate (CHF), to show a fee change during confirmation. */
  demoFeeChf?: number;
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
  fee: { available: boolean; chf: number; eth: string; gasUnits: string; demo: boolean };
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
  summary: string;
  warnings: string[];
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
  body: string;
  action?: { label: string; kind: 'cancel-recovery' | 'cancel-tx'; id: string };
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
}

export const db = new JsonStore<Db>(DATA_DIR, 'db', () => ({
  clients: {},
  txRequests: {},
  recoveries: {},
  challenges: {},
  activity: [],
  inbox: [],
}));

export function logActivity(e: Omit<ActivityEvent, 'id' | 'ts'>) {
  const ev: ActivityEvent = { id: newId(), ts: nowIso(), ...e };
  db.update((d) => {
    d.activity.push(ev);
    if (d.activity.length > 2000) d.activity.splice(0, d.activity.length - 2000);
  });
  console.log(`[activity] ${e.clientId} ${e.type}: ${e.message}`);
  return ev;
}

/** MOCK notification service: email/SMS/app messages land in a "Mock Inbox" visible in the UI. */
export function notify(m: Omit<InboxMessage, 'id' | 'ts'>) {
  const msg: InboxMessage = { id: newId(), ts: nowIso(), ...m };
  db.update((d) => {
    d.inbox.push(msg);
  });
  return msg;
}

export function getClient(clientId: string): Client {
  const c = db.data.clients[clientId];
  if (!c) throw new HttpError(404, 'Client inconnu');
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
