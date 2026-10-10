// N2 — "Replace my recovery kit": the recovery key K3 is rotated to K3′ by K1 + K2, on an in-process Hardhat network
// with the OFFICIAL bytecode (same harness as guard.test.ts). On a protected wallet the rotation MUST be one batch
// (swapOwner + guard.setConfig + D2 module swap): proven here, including the counter-example (swap alone → K3′ + K2
// would be treated as "device + Swissquote" and pass immediately).
//   npm run test:contracts
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BrowserProvider,
  Interface,
  Contract,
  ContractFactory,
  Wallet,
  getAddress,
  getBytes,
  keccak256,
  parseEther,
  solidityPacked,
  zeroPadValue,
  type BaseWallet,
} from 'ethers';
import { buildRecoveryKeyRotation, MODULE_SENTINEL } from '../../services/sq-cosigner/src/recoveryRotation';
import { SAFE_ABI, deploySafe, execArgs, packSignatures, safeTxHash, signSafeTx, buildSafeTx, swapOwnerData, type SafeTx } from '@sq/shared';
import {
  DELAY_ABI,
  SAFE_ADMIN_ABI,
  SAFE_MULTISEND_CALL_ONLY,
  batchSafeTx,
  delayIface,
  delayTxHash,
  encodeMultiSend,
  guardIface,
  planProtectionSetup,
  queueData,
  queueInD1SafeTx,
  readDelayQueue,
  readProtection,
  recoveryQueueSafeTx,
  vetoSafeTx,
  type InnerTx,
  type ProtectionDelays,
} from '@sq/shared/protection';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
process.env.HARDHAT_CONFIG = path.join(root, 'contracts/hardhat.config.cjs');

const DELAYS: ProtectionDelays = {
  d1: { cooldown: 120, expiration: 7 * 86400 },
  d2: { cooldown: 240, expiration: 30 * 86400 },
  d3: { cooldown: 300, expiration: 30 * 86400 },
};

let provider: BrowserProvider;
let deployer: Wallet;
let guard: Contract;
const k1 = Wallet.createRandom();
const k2 = Wallet.createRandom();
const k3 = Wallet.createRandom();
const outsider = Wallet.createRandom();
const dest = Wallet.createRandom().address;

const send = (method: string, params: unknown[] = []) => provider.send(method, params);
const fund = (addr: string, eth = '10') => send('hardhat_setBalance', [addr, '0x' + parseEther(eth).toString(16)]);
const travel = async (sec: number) => {
  await send('evm_increaseTime', [sec]);
  await send('evm_mine');
};
const errText = (e: any): string => [e?.reason, e?.shortMessage, e?.info?.error?.message, e?.message].filter(Boolean).join(' | ');
async function rejects(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.match(errText(e), re);
    return;
  }
  assert.fail(`expected a revert matching ${re}`);
}

/** Signs `tx` with each key (EIP-712, v=27/28) and executes it from `submitter` (the relayer by default). */
async function execSafe(safe: string, tx: SafeTx, keys: BaseWallet[], submitter: Wallet = deployer, sigOverride?: string) {
  const sigs = sigOverride ?? packSignatures(await Promise.all(keys.map(async (k) => ({ signer: k.address, signature: await signSafeTx(k, safe, tx) }))));
  const s = new Contract(safe, SAFE_ABI, submitter.connect(provider));
  const sent = await s.execTransaction(...execArgs(tx, sigs), { gasLimit: 3_000_000 });
  const rc = await sent.wait();
  assert.equal(rc?.status, 1);
  const failed = rc!.logs.some((l: any) => {
    try {
      return s.interface.parseLog(l)?.name === 'ExecutionFailure';
    } catch {
      return false;
    }
  });
  assert.ok(!failed, 'Safe reported ExecutionFailure');
  return rc!;
}
/** Same, but expected to revert (reason checked via eth_call so the guard's message is visible). */
async function execRefused(safe: string, tx: SafeTx, keys: BaseWallet[], re: RegExp, sigOverride?: string) {
  const sigs = sigOverride ?? packSignatures(await Promise.all(keys.map(async (k) => ({ signer: k.address, signature: await signSafeTx(k, safe, tx) }))));
  const s = new Contract(safe, SAFE_ABI, deployer.connect(provider));
  await rejects(s.execTransaction.staticCall(...execArgs(tx, sigs)), re);
}
const nonceOf = async (safe: string) => (await new Contract(safe, SAFE_ABI, provider).nonce()) as bigint;
const ownersOf = async (safe: string) => ((await new Contract(safe, SAFE_ABI, provider).getOwners()) as string[]).map((o) => getAddress(o));
const delay = (addr: string, runner: any = provider) => new Contract(addr, DELAY_ABI, runner);

let salt = 1n;
/** Deploys a fresh 2-of-3 Safe (K1, K2, K3) and runs the canonical K1 + K2 protection setup batch. */
async function protectedSafe(owners = { k1, k2, k3 }) {
  const { safeAddress } = await deploySafe(deployer.connect(provider), [owners.k1.address, owners.k2.address, owners.k3.address], salt++);
  await fund(safeAddress, '5');
  const plan = planProtectionSetup({ safe: safeAddress, k2: owners.k2.address, k3: owners.k3.address, guard: await guard.getAddress(), delays: DELAYS });
  await execSafe(safeAddress, batchSafeTx(plan.data, await nonceOf(safeAddress)), [owners.k1, owners.k2]);
  return { safe: safeAddress, d1: plan.d1.address, d2: plan.d2.address, plan };
}
const ethTransfer = async (safe: string, to = dest, value = parseEther('0.1')) => buildSafeTx({ to, value, nonce: await nonceOf(safe) });

describe('Recovery-key rotation (N2)', { concurrency: 1 }, () => {
  before(async () => {
    const hre = require('hardhat');
    provider = new BrowserProvider(hre.network.provider, 11155111, { cacheTimeout: -1 });
    provider.pollingInterval = 50;
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'contracts/test/fixtures/official-code.json'), 'utf8'));
    for (const c of Object.values<any>(fixture.contracts)) {
      assert.equal(keccak256(c.code), c.codehash);
      await send('hardhat_setCode', [c.address, c.code]);
    }
    deployer = Wallet.createRandom().connect(provider) as unknown as Wallet;
    for (const w of [deployer, k1, k2, k3, outsider]) await fund(w.address);
    const art = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/MyWallGuard.json'), 'utf8'));
    guard = (await new ContractFactory(art.abi, art.bytecode, deployer).deploy(SAFE_MULTISEND_CALL_ONLY)) as Contract;
    await guard.waitForDeployment();
  });

  const rotation = async (safe: string, newK3: string, withProtection: boolean) => {
    const prot = await readProtection(provider as any, safe, await guard.getAddress());
    const d2Modules = prot.config ? [...((await delay(prot.config.d2).getModulesPaginated(MODULE_SENTINEL, 20)) as [string[], string])[0]] : [];
    return buildRecoveryKeyRotation({
      safe,
      owners: await ownersOf(safe),
      oldK3: k3.address,
      newK3,
      nonce: await nonceOf(safe),
      protection: withProtection && prot.config ? { guard: prot.guard!, config: prot.config, d2Modules } : null,
    });
  };

  test('protected wallet: one K1 + K2 batch moves owner, guard config and D2 to K3′', async () => {
    const { safe, d2 } = await protectedSafe();
    const k3b = Wallet.createRandom().connect(provider);
    await fund(k3b.address);
    const tx = await rotation(safe, k3b.address, true);
    assert.equal(tx.operation, 1); // DELEGATECALL to MultiSendCallOnly — the only one the guard accepts
    await execSafe(safe, tx, [k1, k2]);
    assert.ok((await ownersOf(safe)).includes(k3b.address));
    assert.ok(!(await ownersOf(safe)).includes(k3.address));
    const prot = await readProtection(provider as any, safe, await guard.getAddress());
    assert.equal(prot.config!.k3, k3b.address);
    assert.equal(await delay(d2).isModuleEnabled(k3b.address), true);
    assert.equal(await delay(d2).isModuleEnabled(k3.address), false);
    // K3′ + K2 is still NOT immediate (the guard knows K3′ as the recovery key)
    await execRefused(safe, await ethTransfer(safe), [k2, k3b as unknown as BaseWallet], /MyWallGuard/);
    // the old K3 can no longer queue in D2; the new one can
    await rejects(delay(d2, k3.connect(provider)).execTransactionFromModule.staticCall(dest, 1n, '0x', 0), /Module not authorized/);
    await delay(d2, k3b).execTransactionFromModule.staticCall(dest, 1n, '0x', 0);
    // the old K3 cannot sign anything with K1 either (no longer an owner)
    await execRefused(safe, await ethTransfer(safe), [k1, k3], /GS026|MyWallGuard/);
    // K1 + K2 still immediate
    await execSafe(safe, await ethTransfer(safe), [k1, k2]);
  });

  test('counter-example: swapOwner alone on a protected wallet would make K3′ + K2 immediate', async () => {
    const { safe } = await protectedSafe();
    const k3b = Wallet.createRandom();
    await execSafe(safe, await rotation(safe, k3b.address, false), [k1, k2]);
    // the guard still believes K3 is the old address, so K3′ counts as a "device key": K3′ + K2 passes at once
    await execSafe(safe, await ethTransfer(safe), [k2, k3b]);
  });

  test('unprotected wallet: plain swapOwner by K1 + K2', async () => {
    const { safeAddress: safe } = await deploySafe(deployer.connect(provider), [k1.address, k2.address, k3.address], salt++);
    const k3b = Wallet.createRandom();
    const tx = await rotation(safe, k3b.address, true);
    assert.equal(tx.operation, 0);
    await execSafe(safe, tx, [k1, k2]);
    assert.deepEqual((await ownersOf(safe)).includes(k3b.address), true);
    // the old recovery key no longer signs anything
    await fund(safe, '1');
    await execRefused(safe, await ethTransfer(safe), [k1, k3], /GS026/);
  });

  test('builder refuses a guard configuration that does not match the current K3', () => {
    assert.throws(() =>
      buildRecoveryKeyRotation({
        safe: dest,
        owners: [k1.address, k2.address, k3.address],
        oldK3: k3.address,
        newK3: outsider.address,
        nonce: 0,
        protection: { guard: dest, config: { k2: k2.address, k3: outsider.address, d1: dest, d2: dest, d3: null }, d2Modules: [] },
      }),
    );
  });
});
