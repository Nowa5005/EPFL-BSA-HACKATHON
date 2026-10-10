// Web side of the on-chain protection (MyWallGuard + Zodiac Delay D1 / D2): activation right after the wallet is
// opened, "Upgrade wallet security" for existing wallets, veto of a pending protected operation.
// The co-signer builds the canonical batch; this device only checks it targets this wallet, signs it with K1
// (after a passkey when the co-signer asks for one) and sends the signature. Nothing here holds K2 or K3.

import type { BaseWallet } from 'ethers';
import { signSafeTx, type SafeTx } from '@sq/shared';
import { SAFE_MULTISEND_CALL_ONLY } from '@sq/shared/protection';
import { cosigner } from './api';
import { passkeyAssertion } from './device';

export interface ProtectionView {
  available: boolean;
  deployed: boolean;
  protected?: boolean;
  config?: { k2: string; k3: string; d1: string; d2: string; d3: string | null } | null;
  queues?: { d1: QueueView; d2: QueueView } | null;
  delays?: { demo: { d1: { cooldown: number }; d2: { cooldown: number } } };
  emergencyReserve?: { address: string; eth: string | null };
  record?: { setupTx: string; setupExplorer: string; reserveTx: string | null } | null;
}
export interface QueueView {
  address: string;
  txNonce: number;
  queueNonce: number;
  cooldown: number;
  pending: { index: number; createdAt: number; executableAt: number; expiresAt: number | null; status: 'cooldown' | 'executable' | 'expired'; tx?: { to: string; value: string; data: string } }[];
}

export const getProtection = (clientId: string) => cosigner.get(`/clients/${clientId}/protection`) as Promise<ProtectionView>;

/** Activates the protection (K1 + K2 setup batch). `k1` = the unlocked device key. */
export async function activateProtection(clientId: string, safeAddress: string, k1: BaseWallet, opts: { backupCode?: string } = {}) {
  const prep = await cosigner.post(`/clients/${clientId}/protection/setup/prepare`, {});
  const tx = prep.safeTx as SafeTx;
  // Defence in depth: the only batch K1 ever signs here is a CALL-only MultiSend executed by this wallet.
  if (tx.to.toLowerCase() !== SAFE_MULTISEND_CALL_ONLY.toLowerCase() || tx.operation !== 1 || tx.value !== '0') throw new Error('Unexpected protection batch');
  const auth = prep.passkeyRequired ? (opts.backupCode ? { backupCode: opts.backupCode } : { webauthn: await passkeyAssertion(prep.authOptions) }) : {};
  const signatureK1 = await signSafeTx(k1, safeAddress, tx);
  return cosigner.post(`/clients/${clientId}/protection/setup/submit`, { previewId: prep.previewId, safeTx: tx, signatureK1, ...auth }) as Promise<{ txHash: string; d1: string; d2: string; reserveTx: string | null }>;
}

/** Veto (cancel) every pending operation of a delay module up to `upTo` (default: all), signed K1 + K2 + passkey. */
export async function vetoPending(clientId: string, safeAddress: string, k1: BaseWallet, module: 'D1' | 'D2' = 'D1', upTo?: number) {
  const prep = await cosigner.post(`/clients/${clientId}/protection/veto/prepare`, { module, upTo });
  const webauthn = prep.authOptions ? await passkeyAssertion(prep.authOptions) : undefined;
  const signatureK1 = await signSafeTx(k1, safeAddress, prep.safeTx);
  return cosigner.post(`/clients/${clientId}/protection/veto/submit`, { previewId: prep.previewId, safeTx: prep.safeTx, signatureK1, webauthn }) as Promise<{ txHash: string }>;
}
