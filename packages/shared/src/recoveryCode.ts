// Paper recovery code (share ① of the recovery key) as human-typable text — no QR code.
// Encoding only (no cryptography): Crockford base32, groups of 4 characters = 3 data characters + 1 check
// character (detects any single typo and tells WHICH group is wrong), plus a final group derived from
// SHA-256 (ethers) of the share to catch anything else.

import { getBytes, hexlify, sha256 } from 'ethers';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const WEIGHTS = [1, 3, 7];

const checkChar = (vals: number[]) => ALPHABET[vals.reduce((s, v, i) => s + v * WEIGHTS[i], 0) % 32];

function toBits(bytes: Uint8Array) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}

function globalCheck(bytes: Uint8Array) {
  const h = getBytes(sha256(bytes));
  const bits = toBits(h.slice(0, 3)).slice(0, 20);
  return Array.from({ length: 4 }, (_, i) => ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join('');
}

/** share (hex) → "ABC7 K2M9 … WXYZ" */
export function encodeRecoveryCode(shareHex: string): string {
  const bytes = getBytes(shareHex);
  let bits = toBits(bytes);
  while (bits.length % 15) bits += '0';
  const groups: string[] = [];
  for (let i = 0; i < bits.length; i += 15) {
    const vals = [0, 1, 2].map((k) => parseInt(bits.slice(i + k * 5, i + k * 5 + 5), 2));
    groups.push(vals.map((v) => ALPHABET[v]).join('') + checkChar(vals));
  }
  groups.push(globalCheck(bytes));
  return groups.join(' ');
}

export type RecoveryCodeResult = { ok: true; share: string } | { ok: false; group?: number; error: string };

/** Accepts spaces/dashes, lower case, and common confusions (O→0, I/L→1). */
export function decodeRecoveryCode(input: string, shareBytes = 33): RecoveryCodeResult {
  const clean = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  const dataGroups = Math.ceil((shareBytes * 8) / 15);
  const expected = (dataGroups + 1) * 4;
  if (!clean) return { ok: false, error: 'Saisissez votre code de récupération.' };
  for (let i = 0; i < clean.length; i++)
    if (!ALPHABET.includes(clean[i])) return { ok: false, group: Math.floor(i / 4) + 1, error: `Caractère invalide « ${clean[i]} » dans le groupe ${Math.floor(i / 4) + 1}.` };
  if (clean.length !== expected) return { ok: false, error: `Le code doit contenir ${dataGroups + 1} groupes de 4 caractères (${Math.floor(clean.length / 4)} saisis).` };
  let bits = '';
  for (let g = 0; g < dataGroups; g++) {
    const chunk = clean.slice(g * 4, g * 4 + 4);
    const vals = [0, 1, 2].map((k) => ALPHABET.indexOf(chunk[k]));
    if (checkChar(vals) !== chunk[3]) return { ok: false, group: g + 1, error: `Le groupe ${g + 1} semble erroné.` };
    bits += vals.map((v) => v.toString(2).padStart(5, '0')).join('');
  }
  const bytes = new Uint8Array(shareBytes);
  for (let i = 0; i < shareBytes; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  if (globalCheck(bytes) !== clean.slice(dataGroups * 4)) return { ok: false, group: dataGroups + 1, error: `Le groupe de contrôle (${dataGroups + 1}) ne correspond pas : vérifiez le code.` };
  return { ok: true, share: hexlify(bytes) };
}
