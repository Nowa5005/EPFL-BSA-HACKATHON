// MyWallGuard + Zodiac Delay D1/D2 on an in-process Hardhat network, against the OFFICIAL bytecode of Safe v1.4.1,
// MultiSendCallOnly v1.4.1, Zodiac Delay v1.0.1 and ModuleProxyFactory v1.2.0 (snapshotted from Sepolia, codehashes
// checked against @safe-global/safe-deployments). Every row of SECURITY_GAPS_FIX §3.1 + the bypass attempts.
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

describe('MyWallGuard', { concurrency: 1 }, () => {
before(async () => {
  const hre = require('hardhat');
  provider = new BrowserProvider(hre.network.provider, 11155111, { cacheTimeout: -1 });
  provider.pollingInterval = 50;
  // Official contracts at their canonical addresses, byte-for-byte the Sepolia code.
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

describe('setup', () => {
  test('official bytecode = @safe-global/safe-deployments codehashes (Safe v1.4.1)', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'contracts/test/fixtures/official-code.json'), 'utf8')).contracts;
    const dep = (f: string) => require(`@safe-global/safe-deployments/dist/assets/v1.4.1/${f}.json`).deployments.canonical;
    for (const [k, f] of [['safeL2Singleton141', 'safe_l2'], ['safeProxyFactory141', 'safe_proxy_factory'], ['compatibilityFallbackHandler141', 'compatibility_fallback_handler'], ['multiSendCallOnly141', 'multi_send_call_only']]) {
      assert.equal(fixture[k].address, dep(f).address);
      assert.equal(fixture[k].codehash, dep(f).codeHash);
    }
  });

  test('guard: ERC-165 Safe Guard interface (0xe6d7a83a), selectors', async () => {
    assert.equal(await guard.supportsInterface('0xe6d7a83a'), true);
    assert.equal(await guard.supportsInterface('0x01ffc9a7'), true);
    assert.equal(await guard.supportsInterface('0xffffffff'), false);
    assert.equal(await guard.QUEUE_SELECTOR(), delayIface.getFunction('execTransactionFromModule')!.selector);
    assert.equal(await guard.VETO_SELECTOR(), delayIface.getFunction('setTxNonce')!.selector);
  });

  test('K1 + K2 setup batch: D1/D2 at the predicted addresses, modules enabled, guard set and configured', async () => {
    const { safe, d1, d2 } = await protectedSafe();
    const st = await readProtection(provider as any, safe, await guard.getAddress());
    assert.equal(st.protected, true);
    assert.equal(st.guard, await guard.getAddress());
    assert.deepEqual(new Set(st.modules), new Set([d1, d2]));
    assert.deepEqual(st.config, { k2: k2.address, k3: k3.address, d1, d2, d3: null });
    assert.equal(await delay(d1).owner(), safe);
    assert.equal(await delay(d1).avatar(), safe);
    assert.equal(await delay(d1).isModuleEnabled(safe), true);
    assert.equal(await delay(d2).isModuleEnabled(k3.address), true);
    assert.equal(Number(await delay(d1).txCooldown()), 120);
    assert.equal(Number(await delay(d2).txCooldown()), 240);
  });

  test('the same batch works when a third party already deployed the module proxies (front-run)', async () => {
    const { safeAddress } = await deploySafe(deployer.connect(provider), [k1.address, k2.address, k3.address], salt++);
    const g = await guard.getAddress();
    const plan = planProtectionSetup({ safe: safeAddress, k2: k2.address, k3: k3.address, guard: g, delays: DELAYS });
    const factory = new Contract('0x000000000000aDdB49795b0f9bA5BC298cDda236', ['function deployModule(address,bytes,uint256) returns (address)'], outsider.connect(provider));
    await (await factory.deployModule('0xd54895B1121A2eE3f37b502F507631FA1331BED6', plan.d1.initializer, plan.d1.saltNonce)).wait();
    assert.equal(await delay(plan.d1.address).owner(), safeAddress, 'front-run proxy is still owned by the Safe');
    const plan2 = planProtectionSetup({ safe: safeAddress, k2: k2.address, k3: k3.address, guard: g, delays: DELAYS, deployed: { D1: true } });
    await execSafe(safeAddress, batchSafeTx(plan2.data, await nonceOf(safeAddress)), [k1, k2]);
    assert.equal((await readProtection(provider as any, safeAddress, g)).protected, true);
  });
});

describe('§3.1 rules', () => {
  let safe: string, d1: string, d2: string;
  before(async () => ({ safe, d1, d2 } = await protectedSafe()));

  test('K1 + K2: immediate', async () => {
    const before = await provider.getBalance(dest);
    await execSafe(safe, await ethTransfer(safe), [k1, k2]);
    assert.equal((await provider.getBalance(dest)) - before, parseEther('0.1'));
  });

  test('K1 + K2 with eth_sign (v > 30) and with an approved hash (v = 1) also count', async () => {
    const tx = await ethTransfer(safe);
    const h = safeTxHash(safe, tx);
    const ethSign = async (k: BaseWallet) => {
      const sig = getBytes(await k.signMessage(getBytes(h)));
      sig[64] += 4;
      return '0x' + Buffer.from(sig).toString('hex');
    };
    await execSafe(safe, tx, [], deployer, packSignatures([{ signer: k1.address, signature: await ethSign(k1) }, { signer: k2.address, signature: await signSafeTx(k2, safe, tx) }]));
    const tx2 = await ethTransfer(safe);
    // K1 executes the transaction itself: its "approved hash" signature (v = 1) is msg.sender
    const approved = zeroPadValue(k1.address, 32) + '0'.repeat(64) + '01';
    await execSafe(safe, tx2, [], k1 as unknown as Wallet, packSignatures([{ signer: k1.address, signature: approved }, { signer: k2.address, signature: await signSafeTx(k2, safe, tx2) }]));
  });

  test('K2 + K3 direct (Swissquote + partner): refused', async () => {
    await execRefused(safe, await ethTransfer(safe), [k2, k3], /MyWallGuard: without K1\+K2, no ETH/);
    const usdcLike = buildSafeTx({ to: dest, data: '0xa9059cbb' + '00'.repeat(64), nonce: await nonceOf(safe) });
    await execRefused(safe, usdcLike, [k2, k3], /only queueing in D1 or a veto/);
  });

  test('K1 + K3 direct (exit without Swissquote): refused', async () => {
    await execRefused(safe, await ethTransfer(safe), [k1, k3], /MyWallGuard/);
  });

  test('configuration changes without K1 + K2: refused (guard, modules, owners, threshold, fallback, Delay settings)', async () => {
    const n = await nonceOf(safe);
    const self = (data: string) => buildSafeTx({ to: safe, data, nonce: n });
    const admin = new Interface([...SAFE_ADMIN_ABI, 'function addOwnerWithThreshold(address,uint256)', 'function changeThreshold(uint256)', 'function setFallbackHandler(address)', 'function removeOwner(address,address,uint256)']);
    const attempts: SafeTx[] = [
      self(admin.encodeFunctionData('setGuard', ['0x0000000000000000000000000000000000000000'])),
      self(admin.encodeFunctionData('disableModule', ['0x0000000000000000000000000000000000000001', d1])),
      self(admin.encodeFunctionData('enableModule', [outsider.address])),
      self(admin.encodeFunctionData('addOwnerWithThreshold', [outsider.address, 2])),
      self(admin.encodeFunctionData('changeThreshold', [1])),
      self(admin.encodeFunctionData('setFallbackHandler', [outsider.address])),
      self(swapOwnerData(await ownersOf(safe), k1.address, outsider.address)),
      buildSafeTx({ to: d1, data: delayIface.encodeFunctionData('setTxCooldown', [0]), nonce: n }),
      buildSafeTx({ to: d1, data: delayIface.encodeFunctionData('setTxExpiration', [0]), nonce: n }),
      buildSafeTx({ to: d1, data: delayIface.encodeFunctionData('enableModule', [outsider.address]), nonce: n }),
      buildSafeTx({ to: d2, data: delayIface.encodeFunctionData('disableModule', ['0x0000000000000000000000000000000000000001', k3.address]), nonce: n }),
      buildSafeTx({ to: await guard.getAddress(), data: guardIface.encodeFunctionData('setConfig', [outsider.address, k3.address, d1, d2, '0x0000000000000000000000000000000000000000']), nonce: n }),
    ];
    for (const t of attempts) {
      await execRefused(safe, t, [k2, k3], /MyWallGuard/);
      await execRefused(safe, t, [k1, k3], /MyWallGuard/);
    }
  });

  test('queue in D1 by K2 + K3 (device recovery), on-chain cooldown, then execution by anyone', async () => {
    const k1b = Wallet.createRandom();
    const { safeTx, inner } = recoveryQueueSafeTx(safe, d1, await ownersOf(safe), k1.address, k1b.address, await nonceOf(safe));
    await execSafe(safe, safeTx, [k2, k3]);
    const q = await readDelayQueue(provider as any, d1, { withTxs: true });
    assert.equal(q.pending.length, 1);
    assert.equal(q.pending[0].hash, delayTxHash(inner));
    assert.equal(q.pending[0].tx?.data, inner.data);
    const d = delay(d1, outsider.connect(provider));
    await rejects(d.executeNextTx.staticCall(inner.to, inner.value, inner.data, 0), /cooldown/);
    await travel(121);
    await (await d.executeNextTx(inner.to, inner.value, inner.data, 0)).wait();
    const owners = await ownersOf(safe);
    assert.ok(owners.includes(k1b.address) && !owners.includes(k1.address));
    // K1 is read dynamically: the new device key + K2 is immediate, the old one is no longer an owner
    await execSafe(safe, await ethTransfer(safe), [k1b, k2]);
    await execRefused(safe, await ethTransfer(safe), [k1, k2], /GS026/);
    // put K1 back for the following tests (K1′ + K2, immediate)
    await execSafe(safe, buildSafeTx({ to: safe, data: swapOwnerData(await ownersOf(safe), k1b.address, k1.address), nonce: await nonceOf(safe) }), [k1b, k2]);
  });

  test('veto: a pending D1 operation is cancelled immediately with setTxNonce by any 2 owners', async () => {
    const inner: InnerTx = { to: dest, value: parseEther('1') };
    await execSafe(safe, queueInD1SafeTx(d1, inner, await nonceOf(safe)), [k2, k3]); // hostile queue
    const q = await readDelayQueue(provider as any, d1);
    assert.equal(q.pending.length, 1);
    await execSafe(safe, vetoSafeTx(d1, q.queueNonce, await nonceOf(safe)), [k1, k2]); // the client's veto (K1 + K2)
    await travel(121);
    await rejects(delay(d1, outsider.connect(provider)).executeNextTx.staticCall(inner.to, inner.value, '0x', 0), /queue is empty/);
    // a veto by another pair (K1 + K3) is accepted too
    await execSafe(safe, queueInD1SafeTx(d1, inner, await nonceOf(safe)), [k2, k3]);
    await execSafe(safe, vetoSafeTx(d1, (await readDelayQueue(provider as any, d1)).queueNonce, await nonceOf(safe)), [k1, k3]);
    assert.equal((await readDelayQueue(provider as any, d1)).pending.length, 0);
  });

  test('K1 + K3 protected exit via D1 (no Swissquote): queued, then executed after the cooldown', async () => {
    const inner: InnerTx = { to: dest, value: parseEther('0.5') };
    // submitted by K3 itself, paying gas from its emergency reserve
    await execSafe(safe, queueInD1SafeTx(d1, inner, await nonceOf(safe)), [k1, k3], k3 as unknown as Wallet);
    await travel(60);
    await rejects(delay(d1, k3.connect(provider)).executeNextTx.staticCall(dest, inner.value, '0x', 0), /cooldown/);
    await travel(61);
    const before = await provider.getBalance(dest);
    await (await delay(d1, k3.connect(provider)).executeNextTx(dest, inner.value, '0x', 0)).wait();
    assert.equal((await provider.getBalance(dest)) - before, parseEther('0.5'));
  });

  test('K3 alone: queues in D2, executable only after D2’s (longer) cooldown, vetoable', async () => {
    const inner: InnerTx = { to: dest, value: parseEther('0.2') };
    const d = delay(d2, k3.connect(provider));
    await (await d.execTransactionFromModule(dest, inner.value, '0x', 0)).wait();
    await travel(121);
    await rejects(d.executeNextTx.staticCall(dest, inner.value, '0x', 0), /cooldown/);
    await travel(120);
    const before = await provider.getBalance(dest);
    await (await d.executeNextTx(dest, inner.value, '0x', 0)).wait();
    assert.equal((await provider.getBalance(dest)) - before, parseEther('0.2'));
    // veto of a K3-alone queue by K1 + K2
    await (await d.execTransactionFromModule(dest, inner.value, '0x', 0)).wait();
    await execSafe(safe, vetoSafeTx(d2, (await readDelayQueue(provider as any, d2)).queueNonce, await nonceOf(safe)), [k1, k2]);
    assert.equal((await readDelayQueue(provider as any, d2)).pending.length, 0);
  });

  test('K3 alone cannot queue in D1, an outsider cannot queue in D1 or D2', async () => {
    await rejects(delay(d1, k3.connect(provider)).execTransactionFromModule.staticCall(dest, 1n, '0x', 0), /Module not authorized/);
    await rejects(delay(d1, outsider.connect(provider)).execTransactionFromModule.staticCall(dest, 1n, '0x', 0), /Module not authorized/);
    await rejects(delay(d2, outsider.connect(provider)).execTransactionFromModule.staticCall(dest, 1n, '0x', 0), /Module not authorized/);
  });

  test('expired queued operations cannot run', async () => {
    const inner: InnerTx = { to: dest, value: 1n };
    await execSafe(safe, queueInD1SafeTx(d1, inner, await nonceOf(safe)), [k1, k3]);
    await travel(120 + 7 * 86400 + 5);
    await rejects(delay(d1, outsider.connect(provider)).executeNextTx.staticCall(dest, 1n, '0x', 0), /expired/);
    await (await delay(d1, outsider.connect(provider)).skipExpired()).wait();
    assert.equal((await readDelayQueue(provider as any, d1)).pending.length, 0);
  });
});

describe('bypass attempts', () => {
  let safe: string, d1: string, d2: string;
  before(async () => ({ safe, d1, d2 } = await protectedSafe()));

  test('removing the guard is only possible through D1 (after the delay, vetoable) — or K1 + K2', async () => {
    const admin = new Interface(SAFE_ADMIN_ABI);
    const removeGuard = { to: safe, data: admin.encodeFunctionData('setGuard', ['0x0000000000000000000000000000000000000000']) };
    await execRefused(safe, buildSafeTx({ to: safe, data: removeGuard.data, nonce: await nonceOf(safe) }), [k2, k3], /MyWallGuard/);
    await execSafe(safe, queueInD1SafeTx(d1, removeGuard, await nonceOf(safe)), [k2, k3]);
    await rejects(delay(d1, outsider.connect(provider)).executeNextTx.staticCall(safe, 0n, removeGuard.data, 0), /cooldown/);
    await travel(121);
    await (await delay(d1, outsider.connect(provider)).executeNextTx(safe, 0n, removeGuard.data, 0)).wait();
    assert.equal((await readProtection(provider as any, safe, await guard.getAddress())).guard, null, 'removed only after the on-chain delay');
    // K1 + K2 put it back immediately
    await execSafe(safe, buildSafeTx({ to: safe, data: admin.encodeFunctionData('setGuard', [await guard.getAddress()]), nonce: await nonceOf(safe) }), [k1, k2]);
    assert.equal((await readProtection(provider as any, safe, await guard.getAddress())).protected, true);
  });

  test('changing the cooldown directly is refused without K1 + K2', async () => {
    await execRefused(safe, buildSafeTx({ to: d1, data: delayIface.encodeFunctionData('setTxCooldown', [0]), nonce: await nonceOf(safe) }), [k2, k3], /MyWallGuard/);
    await execRefused(safe, buildSafeTx({ to: d2, data: delayIface.encodeFunctionData('setTxCooldown', [0]), nonce: await nonceOf(safe) }), [k1, k3], /MyWallGuard/);
    // and the Delay module itself only obeys its owner (the Safe)
    await rejects(delay(d1, k3.connect(provider)).setTxCooldown.staticCall(0), /caller is not the owner/);
  });

  test('DELEGATECALL: refused to any contract other than MultiSendCallOnly, even with K1 + K2; never without K1 + K2', async () => {
    const evil = { ...buildSafeTx({ to: d1, data: '0x', nonce: await nonceOf(safe) }), operation: 1 as const };
    await execRefused(safe, evil, [k1, k2], /DELEGATECALL is only allowed to MultiSendCallOnly/);
    const batch = batchSafeTx(encodeMultiSend([{ to: dest, value: 1n, data: '0x' }]), await nonceOf(safe));
    await execRefused(safe, batch, [k2, k3], /DELEGATECALL is refused/);
    await execSafe(safe, batch, [k1, k2]);
  });

  test('restricted pairs cannot be paid a gas refund from the wallet, nor attach ETH to the queue call', async () => {
    const q = queueInD1SafeTx(d1, { to: dest, value: 1n }, await nonceOf(safe));
    await execRefused(safe, { ...q, gasPrice: '1000000000', refundReceiver: k3.address, safeTxGas: '100000' }, [k2, k3], /no gas refund/);
    await execRefused(safe, { ...q, value: '1' }, [k2, k3], /no ETH/);
    // queue only in D1 (D2's queuer is K3, not the Safe), veto in D1/D2 only
    await execRefused(safe, buildSafeTx({ to: d2, data: queueData({ to: dest, value: 1n }), nonce: await nonceOf(safe) }), [k2, k3], /only queueing in D1/);
    await execRefused(safe, buildSafeTx({ to: outsider.address, data: delayIface.encodeFunctionData('setTxNonce', [1]), nonce: await nonceOf(safe) }), [k2, k3], /only queueing in D1/);
  });

  test('duplicate signatures never count twice (Safe GS026, and the guard itself)', async () => {
    const tx = await ethTransfer(safe);
    const s2 = await signSafeTx(k2, safe, tx);
    await execRefused(safe, tx, [], /GS026/, '0x' + s2.slice(2) + s2.slice(2));
    // guard called directly as if by the Safe (eth_call from the Safe address) with K2 twice
    // the guard hashes with nonce() - 1: emulate "nonce already incremented" by reading the hash at the current nonce
    const tx0 = { ...tx, nonce: String((await nonceOf(safe)) - 1n) };
    const sig = await signSafeTx(k2, safe, tx0);
    await rejects(
      (guard.connect(provider) as Contract).checkTransaction.staticCall(tx0.to, tx0.value, tx0.data, 0, 0, 0, 0, tx0.gasToken, tx0.refundReceiver, '0x' + sig.slice(2) + sig.slice(2), safe, { from: safe }),
      /duplicate signature/,
    );
  });

  test('a 3rd signature beyond the threshold is ignored (only the first `threshold` signers count)', async () => {
    const tx = await ethTransfer(safe);
    const sigs = packSignatures([{ signer: k2.address, signature: await signSafeTx(k2, safe, tx) }, { signer: k3.address, signature: await signSafeTx(k3, safe, tx) }]);
    const extraK1 = (await signSafeTx(k1, safe, tx)).slice(2);
    await execRefused(safe, tx, [], /MyWallGuard/, sigs + extraK1);
  });

  test('guard configuration cannot be changed by anyone but the Safe itself', async () => {
    const g = guard.connect(outsider.connect(provider)) as Contract;
    await (await g.setConfig(outsider.address, k3.address, outsider.address, outsider.address, outsider.address)).wait();
    const c = await guard.configOf(safe);
    assert.equal(c.k2, k2.address, "an outsider's setConfig only writes its own entry");
    assert.equal((await guard.configOf(outsider.address)).k2, outsider.address);
    await rejects(g.setConfig.staticCall(k2.address, k2.address, d1, d2, '0x0000000000000000000000000000000000000000'), /must differ/);
  });

  test('a Safe that sets the guard without configuring it is refused (fail closed)', async () => {
    const { safeAddress } = await deploySafe(deployer.connect(provider), [k1.address, k2.address, k3.address], salt++);
    const setGuard = new Interface(SAFE_ADMIN_ABI).encodeFunctionData('setGuard', [await guard.getAddress()]);
    await execSafe(safeAddress, buildSafeTx({ to: safeAddress, data: setGuard, nonce: await nonceOf(safeAddress) }), [k1, k2]);
    await execRefused(safeAddress, await ethTransfer(safeAddress, dest, 0n), [k1, k2], /Safe not configured/);
  });

  test('module transactions bypass the guard only through the Delay (Safe v1.4.1 behaviour relied on)', async () => {
    // abi sanity: queued data = Delay.execTransactionFromModule(...)
    const data = queueData({ to: dest, value: 5n, data: '0x1234' });
    const [to, value, d, op] = delayIface.decodeFunctionData('execTransactionFromModule', data);
    assert.deepEqual([to, value, d, Number(op)], [getAddress(dest), 5n, '0x1234', 0]);
    assert.equal(delayTxHash({ to: dest, value: 5n, data: '0x1234' }), keccak256(solidityPacked(['address', 'uint256', 'bytes', 'uint8'], [dest, 5n, '0x1234', 0])));
    assert.equal(await delay(d1).getTransactionHash(dest, 5n, '0x1234', 0), delayTxHash({ to: dest, value: 5n, data: '0x1234' }));
  });
});
});
