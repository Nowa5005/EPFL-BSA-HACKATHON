// #20 (part D) / #23 — same Safe address on another EVM chain.
//
// A Safe proxy address is CREATE2(factory, keccak256(keccak256(initializer) ‖ saltNonce), keccak256(proxyCreationCode ‖ singleton)).
// None of these inputs depends on the chain as long as:
//   • the canonical Safe v1.4.1 ProxyFactory / SafeL2 singleton / fallback handler exist at the same addresses
//     on the target chain (they do on Base Sepolia, Arbitrum Sepolia, OP Sepolia — @safe-global/safe-deployments);
//   • the initializer is chain-independent: setup(owners, threshold, to = 0, data = 0x, canonical fallback handler,
//     no payment). My Wall never puts modules or the guard in `setup` — the protection layer (MyWallGuard + Zodiac
//     Delay D1/D2/D3) is added AFTER deployment by a K1 + K2 transaction (packages/shared/src/protection.ts).
// So the same wallet can be redeployed at the same address on another EVM chain to recover funds sent there by
// mistake (scripts/redeploy-safe.ts). Browser-safe (ethers only).

import { Interface, ZeroAddress, concat, getAddress, getCreate2Address, keccak256, solidityPacked, zeroPadValue } from 'ethers';
import { SAFE_ABI, SAFE_PROXY_FACTORY_ABI } from './abis';
import { SAFE_FALLBACK_HANDLER, SAFE_L2_SINGLETON, SAFE_PROXY_FACTORY } from './constants';

export interface EvmChainInfo {
  chainId: number;
  name: string;
  rpcUrls: string[];
  explorer: string;
  /** true only for the chain the prototype actually operates on */
  active: boolean;
}

/** Public RPCs (no API key). Only Ethereum Sepolia is active in this prototype; the others are redeploy targets. */
export const EVM_CHAINS: Record<number, EvmChainInfo> = {
  11155111: { chainId: 11155111, name: 'Ethereum Sepolia', rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org'], explorer: 'https://sepolia.etherscan.io', active: true },
  84532: { chainId: 84532, name: 'Base Sepolia', rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'], explorer: 'https://sepolia.basescan.org', active: false },
  421614: { chainId: 421614, name: 'Arbitrum Sepolia', rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'], explorer: 'https://sepolia.arbiscan.io', active: false },
  11155420: { chainId: 11155420, name: 'OP Sepolia', rpcUrls: ['https://sepolia.optimism.io', 'https://optimism-sepolia-rpc.publicnode.com'], explorer: 'https://sepolia-optimism.etherscan.io', active: false },
};

const safeIface = new Interface(SAFE_ABI);
const factoryIface = new Interface(SAFE_PROXY_FACTORY_ABI);

/** The 4 inputs that fully determine a Safe proxy address (together with the factory's proxy creation code). */
export interface SafeDeploymentParams {
  factory: string;
  singleton: string;
  initializer: string;
  saltNonce: bigint;
}

/** Decodes the original deployment transaction (factory.createProxyWithNonce) — e.g. the co-signer's `deployTxHash`. */
export function decodeSafeDeploymentTx(tx: { to: string | null; data: string }): SafeDeploymentParams {
  if (!tx.to) throw new Error('Not a factory call (contract creation)');
  const parsed = factoryIface.parseTransaction({ data: tx.data });
  if (!parsed || parsed.name !== 'createProxyWithNonce') throw new Error('Not a createProxyWithNonce call');
  return { factory: getAddress(tx.to), singleton: getAddress(parsed.args[0]), initializer: parsed.args[1] as string, saltNonce: BigInt(parsed.args[2]) };
}

export interface DecodedSetup {
  owners: string[];
  threshold: number;
  to: string;
  data: string;
  fallbackHandler: string;
  paymentToken: string;
  payment: bigint;
  paymentReceiver: string;
}

export function decodeSetupInitializer(initializer: string): DecodedSetup {
  const p = safeIface.parseTransaction({ data: initializer });
  if (!p || p.name !== 'setup') throw new Error('Initializer is not Safe.setup(...)');
  return {
    owners: (p.args[0] as string[]).map((o) => getAddress(o)),
    threshold: Number(p.args[1]),
    to: getAddress(p.args[2]),
    data: p.args[3] as string,
    fallbackHandler: getAddress(p.args[4]),
    paymentToken: getAddress(p.args[5]),
    payment: BigInt(p.args[6]),
    paymentReceiver: getAddress(p.args[7]),
  };
}

/**
 * Checks that a deployment can be replayed on any chain where the canonical Safe v1.4.1 contracts exist.
 * Returns the list of problems (empty = chain-independent).
 */
export function chainIndependenceIssues(d: SafeDeploymentParams): string[] {
  const issues: string[] = [];
  if (getAddress(d.factory) !== getAddress(SAFE_PROXY_FACTORY)) issues.push(`factory ${d.factory} is not the canonical Safe v1.4.1 ProxyFactory`);
  if (getAddress(d.singleton) !== getAddress(SAFE_L2_SINGLETON)) issues.push(`singleton ${d.singleton} is not the canonical SafeL2 v1.4.1`);
  const s = decodeSetupInitializer(d.initializer);
  if (s.to !== ZeroAddress || s.data !== '0x') issues.push('setup() runs a delegatecall (modules/guard in the initializer) — chain-specific');
  if (s.fallbackHandler !== getAddress(SAFE_FALLBACK_HANDLER)) issues.push(`fallback handler ${s.fallbackHandler} is not the canonical CompatibilityFallbackHandler v1.4.1`);
  if (s.paymentToken !== ZeroAddress || s.payment !== 0n || s.paymentReceiver !== ZeroAddress) issues.push('setup() pays a refund (token/amount are chain-specific)');
  return issues;
}

/** CREATE2 address of a Safe v1.4.1 proxy, computed offline (same formula as SafeProxyFactory.createProxyWithNonce). */
export function predictSafeProxyAddress(d: SafeDeploymentParams, proxyCreationCode: string): string {
  const salt = keccak256(solidityPacked(['bytes32', 'uint256'], [keccak256(d.initializer), d.saltNonce]));
  const initCode = concat([proxyCreationCode, zeroPadValue(getAddress(d.singleton), 32)]);
  return getCreate2Address(d.factory, salt, keccak256(initCode));
}

/** Calldata of the redeploy transaction (anyone can send it; the sender only pays gas and gets no rights). */
export function redeployCalldata(d: SafeDeploymentParams): string {
  return factoryIface.encodeFunctionData('createProxyWithNonce', [d.singleton, d.initializer, d.saltNonce]);
}

