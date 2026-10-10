// Confirmation previews: each simulation shown to the client is bound to ONE exact SafeTx, has a short validity,
// and can be used for a single submission. The passkey challenge is derived from it (domain tag, chain id,
// Safe address, SafeTx hash, nonce and preview id), so an assertion cannot be replayed on anything else.

import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import { CHAIN_ID, POLICY, type SafeTx } from '@sq/shared';
import { newId, nowIso } from '@sq/shared/server';
import { db, HttpError, type Preview } from './db';
import { canonicalSafeTx, sameSafeTx } from './validate';

const TTL_SEC = Number(process.env.PREVIEW_TTL_SEC ?? POLICY.previewTtlSec);

export function challengeFor(p: { id: string; safeAddress: string; safeTxHash: string; safeTx: SafeTx }) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'address', 'bytes32', 'uint256', 'bytes32'],
      ['MyWall/cosign/v1', CHAIN_ID, p.safeAddress, p.safeTxHash, BigInt(p.safeTx.nonce), keccak256(toUtf8Bytes(p.id))],
    ),
  );
}

export function createPreview(input: Omit<Preview, 'id' | 'challenge' | 'createdAt' | 'expiresAt' | 'used'>): Preview {
  const id = newId();
  const base = { ...input, id, safeTx: canonicalSafeTx(input.safeTx) };
  const p: Preview = { ...base, challenge: challengeFor(base), createdAt: nowIso(), expiresAt: new Date(Date.now() + TTL_SEC * 1000).toISOString(), used: false };
  db.update((d) => {
    d.previews ??= {};
    // keep the store small: drop expired previews
    for (const [k, v] of Object.entries(d.previews)) if (new Date(v.expiresAt).getTime() < Date.now() - 3600_000) delete d.previews[k];
    d.previews[id] = p;
  });
  return p;
}

/**
 * Loads a preview for submission and CONSUMES it (single use). Refuses: unknown / other client, already used,
 * expired, or a SafeTx that differs in any byte from the one that was simulated and shown.
 */
export function consumePreview(previewId: string, clientId: string, submitted?: SafeTx): Preview {
  const p = db.data.previews?.[previewId];
  if (!p || p.clientId !== clientId) throw new HttpError(404, 'Aperçu introuvable : relancez la vérification.');
  if (p.used) throw new HttpError(409, 'Cet aperçu a déjà été utilisé. Vérifiez à nouveau l’opération.', { code: 'preview-used' });
  if (new Date(p.expiresAt).getTime() < Date.now()) throw new HttpError(410, 'L’aperçu a expiré : les conditions ont été recalculées, confirmez à nouveau.', { code: 'preview-expired' });
  if (submitted && !sameSafeTx(submitted, p.safeTx))
    throw new HttpError(409, 'La transaction a été modifiée après sa validation : elle est refusée.', { code: 'tx-modified' });
  db.update((d) => (d.previews![previewId].used = true));
  return p;
}
