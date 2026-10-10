// On-chain side of the co-signer: balance checks, simulation, K2 signature, sponsored execution (relayer).

import { NonceManager, getAddress, verifyTypedData, type TransactionReceipt } from 'ethers';
import {
  POLICY,
  RPC_URLS,
  SAFE_TX_TYPES,
  type SafeTx,
  execArgs,
  makeProvider,
  packSignatures,
  safeContract,
  safeDomain,
  safeTxHash,
  signSafeTx,
  usdcContract,
} from '@sq/shared';
import { cosignerWallet, relayerWallet } from './keys';

const rpcs = process.env.SEPOLIA_RPC_URLS ? process.env.SEPOLIA_RPC_URLS.split(',') : RPC_URLS;
export const provider = makeProvider(rpcs);
export const relayer = new NonceManager(relayerWallet().connect(provider));
export const relayerAddress = relayerWallet().address;

// Serialize relayer submissions (one nonce sequence).
let queue: Promise<unknown> = Promise.resolve();
// If the relayer key was used elsewhere (ops scripts, another instance), the cached nonce is stale:
// resync from the chain and retry once.
const isNonceError = (e: any) => e?.code === 'NONCE_EXPIRED' || e?.code === 'REPLACEMENT_UNDERPRICED' || /nonce too low|already known/i.test(String(e?.message ?? e?.info?.error?.message));
async function withNonceRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isNonceError(e)) throw e;
    console.warn('[relayer] stale nonce — resyncing from chain and retrying');
    relayer.reset();
    return fn();
  }
}

export function relayerTask<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withNonceRetry(fn);
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

export async function balancesOf(address: string) {
  const [eth, usdc] = await Promise.all([provider.getBalance(address), usdcContract(provider).balanceOf(address) as Promise<bigint>]);
  return { eth, usdc };
}

export async function safeState(safeAddress: string) {
  const safe = safeContract(safeAddress, provider);
  const [owners, threshold, nonce] = await Promise.all([
    safe.getOwners() as Promise<string[]>,
    safe.getThreshold() as Promise<bigint>,
    safe.nonce() as Promise<bigint>,
  ]);
  return { owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), nonce };
}

/** Hash computed locally (EIP-712) and cross-checked against the Safe contract itself. */
export async function checkedSafeTxHash(safeAddress: string, tx: SafeTx) {
  const local = safeTxHash(safeAddress, tx);
  const onchain: string = await safeContract(safeAddress, provider).getTransactionHash(
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    tx.nonce,
  );
  if (local.toLowerCase() !== onchain.toLowerCase()) throw new Error('Safe tx hash mismatch');
  return local;
}

export function recoverSigner(safeAddress: string, tx: SafeTx, signature: string) {
  return getAddress(verifyTypedData(safeDomain(safeAddress), SAFE_TX_TYPES, tx, signature));
}

/** Simulates the inner call as if sent by the Safe (eth_call). */
export async function simulateInner(safeAddress: string, tx: SafeTx) {
  try {
    await provider.call({ from: safeAddress, to: tx.to, data: tx.data, value: BigInt(tx.value) });
    return { success: true as const };
  } catch (e) {
    return { success: false as const, error: shortErr(e) };
  }
}

/** K2 co-signs, the relayer submits execTransaction and pays the gas. */
export async function cosignAndExecute(clientId: string, safeAddress: string, tx: SafeTx, otherSig: { signer: string; signature: string }) {
  const k2 = cosignerWallet(clientId);
  const sigK2 = await signSafeTx(k2, safeAddress, tx);
  const signatures = packSignatures([otherSig, { signer: k2.address, signature: sigK2 }]);
  const safe = safeContract(safeAddress, relayer);
  return relayerTask(async () => {
    const est: bigint = await safe.execTransaction.estimateGas(...execArgs(tx, signatures));
    const gasLimit = (est * 13n) / 10n;
    if (gasLimit > BigInt(POLICY.maxSponsoredGas)) throw new Error(`Gas ${gasLimit} above sponsoring cap`);
    const sent = await safe.execTransaction(...execArgs(tx, signatures), { gasLimit });
    const receipt: TransactionReceipt | null = await sent.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');
    const failure = receipt.logs.some((l) => {
      try {
        return safe.interface.parseLog(l)?.name === 'ExecutionFailure';
      } catch {
        return false;
      }
    });
    if (failure) throw new Error('Safe reported ExecutionFailure');
    return { txHash: sent.hash as string, gasUsed: receipt.gasUsed.toString() };
  });
}

export function shortErr(e: unknown): string {
  const any = e as { shortMessage?: string; reason?: string; message?: string; code?: string };
  const msg = any?.shortMessage ?? any?.reason ?? any?.message ?? String(e);
  if (any?.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(msg))
    return `Swissquote's gas relayer (${relayerAddress}) has no Sepolia ETH left — it must be refilled from a faucet.`;
  return msg;
}
