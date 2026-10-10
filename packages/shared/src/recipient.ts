// Recipient verification: compares the FULL address with saved beneficiaries (same network: Ethereum Sepolia).
// A saved address is not a guarantee of safety, and a resemblance is never presented as a match.

import { getAddress } from 'ethers';
import { pick, type Lang } from './i18n';

export type RecipientCheck =
  | { status: 'invalid'; reason: string }
  | { status: 'exact'; name: string; address: string }
  | { status: 'lookalike'; name: string; saved: string; address: string; diff: number[] }
  | { status: 'new'; address: string };

const HEX = /^0x[0-9a-fA-F]{40}$/;

export function checkRecipient(input: string, contacts: { name: string; address: string }[], lang: Lang = 'en'): RecipientCheck {
  const s = input.trim();
  if (!HEX.test(s)) return { status: 'invalid', reason: pick(lang, 'An Ethereum address has 42 characters: “0x” followed by 40 hexadecimal characters.', 'Une adresse Ethereum compte 42 caractères : « 0x » suivi de 40 caractères hexadécimaux.') };
  let address: string;
  try {
    address = getAddress(s); // mixed-case input must carry a valid EIP-55 checksum
  } catch {
    return { status: 'invalid', reason: pick(lang, 'The letter case does not match the EIP-55 checksum: a letter was probably changed.', 'La casse des lettres ne correspond pas au contrôle EIP-55 : une lettre a probablement été modifiée.') };
  }
  const lc = address.toLowerCase();
  const exact = contacts.find((c) => c.address.toLowerCase() === lc);
  if (exact) return { status: 'exact', name: exact.name, address };
  // Look-alike (address poisoning): same beginning and end, or only a few characters different, anywhere.
  for (const c of contacts) {
    const saved = getAddress(c.address);
    const a = lc.slice(2);
    const b = saved.toLowerCase().slice(2);
    const diff: number[] = [];
    for (let i = 0; i < 40; i++) if (a[i] !== b[i]) diff.push(i + 2);
    const sameEnds = a.slice(0, 4) === b.slice(0, 4) && a.slice(-4) === b.slice(-4);
    if (sameEnds || diff.length <= 8) return { status: 'lookalike', name: c.name, saved, address, diff };
  }
  return { status: 'new', address };
}

/** Did the estimated conditions move enough to require a new confirmation? Both thresholds must be met. */
export function conditionsChanged(previous: number, current: number, cfg: { maxPct: number; minAbs: number }) {
  const delta = Math.abs(current - previous);
  if (delta < cfg.minAbs) return false;
  return delta / Math.max(Math.abs(previous), 1e-9) * 100 >= cfg.maxPct;
}
