// Pure builder of the "replace the recovery key" transaction (K3 → K3′), signed by K1 + K2.
// Unprotected wallet: Safe.swapOwner. Protected wallet (MyWallGuard + Zodiac Delay): ONE MultiSendCallOnly batch —
//   swapOwner(K3 → K3′) · guard.setConfig(k3 = K3′) · D2.disableModule(K3) · D2.enableModule(K3′)
// All three MUST move together: the guard recognises K3 by its configured address (a K3′ left unknown would count as a
// device key, making K3′ + K2 immediate), and D2 lets only the configured recovery key queue.
// Tested on the official bytecode in contracts/test/recoveryRotation.test.ts.

import { Interface, ZeroAddress, getAddress } from 'ethers';
import { buildSafeTx, swapOwnerData, type SafeTx } from '@sq/shared';
import { DELAY_ABI, batchSafeTx, encodeMultiSend, guardIface } from '@sq/shared/protection';

export const MODULE_SENTINEL = '0x0000000000000000000000000000000000000001';
const delayIface = new Interface(DELAY_ABI);

export interface RotationProtection {
  guard: string;
  config: { k2: string; k3: string; d1: string; d2: string; d3: string | null };
  /** Modules currently enabled on D2 (getModulesPaginated from the sentinel), to find K3's predecessor. */
  d2Modules: string[];
}

export function buildRecoveryKeyRotation(p: { safe: string; owners: string[]; oldK3: string; newK3: string; nonce: bigint | string | number; protection?: RotationProtection | null }): SafeTx {
  const oldK3 = getAddress(p.oldK3);
  const newK3 = getAddress(p.newK3);
  const swap = swapOwnerData(p.owners, oldK3, newK3);
  if (!p.protection) return buildSafeTx({ to: p.safe, data: swap, nonce: p.nonce });
  const { guard, config: cfg, d2Modules } = p.protection;
  if (getAddress(cfg.k3) !== oldK3) throw new Error('Guard configuration does not match the current recovery key');
  if (getAddress(cfg.k2) === newK3) throw new Error('The recovery key must differ from Swissquote’s key');
  const calls = [
    { to: getAddress(p.safe), data: swap },
    { to: getAddress(guard), data: guardIface.encodeFunctionData('setConfig', [cfg.k2, newK3, cfg.d1, cfg.d2, cfg.d3 ?? ZeroAddress]) },
  ];
  if (cfg.d2 && getAddress(cfg.d2) !== ZeroAddress) {
    const list = d2Modules.map((m) => getAddress(m));
    const i = list.indexOf(oldK3);
    if (i >= 0) calls.push({ to: getAddress(cfg.d2), data: delayIface.encodeFunctionData('disableModule', [i === 0 ? MODULE_SENTINEL : list[i - 1], oldK3]) });
    calls.push({ to: getAddress(cfg.d2), data: delayIface.encodeFunctionData('enableModule', [newK3]) });
  }
  return batchSafeTx(encodeMultiSend(calls), p.nonce);
}
