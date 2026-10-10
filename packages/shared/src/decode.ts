// Plain-language decoding of a Safe transaction ("what will this do?").

import { MaxUint256, formatEther, formatUnits, getAddress } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS } from './constants';
import { erc20Iface, safeIface } from './safe';
import type { DecodedAction, SafeTx } from './types';

export const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function decodeSafeTx(tx: SafeTx, safeAddress?: string, contactName?: (addr: string) => string | undefined): DecodedAction {
  const label = (a: string) => {
    const n = contactName?.(a);
    return n ? `${short(a)} (contact: ${n})` : short(a);
  };
  const warnings: string[] = [];
  if (tx.operation !== 0) warnings.push('DELEGATECALL operation — can rewrite the wallet itself');
  const data = tx.data && tx.data !== '0x' ? tx.data : '';
  const value = BigInt(tx.value);

  if (!data) {
    return {
      kind: 'eth-transfer',
      summary: `Send ${formatEther(value)} ETH to ${label(tx.to)}`,
      token: 'ETH',
      amount: formatEther(value),
      amountRaw: value.toString(),
      recipient: getAddress(tx.to),
      warnings,
    };
  }

  const isUsdc = tx.to.toLowerCase() === USDC_ADDRESS.toLowerCase();
  const tokenSym = isUsdc ? 'USDC' : `token ${short(tx.to)}`;
  const decimals = isUsdc ? USDC_DECIMALS : 18;

  try {
    const parsed = erc20Iface.parseTransaction({ data });
    if (parsed?.name === 'transfer') {
      const [to, amt] = parsed.args as unknown as [string, bigint];
      return {
        kind: 'erc20-transfer',
        summary: `Send ${formatUnits(amt, decimals)} ${tokenSym} to ${label(to)}`,
        token: isUsdc ? 'USDC' : tx.to,
        amount: formatUnits(amt, decimals),
        amountRaw: amt.toString(),
        recipient: getAddress(to),
        warnings,
      };
    }
    if (parsed?.name === 'approve') {
      const [spender, amt] = parsed.args as unknown as [string, bigint];
      const unlimited = amt >= MaxUint256 / 2n;
      if (unlimited) warnings.push(`UNLIMITED approval: ${short(spender)} could take ALL your ${tokenSym}, now and in the future`);
      return {
        kind: 'erc20-approve',
        summary: unlimited
          ? `Allow ${label(spender)} to spend an UNLIMITED amount of your ${tokenSym}`
          : `Allow ${label(spender)} to spend up to ${formatUnits(amt, decimals)} ${tokenSym}`,
        token: isUsdc ? 'USDC' : tx.to,
        amount: unlimited ? 'unlimited' : formatUnits(amt, decimals),
        amountRaw: amt.toString(),
        spender: getAddress(spender),
        unlimited,
        warnings,
      };
    }
  } catch {
    /* not an ERC-20 call */
  }

  if (safeAddress && tx.to.toLowerCase() === safeAddress.toLowerCase()) {
    try {
      const parsed = safeIface.parseTransaction({ data });
      if (parsed?.name === 'swapOwner') {
        const [, oldOwner, newOwner] = parsed.args as unknown as [string, string, string];
        return {
          kind: 'swap-owner',
          summary: `Replace device key ${short(oldOwner)} with new device key ${short(newOwner)}`,
          warnings,
        };
      }
    } catch {
      /* fallthrough */
    }
    warnings.push('Changes the wallet configuration');
  }

  return {
    kind: 'contract-call',
    summary: `Interact with contract ${label(tx.to)}${value > 0n ? ` and send ${formatEther(value)} ETH` : ''}`,
    recipient: getAddress(tx.to),
    warnings,
  };
}
