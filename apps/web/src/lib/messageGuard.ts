// Blocks obviously sensitive wallet data from being put in an outgoing message (best effort, never sent automatically).

import { tr } from './i18n';

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/, what: tr('a private key or a 64-character hexadecimal secret', 'une clé privée ou un secret de 64 caractères hexadécimaux') },
  { re: /\b(?:[0-9A-HJKMNP-TV-Z]{4}[\s-]?){10,}/, what: tr('a recovery code', 'un code de récupération') },
  { re: /\b[0-9A-HJKMNP-TV-Z]{4}[\s-]?[0-9A-HJKMNP-TV-Z]{4}[\s-]?[0-9A-HJKMNP-TV-Z]{4}\b/, what: tr('a backup code', 'un code de secours') },
  { re: /"(?:ciphertext|crypto|Crypto|keystore)"\s*:/, what: tr('a key backup (keystore)', 'une sauvegarde de clé (keystore)') },
  { re: /\b(?:mot de passe|password|passwort)\s*[:=]/i, what: tr('a password', 'un mot de passe') },
  { re: /\b(?:[a-z]{3,10}\s+){11,23}[a-z]{3,10}\b/, what: tr('what looks like a 12- or 24-word secret phrase', 'ce qui ressemble à une phrase secrète de 12 ou 24 mots') },
];

export function findSensitive(text: string): string | null {
  for (const p of PATTERNS) if (p.re.test(text)) return p.what;
  return null;
}
