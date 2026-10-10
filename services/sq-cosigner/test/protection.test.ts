// Co-signer validation of the on-chain protection routes: each accepts exactly one canonical shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { buildSafeTx, swapOwnerData } from '@sq/shared';
import { PROTECTION_DEMO_DELAYS, batchSafeTx, encodeMultiSend, planProtectionSetup, queueInD1SafeTx, recoveryQueueSafeTx, vetoSafeTx } from '@sq/shared/protection';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-prot-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

const SAFE = '0x1111111111111111111111111111111111111111';
const [k1, k2, k3, k1b] = [0, 1, 2, 3].map(() => Wallet.createRandom().address);
const GUARD = '0x3333333333333333333333333333333333333333';
const plan = planProtectionSetup({ safe: SAFE, k2, k3, guard: GUARD, delays: PROTECTION_DEMO_DELAYS });

test('setup batch: only the exact canonical MultiSendCallOnly batch is accepted', async () => {
  const { validateProtectionBatch } = await import('../src/validate');
  const tx = batchSafeTx(plan.data, 3);
  validateProtectionBatch(tx, plan.data);
  assert.throws(() => validateProtectionBatch({ ...tx, operation: 0 }, plan.data), /DELEGATECALL to MultiSendCallOnly/);
  assert.throws(() => validateProtectionBatch({ ...tx, to: GUARD }, plan.data), /MultiSendCallOnly/);
  assert.throws(() => validateProtectionBatch({ ...tx, gasPrice: '1' }, plan.data), /gas refund/);
  assert.throws(() => validateProtectionBatch({ ...tx, data: tx.data + '00' }, plan.data), /differs/);
  const evil = batchSafeTx(encodeMultiSend([...plan.calls, { to: k1, value: 1n, data: '0x' }]), 3);
  assert.throws(() => validateProtectionBatch(evil, plan.data), /differs/);
  // another wallet's K3 in the guard config → different batch
  const other = planProtectionSetup({ safe: SAFE, k2, k3: k1b, guard: GUARD, delays: PROTECTION_DEMO_DELAYS });
  assert.throws(() => validateProtectionBatch(batchSafeTx(other.data, 3), plan.data), /differs/);
});

test('veto: setTxNonce on this wallet’s own delay modules only', async () => {
  const { validateVeto } = await import('../src/validate');
  const v = validateVeto(vetoSafeTx(plan.d1.address, 2, 5), [plan.d1.address, plan.d2.address]);
  assert.equal(v.newTxNonce, 2n);
  assert.throws(() => validateVeto(vetoSafeTx(GUARD, 2, 5), [plan.d1.address]), /not one of this wallet/);
  assert.throws(() => validateVeto(queueInD1SafeTx(plan.d1.address, { to: k1, value: 1n }, 5), [plan.d1.address]), /setTxNonce/);
  assert.throws(() => validateVeto({ ...vetoSafeTx(plan.d1.address, 2, 5), value: '1' }, [plan.d1.address]), /without ETH/);
});

test('recovery on a protected wallet: only swapOwner on the wallet, queued in its D1', async () => {
  const { validateRecoveryQueue } = await import('../src/validate');
  const owners = [k1, k2, k3];
  const ok = validateRecoveryQueue(recoveryQueueSafeTx(SAFE, plan.d1.address, owners, k1, k1b, 4).safeTx, SAFE, plan.d1.address);
  assert.equal(ok.kind, 'swap-owner');
  assert.equal(ok.newOwner, k1b);
  assert.throws(() => validateRecoveryQueue(queueInD1SafeTx(plan.d1.address, { to: k1, value: 10n }, 4), SAFE, plan.d1.address), /key replacement/);
  assert.throws(() => validateRecoveryQueue(queueInD1SafeTx(plan.d1.address, { to: SAFE, data: swapOwnerData(owners, k1, k1b), operation: 1 }, 4), SAFE, plan.d1.address), /key replacement/);
  assert.throws(() => validateRecoveryQueue(recoveryQueueSafeTx(SAFE, plan.d2.address, owners, k1, k1b, 4).safeTx, SAFE, plan.d1.address), /D1/);
  assert.throws(() => validateRecoveryQueue(buildSafeTx({ to: SAFE, data: swapOwnerData(owners, k1, k1b), nonce: 4 }), SAFE, plan.d1.address), /D1/);
});

test('the everyday route never co-signs calls to the delay modules, the guard or the Safe itself', async () => {
  const { validateSafeTx } = await import('../src/validate');
  for (const tx of [vetoSafeTx(plan.d1.address, 1, 0), queueInD1SafeTx(plan.d1.address, { to: k1, value: 1n }, 0), batchSafeTx(plan.data, 0), buildSafeTx({ to: GUARD, data: plan.calls.at(-2)!.data, nonce: 0 })])
    assert.throws(() => validateSafeTx(tx, SAFE), /refused by the co-signer/);
});

test('setup plan: D1 queued by the Safe, D2 by K3, guard configured before setGuard', () => {
  assert.equal(plan.d1.queuer, SAFE);
  assert.equal(plan.d2.queuer, k3);
  const last = plan.calls.at(-1)!;
  const beforeLast = plan.calls.at(-2)!;
  assert.equal(last.to, SAFE);
  assert.equal(beforeLast.to, GUARD);
  assert.notEqual(plan.d1.address, plan.d2.address);
});
