// Safe helpers built on ethers v6 + the official Safe v1.4.1 contracts.
// No custom cryptography: hashing/signing is EIP-712 via ethers, signature
// verification is done on-chain by the audited Safe contract.

import {
  AbstractProvider,
  Contract,
  FallbackProvider,
  Interface,
  JsonRpcProvider,
  Network,
  TypedDataEncoder,
  ZeroAddress,
  getAddress,
  type Signer,
  type BaseWallet,
} from 'ethers';
import {
  CHAIN_ID,
  RPC_URLS,
  SAFE_FALLBACK_HANDLER,
  SAFE_L2_SINGLETON,
  SAFE_PROXY_FACTORY,
  SAFE_THRESHOLD,
  SENTINEL_OWNERS,
  USDC_ADDRESS,
} from './constants';
import { ERC20_ABI, SAFE_ABI, SAFE_PROXY_FACTORY_ABI } from './abis';
import type { SafeTx } from './types';

export const safeIface = new Interface(SAFE_ABI);
export const erc20Iface = new Interface(ERC20_ABI);
export const factoryIface = new Interface(SAFE_PROXY_FACTORY_ABI);

/** Provider with a public-RPC fallback (no API key needed). */
export function makeProvider(urls: string[] = RPC_URLS): AbstractProvider {
  const network = Network.from(CHAIN_ID);
  const providers = urls.map((u) => new JsonRpcProvider(u, network, { staticNetwork: network, batchMaxCount: 1 }));
  if (providers.length === 1) return providers[0];
  return new FallbackProvider(
    providers.map((provider, i) => ({ provider, priority: i + 1, stallTimeout: 4000, weight: 1 })),
    network,
    { quorum: 1 },
  );
}

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export function safeDomain(safeAddress: string) {
  return { chainId: CHAIN_ID, verifyingContract: getAddress(safeAddress) };
}

export function buildSafeTx(p: { to: string; value?: bigint | string; data?: string; nonce: bigint | string | number }): SafeTx {
  return {
    to: getAddress(p.to),
    value: (p.value ?? 0n).toString(),
    data: p.data ?? '0x',
    operation: 0, // CALL only — DELEGATECALL is never allowed by the co-signer
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZeroAddress,
    refundReceiver: ZeroAddress,
    nonce: p.nonce.toString(),
  };
}

export function safeTxHash(safeAddress: string, tx: SafeTx): string {
  return TypedDataEncoder.hash(safeDomain(safeAddress), SAFE_TX_TYPES, tx);
}

/** EIP-712 signature by one owner (65 bytes, v=27/28 → accepted by Safe as ECDSA). */
export async function signSafeTx(signer: Signer | BaseWallet, safeAddress: string, tx: SafeTx): Promise<string> {
  return signer.signTypedData(safeDomain(safeAddress), SAFE_TX_TYPES, tx);
}

/** Safe requires signatures concatenated and sorted by signer address (ascending). */
export function packSignatures(sigs: { signer: string; signature: string }[]): string {
  const sorted = [...sigs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  return '0x' + sorted.map((s) => s.signature.replace(/^0x/, '')).join('');
}

export function safeContract(address: string, runner: AbstractProvider | Signer) {
  return new Contract(address, SAFE_ABI, runner);
}

export function usdcContract(runner: AbstractProvider | Signer) {
  return new Contract(USDC_ADDRESS, ERC20_ABI, runner);
}

export function setupInitializer(owners: string[], threshold = SAFE_THRESHOLD): string {
  return safeIface.encodeFunctionData('setup', [
    owners.map((o) => getAddress(o)),
    threshold,
    ZeroAddress,
    '0x',
    SAFE_FALLBACK_HANDLER,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);
}

/** Deploys a Safe proxy (owners, threshold) — the deployer only pays gas, it gets no rights. */
export async function deploySafe(deployer: Signer, owners: string[], saltNonce: bigint) {
  const factory = new Contract(SAFE_PROXY_FACTORY, SAFE_PROXY_FACTORY_ABI, deployer);
  const initializer = setupInitializer(owners);
  const predicted: string = await factory.createProxyWithNonce.staticCall(SAFE_L2_SINGLETON, initializer, saltNonce);
  const tx = await factory.createProxyWithNonce(SAFE_L2_SINGLETON, initializer, saltNonce);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Safe deployment failed');
  return { safeAddress: getAddress(predicted), txHash: tx.hash as string };
}

export function execArgs(tx: SafeTx, signatures: string) {
  return [
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    signatures,
  ] as const;
}

/** prevOwner in Safe's owner linked list (needed by swapOwner). */
export function prevOwnerOf(owners: string[], owner: string): string {
  const i = owners.findIndex((o) => o.toLowerCase() === owner.toLowerCase());
  if (i < 0) throw new Error(`${owner} is not an owner`);
  return i === 0 ? SENTINEL_OWNERS : owners[i - 1];
}

export function swapOwnerData(owners: string[], oldOwner: string, newOwner: string): string {
  return safeIface.encodeFunctionData('swapOwner', [prevOwnerOf(owners, oldOwner), getAddress(oldOwner), getAddress(newOwner)]);
}

export function usdcTransferData(to: string, amountRaw: bigint): string {
  return erc20Iface.encodeFunctionData('transfer', [getAddress(to), amountRaw]);
}

export function explorerTx(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
export function explorerAddress(addr: string) {
  return `https://sepolia.etherscan.io/address/${addr}`;
}

// ── EIP-1271 proof of ownership (SafeMessage, CompatibilityFallbackHandler v1.4.1) ──
export const SAFE_MESSAGE_TYPES = { SafeMessage: [{ name: 'message', type: 'bytes' }] };
export const EIP1271_MAGIC = '0x1626ba7e';
export const EIP1271_ABI = ['function isValidSignature(bytes32 _dataHash, bytes _signature) view returns (bytes4)'];

export function ownershipStatement(clientId: string, safeAddress: string, ts: string) {
  return `SQ Wallet proof of ownership\nClient: ${clientId}\nWallet: ${safeAddress}\nChain: Ethereum Sepolia (11155111)\nIssued: ${ts}`;
}

/** An owner's EIP-712 signature over SafeMessage(dataHash) — combined with a 2nd owner it satisfies EIP-1271. */
export async function signSafeMessage(signer: Signer | BaseWallet, safeAddress: string, dataHash: string) {
  return signer.signTypedData(safeDomain(safeAddress), SAFE_MESSAGE_TYPES, { message: dataHash });
}
