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
  summary: string; // plain-language
  token?: string;
  amount?: string; // human units
  amountRaw?: string;
  recipient?: string;
  spender?: string;
  unlimited?: boolean;
  warnings: string[];
}

export interface PolicyCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'step-up';
  detail?: string;
}

export interface PolicyResult {
  decision: 'approve' | 'step-up' | 'reject';
  level: Level;
  checks: PolicyCheck[];
  reasons: string[];
}

export interface ActivityEvent {
  id: string;
  ts: string;
  clientId: string;
  actor: 'client' | 'swissquote' | 'compliance' | 'partner' | 'system' | 'attacker';
  type: string;
  message: string;
  txHash?: string;
  data?: Record<string, unknown>;
}
