// Independent validation of a Safe transaction by the co-signer. The co-signer never trusts the summary sent by
// the client: it decodes the calldata itself, accepts only the operations it understands, and checks that the
// calldata is EXACTLY the canonical encoding of what it decoded (no trailing bytes, no alternative forms).

import { ZeroAddress, getAddress, isAddress } from 'ethers';
import { TOKEN_SELECTORS, USDC_ADDRESS, erc20Iface, safeIface, type SafeTx } from '@sq/shared';
import { SAFE_MULTISEND_CALL_ONLY, delayIface } from '@sq/shared/protection';
import { t } from '@sq/shared/server';
import { HttpError } from './db';

export type Intent =
  | { kind: 'eth-transfer'; to: string; value: string }
  | { kind: 'erc20-transfer'; token: string; to: string; amountRaw: string }
  | { kind: 'erc20-approve'; token: string; spender: string; amountRaw: string }
  | { kind: 'swap-owner'; prevOwner: string; oldOwner: string; newOwner: string };

/** Tokens the co-signer accepts to move or approve. */
export const SUPPORTED_TOKENS: Record<string, string> = { [USDC_ADDRESS.toLowerCase()]: 'USDC' };

const bad = (en: string, fr: string) => new HttpError(400, t(`Transaction refused by the co-signer: ${en}`, `Transaction refusée par le co-signataire : ${fr}`));
const isUint = (s: unknown) => typeof s === 'string' && /^\d{1,78}$/.test(s);

/** Canonical form used to compare two SafeTx byte-for-byte. */
export function canonicalSafeTx(tx: SafeTx): SafeTx {
  if (!tx || typeof tx !== 'object') throw bad('invalid format', 'format invalide');
  for (const k of ['value', 'safeTxGas', 'baseGas', 'gasPrice', 'nonce'] as const) if (!isUint(tx[k])) throw bad(`invalid field ${k}`, `champ ${k} invalide`);
  if (!isAddress(tx.to) || !isAddress(tx.gasToken) || !isAddress(tx.refundReceiver)) throw bad('invalid address', 'adresse invalide');
  if (typeof tx.data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(tx.data)) throw bad('invalid data', 'données invalides');
  return {
    to: getAddress(tx.to),
    value: BigInt(tx.value).toString(),
    data: tx.data.toLowerCase(),
    operation: tx.operation,
    safeTxGas: BigInt(tx.safeTxGas).toString(),
    baseGas: BigInt(tx.baseGas).toString(),
    gasPrice: BigInt(tx.gasPrice).toString(),
    gasToken: getAddress(tx.gasToken),
    refundReceiver: getAddress(tx.refundReceiver),
    nonce: BigInt(tx.nonce).toString(),
  };
}

export function sameSafeTx(a: SafeTx, b: SafeTx) {
  return JSON.stringify(canonicalSafeTx(a)) === JSON.stringify(canonicalSafeTx(b));
}

/**
 * Decodes and validates. Throws on anything not explicitly supported:
 * ETH transfer (no calldata), ERC-20 transfer / approve on a supported token, and swapOwner on the
 * wallet itself (recovery route only).
 */
export function validateSafeTx(raw: SafeTx, safeAddress: string, opts: { allowOwnerChange?: boolean } = {}): Intent {
  const tx = canonicalSafeTx(raw);
  // Sensitive parameters: a plain CALL, no gas refund that could pay someone out of the wallet.
  if (tx.operation !== 0) throw bad('DELEGATECALL forbidden', 'DELEGATECALL interdit');
  if (tx.safeTxGas !== '0' || tx.baseGas !== '0' || tx.gasPrice !== '0' || tx.gasToken !== ZeroAddress || tx.refundReceiver !== ZeroAddress)
    throw bad('gas refund parameters not allowed', 'paramètres de remboursement de gas non autorisés');

  if (tx.data === '0x') {
    if (getAddress(tx.to) === getAddress(safeAddress)) throw bad('transfer to the wallet itself', 'transfert vers le wallet lui-même');
    return { kind: 'eth-transfer', to: tx.to, value: tx.value };
  }

  const selector = tx.data.slice(0, 10);
  const token = SUPPORTED_TOKENS[tx.to.toLowerCase()];
  if (token) {
    if (tx.value !== '0') throw bad('ETH attached to a token call', 'ETH joint à un appel de jeton');
    const fn = erc20Iface.getFunction(selector);
    if (fn?.name === 'transfer' || fn?.name === 'approve') {
      const args = erc20Iface.decodeFunctionData(fn, tx.data);
      // re-encode: refuses any extra or malformed bytes in the calldata
      if (erc20Iface.encodeFunctionData(fn, [args[0], args[1]]).toLowerCase() !== tx.data) throw bad('non-canonical calldata', 'calldata non canonique');
      const who = getAddress(args[0]);
      const amountRaw = (args[1] as bigint).toString();
      if (fn.name === 'transfer') {
        if (who === ZeroAddress) throw bad('zero recipient', 'destinataire nul');
        return { kind: 'erc20-transfer', token: tx.to, to: who, amountRaw };
      }
      if (who === ZeroAddress) throw bad('zero approval spender', 'bénéficiaire d’autorisation nul');
      return { kind: 'erc20-approve', token: tx.to, spender: who, amountRaw };
    }
    throw bad(`unsupported token function (${selector})`, `fonction de jeton non prise en charge (${selector})`);
  }

  if (getAddress(tx.to) === getAddress(safeAddress)) {
    if (!opts.allowOwnerChange) throw bad('key changes only go through the recovery procedure', 'les changements de clés passent uniquement par la procédure de récupération');
    if (tx.value !== '0') throw bad('ETH attached to a key change', 'ETH joint à un changement de clé');
    const fn = safeIface.getFunction(selector);
    if (fn?.name !== 'swapOwner') throw bad('only a key replacement (swapOwner) is accepted', 'seul le remplacement de clé (swapOwner) est accepté');
    const args = safeIface.decodeFunctionData(fn, tx.data);
    if (safeIface.encodeFunctionData(fn, [args[0], args[1], args[2]]).toLowerCase() !== tx.data) throw bad('non-canonical calldata', 'calldata non canonique');
    return { kind: 'swap-owner', prevOwner: getAddress(args[0]), oldOwner: getAddress(args[1]), newOwner: getAddress(args[2]) };
  }

  // #19 — a token-style call (transfer, approve, permit…) on a contract outside the whitelist: an unrecognised token.
  if (TOKEN_SELECTORS[selector])
    throw bad(
      `unrecognised token (${tx.to.slice(0, 6)}…${tx.to.slice(-4)}): Swissquote never co-signs a transfer, approval or call on a token outside its list. Unknown tokens are often scams — leave them untouched.`,
      `jeton non reconnu (${tx.to.slice(0, 6)}…${tx.to.slice(-4)}) : Swissquote ne co-signe jamais de transfert, d’autorisation ni d’appel sur un jeton hors de sa liste. Les jetons inconnus sont souvent des arnaques — n’y touchez pas.`,
    );
  throw bad('unrecognised operation (unsupported contract or function)', 'opération non reconnue (contrat ou fonction non pris en charge)');
}

// ───────────────────────────── On-chain protection (MyWallGuard + Zodiac Delay) ─────────────────────────────
// Each route below accepts exactly ONE canonical shape and nothing broader; the general route (validateSafeTx)
// still refuses every call to the Safe itself, to a Delay module or to the guard.

const noRefund = (tx: SafeTx) =>
  tx.safeTxGas === '0' && tx.baseGas === '0' && tx.gasPrice === '0' && tx.gasToken === ZeroAddress && tx.refundReceiver === ZeroAddress;

/** K1 + K2 setup / admin batch: byte-for-byte the batch the co-signer built itself (DELEGATECALL to MultiSendCallOnly). */
export function validateProtectionBatch(raw: SafeTx, expectedData: string) {
  const tx = canonicalSafeTx(raw);
  if (tx.operation !== 1 || getAddress(tx.to) !== getAddress(SAFE_MULTISEND_CALL_ONLY)) throw bad('a protection batch must be a DELEGATECALL to MultiSendCallOnly', 'un lot de protection doit être un DELEGATECALL vers MultiSendCallOnly');
  if (tx.value !== '0' || !noRefund(tx)) throw bad('no ETH and no gas refund in a protection batch', 'ni ETH ni remboursement de gas dans un lot de protection');
  if (tx.data !== expectedData.toLowerCase()) throw bad('the protection batch differs from the canonical one', 'le lot de protection diffère du lot canonique');
}

/** Veto: Delay.setTxNonce(n) on one of this wallet's own Delay modules, plain CALL. */
export function validateVeto(raw: SafeTx, delays: string[]): { delay: string; newTxNonce: bigint } {
  const tx = canonicalSafeTx(raw);
  if (tx.operation !== 0 || tx.value !== '0' || !noRefund(tx)) throw bad('a veto is a plain call without ETH', 'un veto est un simple appel sans ETH');
  if (!delays.some((d) => getAddress(d) === getAddress(tx.to))) throw bad('not one of this wallet’s delay modules', 'pas un module de délai de ce wallet');
  const fn = delayIface.getFunction('setTxNonce')!;
  if (tx.data.slice(0, 10) !== fn.selector) throw bad('a veto must call setTxNonce', 'un veto doit appeler setTxNonce');
  const [n] = delayIface.decodeFunctionData(fn, tx.data);
  if (delayIface.encodeFunctionData(fn, [n]).toLowerCase() !== tx.data) throw bad('non-canonical calldata', 'calldata non canonique');
  return { delay: getAddress(tx.to), newTxNonce: n as bigint };
}

/** Device recovery on a protected wallet: D1.execTransactionFromModule(Safe, 0, swapOwner(...), CALL). */
export function validateRecoveryQueue(raw: SafeTx, safeAddress: string, d1: string): Extract<Intent, { kind: 'swap-owner' }> {
  const tx = canonicalSafeTx(raw);
  if (getAddress(tx.to) !== getAddress(d1)) throw bad('the recovery must be queued in the wallet’s delay module D1', 'la récupération doit être mise en file dans le module de délai D1 du wallet');
  if (tx.operation !== 0 || tx.value !== '0' || !noRefund(tx)) throw bad('a queued recovery is a plain call without ETH', 'une récupération en file est un simple appel sans ETH');
  const fn = delayIface.getFunction('execTransactionFromModule')!;
  if (tx.data.slice(0, 10) !== fn.selector) throw bad('the recovery must queue a transaction', 'la récupération doit mettre une transaction en file');
  const [to, value, data, operation] = delayIface.decodeFunctionData(fn, tx.data);
  if (delayIface.encodeFunctionData(fn, [to, value, data, operation]).toLowerCase() !== tx.data) throw bad('non-canonical calldata', 'calldata non canonique');
  if (getAddress(to) !== getAddress(safeAddress) || value !== 0n || Number(operation) !== 0) throw bad('the queued recovery must be a key replacement on the wallet itself', 'la récupération en file doit être un remplacement de clé sur le wallet lui-même');
  const inner = validateSafeTx({ ...tx, to: getAddress(safeAddress), data: String(data).toLowerCase() }, safeAddress, { allowOwnerChange: true });
  if (inner.kind !== 'swap-owner') throw bad('only a key replacement (swapOwner) is accepted', 'seul le remplacement de clé (swapOwner) est accepté');
  return inner;
}
