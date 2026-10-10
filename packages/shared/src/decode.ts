// Plain-language decoding of a Safe transaction ("what will this do?").

import { MaxUint256, formatEther, formatUnits, getAddress } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS } from './constants';
import { erc20Iface, safeIface } from './safe';
import type { DecodedAction, SafeTx } from './types';
import { pick, type Lang } from './i18n';

export const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function decodeSafeTx(tx: SafeTx, safeAddress?: string, contactName?: (addr: string) => string | undefined, lang: Lang = 'en'): DecodedAction {
  const t = (en: string, fr: string) => pick(lang, en, fr);
  const label = (a: string) => {
    const n = contactName?.(a);
    return n ? `${n} (${short(a)})` : short(a);
  };
  const warnings: string[] = [];
  if (tx.operation !== 0) warnings.push(t('DELEGATECALL operation — can rewrite the wallet itself', 'Opération DELEGATECALL — peut réécrire le wallet lui-même'));
  const data = tx.data && tx.data !== '0x' ? tx.data : '';
  const value = BigInt(tx.value);

  if (!data) {
    return {
      kind: 'eth-transfer',
      summary: t(`Send ${formatEther(value)} ETH to ${label(tx.to)}`, `Envoyer ${formatEther(value)} ETH à ${label(tx.to)}`),
      token: 'ETH',
      amount: formatEther(value),
      amountRaw: value.toString(),
      recipient: getAddress(tx.to),
      warnings,
    };
  }

  const isUsdc = tx.to.toLowerCase() === USDC_ADDRESS.toLowerCase();
  const tokenSym = isUsdc ? 'USDC' : t(`token ${short(tx.to)}`, `jeton ${short(tx.to)}`);
  const decimals = isUsdc ? USDC_DECIMALS : 18;

  try {
    const parsed = erc20Iface.parseTransaction({ data });
    if (parsed?.name === 'transfer') {
      const [to, amt] = parsed.args as unknown as [string, bigint];
      return {
        kind: 'erc20-transfer',
        summary: t(`Send ${formatUnits(amt, decimals)} ${tokenSym} to ${label(to)}`, `Envoyer ${formatUnits(amt, decimals)} ${tokenSym} à ${label(to)}`),
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
      if (unlimited)
        warnings.push(
          t(
            `UNLIMITED approval: ${short(spender)} could take ALL your ${tokenSym}, now and in the future`,
            `Autorisation ILLIMITÉE : ${short(spender)} pourrait prendre TOUS vos ${tokenSym}, maintenant et à l'avenir`,
          ),
        );
      return {
        kind: 'erc20-approve',
        summary: unlimited
          ? t(`Allow ${label(spender)} to spend an UNLIMITED amount of your ${tokenSym}`, `Autoriser ${label(spender)} à dépenser une quantité ILLIMITÉE de vos ${tokenSym}`)
          : t(`Allow ${label(spender)} to spend up to ${formatUnits(amt, decimals)} ${tokenSym}`, `Autoriser ${label(spender)} à dépenser jusqu'à ${formatUnits(amt, decimals)} ${tokenSym}`),
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
          summary: t(`Replace device key ${short(oldOwner)} with the new key ${short(newOwner)}`, `Remplacer la clé d'appareil ${short(oldOwner)} par la nouvelle clé ${short(newOwner)}`),
          warnings,
        };
      }
    } catch {
      /* fallthrough */
    }
    warnings.push(t('Changes the wallet configuration', 'Modifie la configuration du wallet'));
  }

  return {
    kind: 'contract-call',
    summary: t(
      `Interact with contract ${label(tx.to)}${value > 0n ? ` and send ${formatEther(value)} ETH` : ''}`,
      `Interagir avec le contrat ${label(tx.to)}${value > 0n ? ` et envoyer ${formatEther(value)} ETH` : ''}`,
    ),
    recipient: getAddress(tx.to),
    warnings,
  };
}
