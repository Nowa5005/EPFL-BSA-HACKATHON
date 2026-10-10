// Recovery key K3: split / reconstruct (2-of-N) and share ② protection (physical security key via WebAuthn PRF,
// or offline file with a distinct backup password). The PRF output is SIMULATED here (TEST_ONLY_simulatePrf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, getBytes, hexlify, randomBytes } from 'ethers';
import {
  TEST_ONLY_simulatePrf,
  combineShares,
  decodeRecoveryCode,
  decryptShareOffline,
  decryptShareWithPrf,
  encodeRecoveryCode,
  encryptShareOffline,
  encryptShareWithPrf,
  newPrfSalt,
  openWithPassword,
  parseShare2Record,
  prfHmacSecretSalt,
  reconstructK3FromShares,
  sealWithPassword,
  splitRecoveryKey,
  type SecurityKeyShare,
} from '../src/index';

const SAFE = '0x1111111111111111111111111111111111111111';
const CRED = 'Y3JlZGVudGlhbC1pZC1mb3ItdGVzdHM';
const WALLET_PW = 'Wallet-password-2026!';
const BACKUP_PW = 'Another backup phrase 42?';
const flip = (hex: string, at: number) => {
  const b = getBytes(hex);
  b[at] ^= 0x01;
  return hexlify(b);
};

test('split 2-of-3: every pair rebuilds K3, one share alone is refused', async () => {
  const k3 = Wallet.createRandom();
  const s = await splitRecoveryKey(k3.privateKey);
  assert.deepEqual(Object.keys(s), ['paper', 'key', 'partner']);
  for (const pair of [
    [s.paper, s.key],
    [s.paper, s.partner],
    [s.key, s.partner],
    [s.partner, s.paper],
  ]) {
    const w = await reconstructK3FromShares(pair, { expectedAddress: k3.address });
    assert.equal(w.address, k3.address);
  }
  await assert.rejects(reconstructK3FromShares([s.paper]), /Two parts/);
  await assert.rejects(reconstructK3FromShares([s.paper, null, undefined]), /Two parts/);
  await assert.rejects(combineShares([s.paper, s.paper]), /twice/);
});

test('reconstruct refuses parts of another (or an older) recovery key', async () => {
  const a = Wallet.createRandom();
  const b = Wallet.createRandom();
  const sa = await splitRecoveryKey(a.privateKey);
  const sb = await splitRecoveryKey(b.privateKey);
  await assert.rejects(reconstructK3FromShares([sb.paper, sb.partner], { expectedAddress: a.address }), /do not rebuild/);
  // mixing shares of two different splits never yields a valid key for either wallet
  await assert.rejects(reconstructK3FromShares([sa.paper, sb.partner], { expectedAddress: a.address }));
});

test('split is generic 2-of-N (trusted-contact hook): 2-of-4, every pair works', async () => {
  const k3 = Wallet.createRandom();
  const s = await splitRecoveryKey(k3.privateKey, ['paper', 'key', 'partner', 'contact'] as const);
  const all = Object.values(s);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) assert.equal((await reconstructK3FromShares([all[i], all[j]])).address, k3.address);
  assert.equal((await reconstructK3FromShares([s.partner, s.contact], { expectedAddress: k3.address })).address, k3.address);
});

test('paper code encoding is unchanged and carries a share', async () => {
  const s = await splitRecoveryKey(Wallet.createRandom().privateKey);
  const r = decodeRecoveryCode(encodeRecoveryCode(s.paper));
  assert.ok(r.ok);
  assert.equal(r.ok && r.share, s.paper);
});

test('share ② with a (simulated) security key: right key opens it, wrong key fails', async () => {
  const { key: share } = await splitRecoveryKey(Wallet.createRandom().privateKey);
  const prfSalt = newPrfSalt();
  const secret = hexlify(randomBytes(32));
  const rec = await encryptShareWithPrf({ safeAddress: SAFE, share, prfOutput: TEST_ONLY_simulatePrf(secret, prfSalt), credentialId: CRED, rpId: 'localhost', prfSalt });
  // nothing in clear in the stored record
  assert.ok(!JSON.stringify(rec).toLowerCase().includes(share.slice(2).toLowerCase()));
  assert.equal(parseShare2Record(JSON.stringify(rec)).method, 'security-key');
  assert.equal(await decryptShareWithPrf(rec, TEST_ONLY_simulatePrf(secret, prfSalt)), share);
  // another physical key (other credential secret) → refused
  await assert.rejects(decryptShareWithPrf(rec, TEST_ONLY_simulatePrf(hexlify(randomBytes(32)), prfSalt)), /cannot open/);
  // same key evaluated on another salt → refused
  await assert.rejects(decryptShareWithPrf(rec, TEST_ONLY_simulatePrf(secret, newPrfSalt())), /cannot open/);
});

test('share ② with a security key: tampered ciphertext / metadata fail', async () => {
  const { key: share } = await splitRecoveryKey(Wallet.createRandom().privateKey);
  const prfSalt = newPrfSalt();
  const secret = hexlify(randomBytes(32));
  const prf = TEST_ONLY_simulatePrf(secret, prfSalt);
  const rec = await encryptShareWithPrf({ safeAddress: SAFE, share, prfOutput: prf, credentialId: CRED, rpId: 'localhost', prfSalt });
  const tampered: SecurityKeyShare[] = [
    { ...rec, ciphertext: flip(rec.ciphertext, 3) },
    { ...rec, iv: flip(rec.iv, 0) },
    { ...rec, hkdfSalt: flip(rec.hkdfSalt, 0) },
    { ...rec, safeAddress: '0x2222222222222222222222222222222222222222' },
    { ...rec, credentialId: CRED.replace('Y', 'Z') },
  ];
  for (const t of tampered) await assert.rejects(decryptShareWithPrf(t, prf), /cannot open/);
});

test('PRF → hmac-secret salt follows WebAuthn L3 (deterministic, 32 bytes)', () => {
  const salt = newPrfSalt();
  assert.equal(getBytes(prfHmacSecretSalt(salt)).length, 32);
  assert.equal(prfHmacSecretSalt(salt), prfHmacSecretSalt(salt));
  assert.notEqual(prfHmacSecretSalt(salt), prfHmacSecretSalt(newPrfSalt()));
});

test('fallback offline file: right password opens it, wrong password / tampering fail', async () => {
  const { key: share } = await splitRecoveryKey(Wallet.createRandom().privateKey);
  const file = await encryptShareOffline(SAFE, share, BACKUP_PW, { walletPassword: WALLET_PW, scryptN: 1 << 14 });
  assert.equal(file.notice, 'Keep offline — never upload to a cloud');
  assert.equal(parseShare2Record(JSON.stringify(file)).method, 'offline-password');
  assert.ok(!JSON.stringify(file).toLowerCase().includes(share.slice(2).toLowerCase()));
  assert.equal(await decryptShareOffline(file, BACKUP_PW), share);
  await assert.rejects(decryptShareOffline(file, WALLET_PW), /Wrong backup password/);
  await assert.rejects(decryptShareOffline({ ...file, ciphertext: flip(file.ciphertext, 1) }, BACKUP_PW), /Wrong backup password/);
});

test('fallback offline file: backup password = wallet password (or too short) is refused', async () => {
  const share = hexlify(randomBytes(33));
  await assert.rejects(encryptShareOffline(SAFE, share, WALLET_PW, { walletPassword: WALLET_PW, scryptN: 1 << 14 }), /different from your wallet password/);
  await assert.rejects(encryptShareOffline(SAFE, share, ` ${WALLET_PW.toUpperCase()} `, { walletPassword: WALLET_PW, scryptN: 1 << 14 }), /different/);
  await assert.rejects(encryptShareOffline(SAFE, share, 'short-1A!', { walletPassword: WALLET_PW, scryptN: 1 << 14 }), /at least 15/);
  await assert.rejects(encryptShareOffline(SAFE, share, BACKUP_PW, { scryptN: 1000 }), /scrypt/);
});

test('parseShare2Record rejects anything that is not an encrypted part ②', () => {
  assert.throws(() => parseShare2Record('{"kind":"sqwallet-cloud-backup","version":1}'), /not a My Wall/);
  assert.throws(() => parseShare2Record({ kind: 'mywall-recovery-share2', version: 1, method: 'plain', safeAddress: SAFE, share: '0x01' }), /not a My Wall/);
});

test('device-sealed copy of the paper share (wallet password, local only)', async () => {
  const share = hexlify(randomBytes(33));
  const sealed = await sealWithPassword(SAFE, share, WALLET_PW);
  assert.equal(await openWithPassword(sealed, WALLET_PW), share);
  await assert.rejects(openWithPassword(sealed, BACKUP_PW), /Wrong password/);
});
