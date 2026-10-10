// Plain-language decoding of a Safe transaction ("what will this do?").

import { MaxUint256, formatEther, formatUnits, getAddress } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS } from './constants';
import { erc20Iface, safeIface } from './safe';
import type { DecodedAction, SafeTx } from './types';

export const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function decodeSafeTx(tx: SafeTx, safeAddress?: string, contactName?: (addr: string) => string | undefined): DecodedAction {
  const label = (a: string) => {
    const n = contactName?.(a);
    return n ? `${n} (${short(a)})` : short(a);
  };
  const warnings: string[] = [];
  if (tx.operation !== 0) warnings.push('Opération DELEGATECALL — peut réécrire le wallet lui-même');
  const data = tx.data && tx.data !== '0x' ? tx.data : '';
  const value = BigInt(tx.value);

  if (!data) {
    return {
      kind: 'eth-transfer',
      summary: `Envoyer ${formatEther(value)} ETH à ${label(tx.to)}`,
      token: 'ETH',
      amount: formatEther(value),
      amountRaw: value.toString(),
      recipient: getAddress(tx.to),
      warnings,
    };
  }

  const isUsdc = tx.to.toLowerCase() === USDC_ADDRESS.toLowerCase();
  const tokenSym = isUsdc ? 'USDC' : `jeton ${short(tx.to)}`;
  const decimals = isUsdc ? USDC_DECIMALS : 18;

  try {
    const parsed = erc20Iface.parseTransaction({ data });
    if (parsed?.name === 'transfer') {
      const [to, amt] = parsed.args as unknown as [string, bigint];
      return {
        kind: 'erc20-transfer',
        summary: `Envoyer ${formatUnits(amt, decimals)} ${tokenSym} à ${label(to)}`,
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
      if (unlimited) warnings.push(`Autorisation ILLIMITÉE : ${short(spender)} pourrait prendre TOUS vos ${tokenSym}, maintenant et à l'avenir`);
      return {
        kind: 'erc20-approve',
        summary: unlimited
          ? `Autoriser ${label(spender)} à dépenser une quantité ILLIMITÉE de vos ${tokenSym}`
          : `Autoriser ${label(spender)} à dépenser jusqu'à ${formatUnits(amt, decimals)} ${tokenSym}`,
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
          summary: `Remplacer la clé d'appareil ${short(oldOwner)} par la nouvelle clé ${short(newOwner)}`,
          warnings,
        };
      }
    } catch {
      /* fallthrough */
    }
    warnings.push('Modifie la configuration du wallet');
  }

  return {
    kind: 'contract-call',
    summary: `Interagir avec le contrat ${label(tx.to)}${value > 0n ? ` et envoyer ${formatEther(value)} ETH` : ''}`,
    recipient: getAddress(tx.to),
    warnings,
  };
}
