// Wallet password rules (UX policy, not a security guarantee: the password encrypts the device key
// locally with scrypt; production also needs attempt limiting and session protection).

import { tr } from './i18n';

export interface PasswordContext {
  firstName?: string;
  lastName?: string;
  birthDate?: string; // YYYY-MM-DD
}

export interface PasswordRule {
  id: 'length' | 'letters' | 'upper' | 'lower' | 'digits' | 'special' | 'personal' | 'max';
  label: string;
  ok: boolean;
}

export const MIN_LENGTH = 15;
export const MAX_LENGTH = 128;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isLetter = (c: string) => /\p{L}/u.test(c);
const isDigit = (c: string) => /\p{Nd}/u.test(c);

/** Name fragments (≥ 3 chars) and birth-date formats the password must not contain. */
function personalHits(password: string, ctx: PasswordContext): boolean {
  const p = fold(password);
  for (const name of [ctx.firstName, ctx.lastName]) {
    const n = fold(name ?? '').replace(/[^a-z]/g, '');
    if (n.length < 3) continue;
    // any fragment of the name with 3 characters or more (after lower-casing and removing accents)
    for (let len = n.length; len >= 3; len--)
      for (let i = 0; i + len <= n.length; i++) if (p.includes(n.slice(i, i + len))) return true;
  }
  if (ctx.birthDate) {
    const [y, m, d] = ctx.birthDate.split('-');
    if (y && m && d) {
      const yy = y.slice(2);
      const variants = [`${d}${m}${y}`, `${y}${m}${d}`, `${d}${m}${yy}`];
      const digitsOnly = p.replace(/[/.\-\s]/g, '');
      if (variants.some((v) => digitsOnly.includes(v))) return true;
    }
  }
  return false;
}

export function checkPassword(password: string, ctx: PasswordContext = {}): { ok: boolean; rules: PasswordRule[]; message?: string } {
  const chars = [...password];
  const letters = chars.filter(isLetter);
  const rules: PasswordRule[] = [
    { id: 'length', label: tr(`At least ${MIN_LENGTH} characters`, `Au moins ${MIN_LENGTH} caractères`), ok: chars.length >= MIN_LENGTH },
    { id: 'letters', label: tr('At least 5 letters', 'Au moins 5 lettres'), ok: letters.length >= 5 },
    { id: 'upper', label: tr('One upper-case letter', 'Une majuscule'), ok: letters.some((c) => c !== c.toLowerCase()) },
    { id: 'lower', label: tr('One lower-case letter', 'Une minuscule'), ok: letters.some((c) => c !== c.toUpperCase()) },
    { id: 'digits', label: tr('At least 2 digits', 'Au moins 2 chiffres'), ok: chars.filter(isDigit).length >= 2 },
    { id: 'special', label: tr('One special character (e.g. ! ? # -)', 'Un caractère spécial (ex. ! ? # -)'), ok: chars.some((c) => !isLetter(c) && !isDigit(c)) },
    { id: 'personal', label: tr('Neither your name nor your date of birth', 'Ni votre nom, ni votre date de naissance'), ok: password.length > 0 && !personalHits(password, ctx) },
  ];
  if (chars.length > MAX_LENGTH) rules.push({ id: 'max', label: tr(`At most ${MAX_LENGTH} characters`, `Au plus ${MAX_LENGTH} caractères`), ok: false });
  const ok = rules.every((r) => r.ok);
  let message: string | undefined;
  if (!ok) {
    // The personal-data rule is the most actionable message; otherwise the generic composition rule.
    const bad = rules.find((r) => r.id === 'personal' && !r.ok && password.length > 0) ?? rules.find((r) => !r.ok)!;
    message =
      bad.id === 'personal'
        ? tr('Your password must not contain your name or your date of birth.', 'Votre mot de passe ne doit pas contenir votre nom ou votre date de naissance.')
        : bad.id === 'max'
          ? tr(`Use at most ${MAX_LENGTH} characters.`, `Utilisez au plus ${MAX_LENGTH} caractères.`)
          : tr(
            `Use at least ${MIN_LENGTH} characters, including 5 letters (one upper-case and one lower-case), 2 digits and 1 special character.`,
            `Utilisez au moins ${MIN_LENGTH} caractères, dont 5 lettres (une majuscule et une minuscule), 2 chiffres et 1 caractère spécial.`,
          );
  }
  return { ok, rules, message };
}
