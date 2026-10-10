// On-chain protection layer (SECURITY_GAPS_FIX §3): MyWallGuard + Zodiac Delay modules D1 / D2 (/ D3 heirs).
// Browser-safe (ethers only) — used by the co-signer, the web app, the scripts and the contract tests.
//
//   K1 + K2                    → immediate (the guard lets it through; K2 applies its off-chain policy)
//   veto (Dx.setTxNonce)       → immediate, by any 2 owners
//   any other 2 owners         → must queue in D1 (execTransactionFromModule) → runs after D1's cooldown
//   K3 alone                   → queues in D2 (K3 is D2's enabled module) → runs after D2's cooldown
// Queued transactions are executed by anyone with Dx.executeNextTx(...) once the cooldown has elapsed.
//
// Official contracts only (addresses checked on Sepolia, see docs/ONCHAIN_PROTECTION.md):
//   Zodiac Delay Modifier v1.0.1 mastercopy + ModuleProxyFactory v1.2.0 (@gnosis-guild/zodiac 5.0.1 CanonicalAddresses)
//   Safe v1.4.1 MultiSendCallOnly (@safe-global/safe-deployments)
// The only custom contract is MyWallGuard (contracts/MyWallGuard.sol — NOT AUDITED).

import {
  AbiCoder,
  Contract,
  Interface,
  ZeroAddress,
  concat,
  getAddress,
  getCreate2Address,
  keccak256,
  solidityPacked,
  type AbstractProvider,
  type Signer,
} from 'ethers';
import { SAFE_FALLBACK_HANDLER, SAFE_L2_SINGLETON, SAFE_PROXY_FACTORY, SENTINEL_OWNERS } from './constants';
import { buildSafeTx, safeIface } from './safe';
import type { SafeTx } from './types';
import { PROTECTION_DEPLOYMENT } from './protection.addresses';

// ───────────────────────────── addresses ─────────────────────────────

/** Zodiac Delay Modifier v1.0.1 mastercopy (same address on every supported chain). */
export const ZODIAC_DELAY_MASTERCOPY = '0xd54895B1121A2eE3f37b502F507631FA1331BED6';
/** Zodiac ModuleProxyFactory v1.2.0. */
export const ZODIAC_MODULE_PROXY_FACTORY = '0x000000000000aDdB49795b0f9bA5BC298cDda236';
/** Safe v1.4.1 MultiSendCallOnly — the only DELEGATECALL target MyWallGuard accepts. */
export const SAFE_MULTISEND_CALL_ONLY = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2';
/** Deployed MyWallGuard (Sepolia), written by scripts/deploy-guard.ts. Empty until deployed. */
export const MYWALL_GUARD_ADDRESS: string = PROTECTION_DEPLOYMENT.guard;

/** Official contracts the protection layer relies on (snapshotted for the offline contract tests). */
export const OFFICIAL_CONTRACTS = {
  safeL2Singleton141: SAFE_L2_SINGLETON,
  safeProxyFactory141: SAFE_PROXY_FACTORY,
  compatibilityFallbackHandler141: SAFE_FALLBACK_HANDLER,
  multiSendCallOnly141: SAFE_MULTISEND_CALL_ONLY,
  zodiacDelay101: ZODIAC_DELAY_MASTERCOPY,
  zodiacModuleProxyFactory120: ZODIAC_MODULE_PROXY_FACTORY,
} as const;

/** keccak256("guard_manager.guard.address") — Safe v1.4.1 guard storage slot. */
export const SAFE_GUARD_STORAGE_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';

// ───────────────────────────── delays ─────────────────────────────

export interface DelayParams {
  /** seconds before a queued transaction can be executed */
  cooldown: number;
  /** seconds after the cooldown during which it can be executed (then it expires) */
  expiration: number;
}
export interface ProtectionDelays {
  d1: DelayParams;
  d2: DelayParams;
  d3: DelayParams;
}
const DAY = 86_400;
/** Production values (documented; the demo uses PROTECTION_DEMO_DELAYS). */
export const PROTECTION_PROD_DELAYS: ProtectionDelays = {
  d1: { cooldown: 2 * DAY, expiration: 7 * DAY }, // 48 h — any 2 owners other than K1 + K2
  d2: { cooldown: 30 * DAY, expiration: 30 * DAY }, // 30 days — K3 alone
  d3: { cooldown: 182 * DAY, expiration: 30 * DAY }, // ~6 months — designated heir
};
/** Demo values (env-overridable in the co-signer: PROTECTION_D1_COOLDOWN_SEC, ...). */
export const PROTECTION_DEMO_DELAYS: ProtectionDelays = {
  d1: { cooldown: 120, expiration: 7 * DAY },
  d2: { cooldown: 240, expiration: 30 * DAY },
  d3: { cooldown: 300, expiration: 30 * DAY },
};

// ───────────────────────────── ABIs (minimal, official contracts) ─────────────────────────────

export const DELAY_ABI = [
  'function setUp(bytes initParams)',
  'function owner() view returns (address)',
  'function avatar() view returns (address)',
  'function target() view returns (address)',
  'function enableModule(address module)',
  'function disableModule(address prevModule, address module)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)',
  'function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation) returns (bool success)',
  'function executeNextTx(address to, uint256 value, bytes data, uint8 operation)',
  'function skipExpired()',
  'function setTxNonce(uint256 _nonce)',
  'function setTxCooldown(uint256 cooldown)',
  'function setTxExpiration(uint256 expiration)',
  'function txNonce() view returns (uint256)',
  'function queueNonce() view returns (uint256)',
  'function txCooldown() view returns (uint256)',
  'function txExpiration() view returns (uint256)',
  'function txCreatedAt(uint256) view returns (uint256)',
  'function txHash(uint256) view returns (bytes32)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation) pure returns (bytes32)',
  'event TransactionAdded(uint256 indexed queueNonce, bytes32 indexed txHash, address to, uint256 value, bytes data, uint8 operation)',
  'event DelaySetup(address indexed initiator, address indexed owner, address indexed avatar, address target)',
  'event EnabledModule(address module)',
];
export const MODULE_PROXY_FACTORY_ABI = [
  'function deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ModuleProxyCreation(address indexed proxy, address indexed masterCopy)',
];
export const MULTISEND_ABI = ['function multiSend(bytes transactions) payable'];
export const GUARD_ABI = [
  'function setConfig(address k2, address k3, address d1, address d2, address d3)',
  'function configOf(address safe) view returns (tuple(address k2, address k3, address d1, address d2, address d3))',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function multiSendCallOnly() view returns (address)',
  'event ConfigSet(address indexed safe, address k2, address k3, address d1, address d2, address d3)',
];
/** Safe v1.4.1 functions used by the protection layer (in addition to SAFE_ABI). */
export const SAFE_ADMIN_ABI = [
  'function enableModule(address module)',
  'function disableModule(address prevModule, address module)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)',
  'function setGuard(address guard)',
  'function getStorageAt(uint256 offset, uint256 length) view returns (bytes)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'event ExecutionFromModuleSuccess(address indexed module)',
  'event ExecutionFromModuleFailure(address indexed module)',
  'event EnabledModule(address indexed module)',
  'event ChangedGuard(address indexed guard)',
];

export const delayIface = new Interface(DELAY_ABI);
export const moduleFactoryIface = new Interface(MODULE_PROXY_FACTORY_ABI);
export const multiSendIface = new Interface(MULTISEND_ABI);
export const guardIface = new Interface(GUARD_ABI);
export const safeAdminIface = new Interface(SAFE_ADMIN_ABI);

/** Event signatures for indexers (topic0). */
export const PROTECTION_EVENTS = {
  /** Delay: a transaction was queued (D1 / D2 / D3). */
  TransactionAdded: delayIface.getEvent('TransactionAdded')!.topicHash,
  /** Safe: a module (Delay) executed a transaction on the wallet — no K2 co-signature at execution time. */
  ExecutionFromModuleSuccess: safeAdminIface.getEvent('ExecutionFromModuleSuccess')!.topicHash,
  ChangedGuard: safeAdminIface.getEvent('ChangedGuard')!.topicHash,
} as const;

// ───────────────────────────── MultiSend ─────────────────────────────

export interface MetaTx {
  to: string;
  value?: bigint;
  data: string;
  /** 0 = CALL. MultiSendCallOnly refuses DELEGATECALL. */
  operation?: 0;
}

/** MultiSend packed encoding: operation (uint8) · to (address) · value (uint256) · data length (uint256) · data. */
export function encodeMultiSend(txs: MetaTx[]): string {
  const packed = concat(
    txs.map((t) =>
      solidityPacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [t.operation ?? 0, getAddress(t.to), t.value ?? 0n, (t.data.length - 2) / 2, t.data]),
    ),
  );
  return multiSendIface.encodeFunctionData('multiSend', [packed]);
}

// ───────────────────────────── Delay module proxies ─────────────────────────────

export type DelayRole = 'D1' | 'D2' | 'D3';

/** Delay.setUp(abi.encode(owner, avatar, target, cooldown, expiration)) — owner, avatar and target = the Safe. */
export function delayInitializer(safe: string, p: DelayParams): string {
  const s = getAddress(safe);
  const params = AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address', 'uint256', 'uint256'], [s, s, s, p.cooldown, p.expiration]);
  return delayIface.encodeFunctionData('setUp', [params]);
}

/** Deterministic salt per Safe and role (D3: also per heir). */
export function delaySaltNonce(safe: string, role: DelayRole, extra: string = ZeroAddress): bigint {
  return BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'address', 'address'], [`MyWall/${role}/v1`, getAddress(safe), getAddress(extra)])));
}

/** CREATE2 address of a ModuleProxyFactory v1.2.0 proxy (EIP-1167 minimal proxy). */
export function predictModuleProxy(initializer: string, saltNonce: bigint, mastercopy = ZODIAC_DELAY_MASTERCOPY, factory = ZODIAC_MODULE_PROXY_FACTORY): string {
  const initCode = concat(['0x602d8060093d393df3363d3d373d3d3d363d73', getAddress(mastercopy), '0x5af43d82803e903d91602b57fd5bf3']);
  const salt = keccak256(solidityPacked(['bytes32', 'uint256'], [keccak256(initializer), saltNonce]));
  return getCreate2Address(factory, salt, keccak256(initCode));
}

export interface DelayModulePlan {
  role: DelayRole;
  address: string;
  initializer: string;
  saltNonce: bigint;
  params: DelayParams;
  /** who may queue in it: D1 → the Safe, D2 → K3, D3 → the heir */
  queuer: string;
}

export function planDelay(safe: string, role: DelayRole, params: DelayParams, queuer: string): DelayModulePlan {
  const initializer = delayInitializer(safe, params);
  const saltNonce = delaySaltNonce(safe, role, role === 'D3' ? queuer : ZeroAddress);
  return { role, address: predictModuleProxy(initializer, saltNonce), initializer, saltNonce, params, queuer: getAddress(queuer) };
}

/** Calls (from the Safe, inside MultiSendCallOnly) that deploy, configure and enable one Delay module. */
function delayCalls(safe: string, m: DelayModulePlan, alreadyDeployed: boolean): MetaTx[] {
  const calls: MetaTx[] = [];
  if (!alreadyDeployed)
    calls.push({ to: ZODIAC_MODULE_PROXY_FACTORY, data: moduleFactoryIface.encodeFunctionData('deployModule', [ZODIAC_DELAY_MASTERCOPY, m.initializer, m.saltNonce]) });
  calls.push({ to: m.address, data: delayIface.encodeFunctionData('enableModule', [m.queuer]) }); // who may queue
  calls.push({ to: getAddress(safe), data: safeAdminIface.encodeFunctionData('enableModule', [m.address]) }); // Delay may execute on the Safe
  return calls;
}

// ───────────────────────────── K1 + K2 setup batch ─────────────────────────────

export interface ProtectionSetupInput {
  safe: string;
  k2: string;
  k3: string;
  guard: string;
  delays: ProtectionDelays;
  /** optional designated heir → D3 (Phase C) */
  heir?: string;
  /** proxies already deployed (e.g. by a third party with the same initializer): skip their deployModule */
  deployed?: Partial<Record<DelayRole, boolean>>;
}

export interface ProtectionSetupPlan {
  safe: string;
  guard: string;
  k2: string;
  k3: string;
  d1: DelayModulePlan;
  d2: DelayModulePlan;
  d3?: DelayModulePlan;
  calls: MetaTx[];
  /** MultiSendCallOnly calldata */
  data: string;
}

/** Builds the canonical K1 + K2 setup batch (deploy D1/D2[/D3], enable modules, configure the guard, setGuard). */
export function planProtectionSetup(p: ProtectionSetupInput): ProtectionSetupPlan {
  const safe = getAddress(p.safe);
  const d1 = planDelay(safe, 'D1', p.delays.d1, safe);
  const d2 = planDelay(safe, 'D2', p.delays.d2, p.k3);
  const d3 = p.heir ? planDelay(safe, 'D3', p.delays.d3, p.heir) : undefined;
  const calls: MetaTx[] = [
    ...delayCalls(safe, d1, !!p.deployed?.D1),
    ...delayCalls(safe, d2, !!p.deployed?.D2),
    ...(d3 ? delayCalls(safe, d3, !!p.deployed?.D3) : []),
    // configuration BEFORE setGuard (an unconfigured guard refuses everything)
    { to: getAddress(p.guard), data: guardIface.encodeFunctionData('setConfig', [getAddress(p.k2), getAddress(p.k3), d1.address, d2.address, d3?.address ?? ZeroAddress]) },
    { to: safe, data: safeAdminIface.encodeFunctionData('setGuard', [getAddress(p.guard)]) },
  ];
  return { safe, guard: getAddress(p.guard), k2: getAddress(p.k2), k3: getAddress(p.k3), d1, d2, d3, calls, data: encodeMultiSend(calls) };
}

/** Later addition of the heir module D3 to an already protected Safe (K1 + K2 batch, Phase C). */
export function planHeirModule(p: { safe: string; k2: string; k3: string; guard: string; d1: string; d2: string; heir: string; params: DelayParams; deployed?: boolean }) {
  const safe = getAddress(p.safe);
  const d3 = planDelay(safe, 'D3', p.params, p.heir);
  const calls: MetaTx[] = [
    ...delayCalls(safe, d3, !!p.deployed),
    { to: getAddress(p.guard), data: guardIface.encodeFunctionData('setConfig', [getAddress(p.k2), getAddress(p.k3), getAddress(p.d1), getAddress(p.d2), d3.address]) },
  ];
  return { d3, calls, data: encodeMultiSend(calls) };
}

/** The SafeTx K1 and K2 sign for a batch: DELEGATECALL to the official MultiSendCallOnly, no refund. */
export function batchSafeTx(data: string, nonce: bigint | string | number): SafeTx {
  return { ...buildSafeTx({ to: SAFE_MULTISEND_CALL_ONLY, data, nonce }), operation: 1 };
}

// ───────────────────────────── queue / veto / execute ─────────────────────────────

export interface InnerTx {
  to: string;
  value?: bigint | string;
  data?: string;
  /** 0 = CALL (default), 1 = DELEGATECALL */
  operation?: 0 | 1;
}
const innerArgs = (t: InnerTx) => [getAddress(t.to), BigInt(t.value ?? 0), t.data ?? '0x', t.operation ?? 0] as const;

/** Delay.execTransactionFromModule(inner) — queues `inner` (called by the Safe for D1, by K3 for D2, by the heir for D3). */
export function queueData(inner: InnerTx): string {
  return delayIface.encodeFunctionData('execTransactionFromModule', innerArgs(inner));
}
/** SafeTx (signed by any 2 owners) that queues `inner` in D1. */
export function queueInD1SafeTx(d1: string, inner: InnerTx, safeNonce: bigint | string | number): SafeTx {
  return buildSafeTx({ to: d1, data: queueData(inner), nonce: safeNonce });
}
/** Delay.setTxNonce(n) — skips (vetoes) every pending transaction with queue index < n. */
export function vetoData(newTxNonce: bigint | number): string {
  return delayIface.encodeFunctionData('setTxNonce', [newTxNonce]);
}
/** SafeTx (signed by any 2 owners, immediate) that vetoes pending transactions of a Delay module up to index n-1. */
export function vetoSafeTx(delay: string, newTxNonce: bigint | number, safeNonce: bigint | string | number): SafeTx {
  return buildSafeTx({ to: delay, data: vetoData(newTxNonce), nonce: safeNonce });
}
/** Delay.executeNextTx(inner) — anyone can call it once the cooldown is over (pays the gas). */
export function executeNextData(inner: InnerTx): string {
  return delayIface.encodeFunctionData('executeNextTx', innerArgs(inner));
}
export function delayTxHash(inner: InnerTx): string {
  const [to, value, data, op] = innerArgs(inner);
  // Delay.getTransactionHash = keccak256(abi.encodePacked(to, value, data, operation))
  return keccak256(solidityPacked(['address', 'uint256', 'bytes', 'uint8'], [to, value, data, op]));
}
/** Recovery: swapOwner(K1 → K1′) queued in D1 (signed K3 + K2). */
export function recoveryQueueSafeTx(safe: string, d1: string, owners: string[], oldDevice: string, newDevice: string, safeNonce: bigint | string | number): { safeTx: SafeTx; inner: InnerTx } {
  const i = owners.findIndex((o) => o.toLowerCase() === oldDevice.toLowerCase());
  if (i < 0) throw new Error(`${oldDevice} is not an owner`);
  const prev = i === 0 ? SENTINEL_OWNERS : owners[i - 1];
  const inner: InnerTx = { to: getAddress(safe), value: 0n, data: safeIface.encodeFunctionData('swapOwner', [prev, getAddress(oldDevice), getAddress(newDevice)]), operation: 0 };
  return { safeTx: queueInD1SafeTx(d1, inner, safeNonce), inner };
}

/** Sends Delay.execTransactionFromModule directly (K3 → D2, heir → D3): needs ETH on the sender for gas. */
export async function queueDirect(sender: Signer, delay: string, inner: InnerTx) {
  return new Contract(delay, DELAY_ABI, sender).execTransactionFromModule(...innerArgs(inner));
}
export async function executeNext(sender: Signer, delay: string, inner: InnerTx) {
  return new Contract(delay, DELAY_ABI, sender).executeNextTx(...innerArgs(inner));
}

// ───────────────────────────── reading the on-chain state ─────────────────────────────

export interface PendingDelayTx {
  index: number;
  hash: string;
  createdAt: number; // unix s
  executableAt: number;
  expiresAt: number | null;
  status: 'cooldown' | 'executable' | 'expired';
  /** decoded from the TransactionAdded event when found */
  tx?: { to: string; value: string; data: string; operation: number };
}
export interface DelayQueueState {
  address: string;
  txNonce: number;
  queueNonce: number;
  cooldown: number;
  expiration: number;
  pending: PendingDelayTx[];
}

/** Reads txNonce / queueNonce / cooldown / pending items (and, with `withTxs`, the queued calls from the events). */
export async function readDelayQueue(provider: AbstractProvider, delay: string, opts: { withTxs?: boolean; fromBlock?: number; now?: number } = {}): Promise<DelayQueueState> {
  const d = new Contract(delay, DELAY_ABI, provider);
  const [txNonce, queueNonce, cooldown, expiration] = (await Promise.all([d.txNonce(), d.queueNonce(), d.txCooldown(), d.txExpiration()])).map(Number);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const pending: PendingDelayTx[] = [];
  for (let i = txNonce; i < queueNonce && pending.length < 20; i++) {
    const [createdAt, hash] = await Promise.all([d.txCreatedAt(i).then(Number), d.txHash(i) as Promise<string>]);
    const executableAt = createdAt + cooldown;
    const expiresAt = expiration ? executableAt + expiration : null;
    pending.push({ index: i, hash, createdAt, executableAt, expiresAt, status: expiresAt !== null && now > expiresAt ? 'expired' : now >= executableAt ? 'executable' : 'cooldown' });
  }
  if (opts.withTxs && pending.length) {
    const logs = await provider.getLogs({ address: delay, topics: [PROTECTION_EVENTS.TransactionAdded], fromBlock: opts.fromBlock ?? 0, toBlock: 'latest' }).catch(() => []);
    for (const l of logs) {
      const ev = delayIface.parseLog(l);
      if (!ev) continue;
      const p = pending.find((x) => x.index === Number(ev.args.queueNonce));
      if (p) p.tx = { to: getAddress(ev.args.to), value: ev.args.value.toString(), data: ev.args.data, operation: Number(ev.args.operation) };
    }
  }
  return { address: getAddress(delay), txNonce, queueNonce, cooldown, expiration, pending };
}

export interface ProtectionState {
  protected: boolean;
  guard: string | null;
  modules: string[];
  config: { k2: string; k3: string; d1: string; d2: string; d3: string | null } | null;
}

/** Guard + modules + guard configuration of a Safe. */
export async function readProtection(provider: AbstractProvider, safe: string, guardAddress = MYWALL_GUARD_ADDRESS): Promise<ProtectionState> {
  const s = new Contract(safe, SAFE_ADMIN_ABI, provider);
  const [slot, mods] = await Promise.all([
    s.getStorageAt(BigInt(SAFE_GUARD_STORAGE_SLOT), 1) as Promise<string>,
    s.getModulesPaginated(SENTINEL_OWNERS, 10) as Promise<[string[], string]>,
  ]);
  const guard = slot && BigInt(slot) !== 0n ? getAddress('0x' + slot.slice(-40)) : null;
  let config: ProtectionState['config'] = null;
  if (guard && guardAddress && guard.toLowerCase() === guardAddress.toLowerCase()) {
    const c = await new Contract(guard, GUARD_ABI, provider).configOf(safe);
    if (c.k2 !== ZeroAddress) config = { k2: getAddress(c.k2), k3: getAddress(c.k3), d1: getAddress(c.d1), d2: getAddress(c.d2), d3: c.d3 === ZeroAddress ? null : getAddress(c.d3) };
  }
  return { protected: !!config, guard, modules: [...mods[0]].map((m) => getAddress(m)), config };
}
