// Backup code: an alternative when the passkey cannot be used (no biometrics, broken sensor…).
// 12 characters generated with a CSPRNG on the device, shown once, confirmed by the client, revocable.
// The server stores only a scrypt hash with a random salt; attempts are limited; each use is bound to a
// single-use challenge (a preview or an unlock challenge), so a captured request cannot be replayed.
// It is NOT a wallet recovery phrase, and it can never freeze/unfreeze, reveal amounts or reveal secrets.

import { hexlify, randomBytes, scryptSync, toUtf8Bytes } from 'ethers';
import { timingSafeEqual } from 'node:crypto';
import { POLICY } from '@sq/shared';
import { nowIso } from '@sq/shared/server';
import { db, getClient, HttpError } from './db';

const SCRYPT = { N: 1 << 15, r: 8, p: 1 };
export const BACKUP_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/; // Crockford base32, 12 chars (60 bits)

const normalize = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
const hashCode = (code: string, salt: string) => hexlify(scryptSync(toUtf8Bytes(normalize(code)), salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, 32));

export function setBackupCode(clientId: string, code: string) {
  const c = normalize(code);
  if (!BACKUP_CODE_RE.test(c)) throw new HttpError(400, 'Le code de secours doit compter 12 caractères (lettres et chiffres).');
  const salt = hexlify(randomBytes(16));
  db.update((d) => (d.clients[clientId].backupCode = { salt, hash: hashCode(c, salt), createdAt: nowIso(), failed: 0 }));
}

export function revokeBackupCode(clientId: string) {
  db.update((d) => delete d.clients[clientId].backupCode);
}

/** Verifies the code with attempt limiting. Throws on failure. */
export function verifyBackupCode(clientId: string, code: string) {
  const bc = getClient(clientId).backupCode;
  if (!bc) throw new HttpError(400, 'Aucun code de secours n’est configuré.');
  if (bc.lockedUntil && new Date(bc.lockedUntil).getTime() > Date.now()) throw new HttpError(429, 'Trop de tentatives : le code de secours est bloqué temporairement.');
  const ok = timingSafeEqual(Buffer.from(hashCode(code ?? '', bc.salt).slice(2), 'hex'), Buffer.from(bc.hash.slice(2), 'hex'));
  if (!ok) {
    const failed = bc.failed + 1;
    const lock = failed >= POLICY.backupCodeMaxAttempts;
    db.update((d) => {
      const b = d.clients[clientId].backupCode!;
      b.failed = lock ? 0 : failed;
      b.lockedUntil = lock ? new Date(Date.now() + POLICY.backupCodeLockMinutes * 60_000).toISOString() : undefined;
    });
    throw new HttpError(401, lock ? `Code incorrect. Trop de tentatives : réessayez dans ${POLICY.backupCodeLockMinutes} minutes.` : `Code de secours incorrect. Il vous reste ${POLICY.backupCodeMaxAttempts - failed} essai(s).`);
  }
  db.update((d) => {
    const b = d.clients[clientId].backupCode!;
    b.failed = 0;
    b.lockedUntil = undefined;
  });
}
