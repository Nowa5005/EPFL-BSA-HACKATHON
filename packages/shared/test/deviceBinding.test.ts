// #11 — device key K1 bound to the passkey (WebAuthn PRF) + password. The PRF output is SIMULATED here
// (TEST_ONLY_simulatePrf mirrors what the authenticator computes: HMAC(credential secret, hmac-secret salt)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, encryptKeystoreJson, getBytes, hexlify, randomBytes } from 'ethers';
import { TEST_ONLY_simulatePrf, bindKeystoreWithPrf, newPrfSalt, parsePrfBoundKeystore, unbindKeystoreWithPrf } from '../src/index';

const PW = 'Wallet-password-2026!';
const CRED = 'ZGV2aWNlLXBhc3NrZXktY3JlZGVudGlhbA';
const SECRET = hexlify(randomBytes(32)); // the authenticator's per-credential secret (never leaves the hardware)

async function setup() {
  const k1 = Wallet.createRandom();
  const keystore = await encryptKeystoreJson({ address: k1.address, privateKey: k1.privateKey }, PW, { scrypt: { N: 1 << 10 } });
  const prfSalt = newPrfSalt();
  const prf = TEST_ONLY_simulatePrf(SECRET, prfSalt);
  const rec = await bindKeystoreWithPrf({ keystore, prfOutput: prf, credentialId: CRED, rpId: 'localhost', prfSalt });
  return { k1, keystore, prfSalt, rec };
}

test('passkey PRF + password → K1', async () => {
  const { k1, prfSalt, rec } = await setup();
  assert.equal(rec.address, k1.address);
  assert.ok(parsePrfBoundKeystore(JSON.parse(JSON.stringify(rec))));
  // Same credential + same per-wallet salt → same PRF output on every unlock.
  const json = await unbindKeystoreWithPrf(rec, TEST_ONLY_simulatePrf(SECRET, prfSalt));
  const w = await Wallet.fromEncryptedJson(json, PW);
  assert.equal(w.address, k1.address);
});

test('wrong passkey (other credential secret) or wrong salt → refused', async () => {
  const { prfSalt, rec } = await setup();
  await assert.rejects(unbindKeystoreWithPrf(rec, TEST_ONLY_simulatePrf(hexlify(randomBytes(32)), prfSalt)), /cannot open the device key/);
  await assert.rejects(unbindKeystoreWithPrf(rec, TEST_ONLY_simulatePrf(SECRET, newPrfSalt())), /cannot open the device key/);
  await assert.rejects(unbindKeystoreWithPrf(rec, new Uint8Array(32)), /cannot open the device key/);
});

test('password alone (stolen copy of the stored record) → useless', async () => {
  const { rec } = await setup();
  // The stored record contains no keystore: the password has nothing to decrypt.
  await assert.rejects(Wallet.fromEncryptedJson(JSON.stringify(rec), PW));
  assert.ok(!JSON.stringify(rec).includes('"crypto"'));
});

test('right passkey but wrong password → refused (both factors are needed)', async () => {
  const { prfSalt, rec } = await setup();
  const json = await unbindKeystoreWithPrf(rec, TEST_ONLY_simulatePrf(SECRET, prfSalt));
  await assert.rejects(Wallet.fromEncryptedJson(json, 'not-the-password'));
});

test('tampered record (credential id, address, ciphertext) → refused', async () => {
  const { prfSalt, rec } = await setup();
  const prf = TEST_ONLY_simulatePrf(SECRET, prfSalt);
  await assert.rejects(unbindKeystoreWithPrf({ ...rec, credentialId: 'b3RoZXItY3JlZGVudGlhbC1pZA' }, prf));
  await assert.rejects(unbindKeystoreWithPrf({ ...rec, address: Wallet.createRandom().address }, prf));
  const ct = getBytes(rec.ciphertext);
  ct[5] ^= 1;
  await assert.rejects(unbindKeystoreWithPrf({ ...rec, ciphertext: hexlify(ct) }, prf));
  assert.equal(parsePrfBoundKeystore({ ...rec, kind: 'other' }), null);
  assert.equal(parsePrfBoundKeystore({ ...rec, iv: '0x00' }), null);
});
