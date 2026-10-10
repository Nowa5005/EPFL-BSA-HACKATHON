export type Hex = `0x${string}`;

/** A Safe transaction (fields of the EIP-712 SafeTx struct). Numbers are decimal strings for JSON transport. */
export interface SafeTx {
  to: string;
  value: string;
  data: string;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string;
}

export type Level = 'standard' | 'step-up';

export interface DecodedAction {
  kind: 'eth-transfer' | 'erc20-transfer' | 'erc20-approve' | 'swap-owner' | 'contract-call';
  summary: string; // plain-language (English, or the request language when returned immediately)
  summaryFr?: string; // French twin when the action is stored (see localizeDeep)
  token?: string;
  amount?: string; // human units
  amountRaw?: string;
  recipient?: string;
  spender?: string;
  unlimited?: boolean;
  warnings: string[];
  warningsFr?: string[];
}

// Stored texts carry an optional French twin (`xFr`); services localise them on read (localizeDeep).
export interface PolicyCheck {
  id: string;
  label: string;
  labelFr?: string;
  status: 'pass' | 'fail' | 'step-up';
  detail?: string;
  detailFr?: string;
}

export interface PolicyResult {
  decision: 'approve' | 'step-up' | 'reject';
  level: Level;
  checks: PolicyCheck[];
  reasons: string[];
  reasonsFr?: string[];
}

export interface ActivityEvent {
  id: string;
  ts: string;
  clientId: string;
  actor: 'client' | 'swissquote' | 'compliance' | 'partner' | 'system' | 'attacker';
  type: string;
  message: string;
  messageFr?: string;
  txHash?: string;
  data?: Record<string, unknown>;
}
