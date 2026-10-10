// #20 — Pre-send recipient checks done by the co-signer (on-chain reads), shown in plain language before signing.
//   • recipient kind: plain account (EOA, incl. EIP-7702 delegated accounts), a Safe, a whitelisted dApp, or an
//     unknown contract (strong warning + reinforced checks: a contract may be unable to send the funds back);
//   • first send to this address (the app asks the client to confirm the recipient accepts this asset on Sepolia).

import { Contract, getAddress } from 'ethers';
import { db } from './db';
import { provider } from './chain';
import { DAPP_WHITELIST } from './policy';

export type RecipientKind = 'account' | 'safe' | 'dapp' | 'contract' | 'unknown';

const cache = new Map<string, { kind: RecipientKind; at: number }>();

/** Code at the address → kind. RPC failure → 'unknown' (shown as "could not be checked", never as safe). */
export async function recipientKind(address: string): Promise<RecipientKind> {
  const a = address.toLowerCase();
  const hit = cache.get(a);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.kind;
  let kind: RecipientKind;
  try {
    if (DAPP_WHITELIST[a]) kind = 'dapp';
    else {
      const code = await provider.getCode(address);
      if (code === '0x') kind = 'account';
      else if (code.toLowerCase().startsWith('0xef0100')) kind = 'account'; // EIP-7702 delegation: still an account
      else {
        const safe = new Contract(address, ['function getThreshold() view returns (uint256)', 'function getOwners() view returns (address[])'], provider);
        const [th, owners] = await Promise.all([safe.getThreshold().catch(() => null), safe.getOwners().catch(() => null)]);
        kind = th !== null && Array.isArray(owners) && owners.length > 0 ? 'safe' : 'contract';
      }
    }
  } catch {
    return 'unknown';
  }
  cache.set(a, { kind, at: Date.now() });
  return kind;
}

/** True when this client has never sent anything to this address (confirmed or pending send). */
export function isFirstSend(clientId: string, address: string): boolean {
  const a = getAddress(address).toLowerCase();
  return !Object.values(db.data.walletTxs ?? {}).some((t) => t.clientId === clientId && t.kind === 'send' && t.status !== 'failed' && !t.flags?.length && t.to?.toLowerCase() === a);
}
