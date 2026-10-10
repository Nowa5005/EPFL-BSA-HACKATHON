// #14 — trusted contact: 2-of-4 split (paper · security key · partner · contact), invitation encryption, recovery
// health score. PRF output simulated (TEST_ONLY_simulatePrf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, hexlify, randomBytes, getBytes } from 'ethers';
import {
  CONTACT_SHARE_ORDER,
  TEST_ONLY_simulatePrf,
  assessRecoveryHealth,
  decodeRecoveryCode,
  decryptShareOffline,
  decryptShareWithPrf,
  encodeRecoveryCode,
  encryptShareOffline,
  encryptShareWithPrf,
  newPrfSalt,
  openInvitation,
  reconstructK3FromShares,
  sealInvitation,
  splitRecoveryKey,
  invitationLink,
} from '../src/index';

const SAFE = '0x1111111111111111111111111111111111111111';

test('2-of-4: every pair of the 4 parts rebuilds K3; a single part never does', async () => {
  const k3 = Wallet.createRandom();
  const s = await splitRecoveryKey(k3.privateKey, CONTACT_SHARE_ORDER);
  assert.deepEqual(Object.keys(s), ['paper', 'key', 'partner', 'contact']);
  const labels = [...CONTACT_SHARE_ORDER];
  let pairs = 0;
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const w = await reconstructK3FromShares([s[labels[i]], s[labels[j]]], { expectedAddress: k3.address });
      assert.equal(w.address, k3.address, `${labels[i]} + ${labels[j]}`);
      pairs++;
    }
  assert.equal(pairs, 6);
  // any 3 also work
  assert.equal((await reconstructK3FromShares([s.partner, s.contact, s.paper])).address, k3.address);
  for (const l of labels) await assert.rejects(reconstructK3FromShares([s[l]]), /Two parts/);
});

test('re-split with a NEW key K3′: old parts and new parts never mix, old pairs only rebuild the retired K3', async () => {
  const k3 = Wallet.createRandom();
  const old = await splitRecoveryKey(k3.privateKey);
  const k3b = Wallet.createRandom();
  const neu = await splitRecoveryKey(k3b.privateKey, CONTACT_SHARE_ORDER);
  await assert.rejects(reconstructK3FromShares([old.paper, neu.contact], { expectedAddress: k3b.address }), /wrong or outdated/);
  await assert.rejects(reconstructK3FromShares([old.partner, neu.contact], { expectedAddress: k3b.address }), /wrong or outdated/);
  // Old paper + old key still rebuild the OLD key — which is no longer an owner after the on-chain rotation.
  assert.equal((await reconstructK3FromShares([old.paper, old.key])).address, k3.address);
  assert.notEqual(k3.address, k3b.address);
});

test('contact part: code encoding, invitation (key in the #fragment), then contact passkey (PRF) or passphrase file', async () => {
  const k3 = Wallet.createRandom();
  const s = await splitRecoveryKey(k3.privateKey, CONTACT_SHARE_ORDER);
  // The contact reads the part as a code (same format and checksums as the paper code).
  const code = encodeRecoveryCode(s.contact);
  const dec = decodeRecoveryCode(code);
  assert.ok(dec.ok && dec.share === s.contact);
  // Invitation
  const inv = await sealInvitation(SAFE, s.contact);
  assert.ok(!inv.ciphertext.includes(s.contact.slice(2)));
  assert.equal(await openInvitation(SAFE, inv, inv.inviteKey), s.contact);
  await assert.rejects(openInvitation(SAFE, inv, hexlify(randomBytes(32))), /incomplete or was altered/);
  await assert.rejects(openInvitation('0x2222222222222222222222222222222222222222', inv, inv.inviteKey), /altered/);
  const ct = getBytes(inv.ciphertext);
  ct[0] ^= 1;
  await assert.rejects(openInvitation(SAFE, { iv: inv.iv, ciphertext: hexlify(ct) }, inv.inviteKey));
  const link = invitationLink('http://localhost:5173', 'tok123', inv.inviteKey);
  assert.equal(new URL(link).pathname, '/trusted/tok123');
  assert.equal(new URL(link).hash, `#k=${inv.inviteKey}`);
  // Contact protects it with their own passkey (PRF) …
  const secret = hexlify(randomBytes(32));
  const salt = newPrfSalt();
  const rec = await encryptShareWithPrf({ safeAddress: SAFE, share: s.contact, prfOutput: TEST_ONLY_simulatePrf(secret, salt), credentialId: 'Y29udGFjdC1jcmVkZW50aWFsLWlk', rpId: 'localhost', prfSalt: salt, label: 'trusted contact' });
  assert.equal(await decryptShareWithPrf(rec, TEST_ONLY_simulatePrf(secret, salt)), s.contact);
  await assert.rejects(decryptShareWithPrf(rec, TEST_ONLY_simulatePrf(hexlify(randomBytes(32)), salt)));
  // … or a passphrase file kept offline.
  const file = await encryptShareOffline(SAFE, s.contact, 'Our long shared passphrase 7!', { scryptN: 1 << 14 });
  assert.equal(await decryptShareOffline(file, 'Our long shared passphrase 7!'), s.contact);
  // partner + contact → K3 (the case the feature exists for: paper and security key both lost)
  assert.equal((await reconstructK3FromShares([s.partner, await decryptShareOffline(file, 'Our long shared passphrase 7!')], { expectedAddress: k3.address })).address, k3.address);
});

test('recovery health: Strong needs 3 working parts; old or outdated checks make it Weak', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const day = 24 * 3600_000;
  const period = 182 * day;
  const iso = (t: number) => new Date(t).toISOString();
  const base = { share2Method: 'security-key' as const, partnerEnrolled: true, kitSince: iso(now - 30 * day) };
  // Fresh kit, nothing checked, no contact → Weak (only the partner is "known")
  let h = assessRecoveryHealth({ ...base, contact: 'none' }, now, period);
  assert.equal(h.score, 'weak');
  assert.equal(h.workingParts, 1);
  assert.ok(h.reasons.find((r) => r.part === 'contact' && !r.ok && /partner alone/.test(r.en)));
  // paper + key checked → 3 working parts → Strong
  h = assessRecoveryHealth({ ...base, contact: 'none', paperVerifiedAt: iso(now - day), keyVerifiedAt: iso(now - day) }, now, period);
  assert.equal(h.score, 'strong');
  assert.equal(h.due, false);
  // paper only + confirmed contact → Strong too (paper, partner, contact)
  h = assessRecoveryHealth({ ...base, contact: 'accepted', paperVerifiedAt: iso(now - day), contactConfirmedAt: iso(now - day) }, now, period);
  assert.equal(h.score, 'strong');
  // contact of a former kit does not count
  h = assessRecoveryHealth({ ...base, contact: 'outdated', paperVerifiedAt: iso(now - day), contactConfirmedAt: iso(now - day) }, now, period);
  assert.equal(h.score, 'weak');
  // checks older than 6 months → Weak + due
  h = assessRecoveryHealth({ ...base, kitSince: iso(now - 400 * day), contact: 'none', paperVerifiedAt: iso(now - 200 * day), keyVerifiedAt: iso(now - 200 * day) }, now, period);
  assert.equal(h.score, 'weak');
  assert.equal(h.due, true);
  // a check made BEFORE the kit was replaced does not count for the new kit
  h = assessRecoveryHealth({ ...base, kitSince: iso(now - day), contact: 'none', paperVerifiedAt: iso(now - 2 * day), keyVerifiedAt: iso(now - 2 * day) }, now, period);
  assert.equal(h.score, 'weak');
  // offline-file wording
  h = assessRecoveryHealth({ ...base, share2Method: 'offline-password', contact: 'none' }, now, period);
  assert.match(h.reasons.find((r) => r.part === 'key')!.en, /backup password/);
});
