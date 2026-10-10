// #16 — decoy session opened by the duress code: fictitious data only, nothing real can be done, no trace kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { decoyActive, decoyDevice, decoyKey, decoyPassThrough, decoyRequest, duressProof, endDecoy, isDecoyCode, startDecoy } from '../src/lib/decoy';

const realDevice = { clientId: 'CH-100235', safeAddress: '0x6AF9EF3437Cc6725C1d69eF508D2016b5f496481', deviceAddress: '0x1111111111111111111111111111111111111111', keystore: '{"secret":"real-keystore"}', credentialId: 'cred', deviceType: 'desktop' as const, createdAt: '2026-10-01T00:00:00Z', paperShareEnc: { v: 1 } as any };
const realSession = { token: 'tok', clientId: 'CH-100235', profile: { name: 'Bruno Beispiel', firstName: 'Bruno', lastName: 'Beispiel', email: 'b@example.ch', accounts: { CHF: 8120, USDC: 500 }, kyc: { address: 'Bahnhofstrasse 1, 8001 Zürich', idDocument: 'Swiss passport S7654321' } } };

test('duress proof: deterministic per client, differs between clients and codes (scrypt on the device)', async () => {
  const a = await duressProof('CH-1', 'blue-river-42');
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.equal(a, await duressProof('CH-1', 'blue-river-42'));
  assert.notEqual(a, await duressProof('CH-2', 'blue-river-42'));
  assert.notEqual(a, await duressProof('CH-1', 'blue-river-43'));
});

test('decoy: plausible fictitious wallet, no real address, balance, key, contact or KYC data', async () => {
  const key = Wallet.createRandom();
  startDecoy({ device: realDevice, session: realSession, code: 'blue-river-42', key, preferences: { accent: 'blue' } });
  assert.equal(decoyActive(), true);
  const d = decoyDevice()!;
  assert.equal(d.clientId, realDevice.clientId);
  assert.notEqual(d.safeAddress, realDevice.safeAddress);
  assert.equal(d.keystore, '');
  assert.equal(d.paperShareEnc, undefined);
  assert.equal(decoyKey()!.address, key.address);
  const client = await decoyRequest('cosigner', 'GET', '/clients/CH-100235');
  const onchain = await decoyRequest('cosigner', 'GET', '/clients/CH-100235/onchain');
  const txs = await decoyRequest('cosigner', 'GET', '/clients/CH-100235/wallet-txs');
  const bankProfile = await decoyRequest('bank', 'GET', '/clients/CH-100235');
  assert.equal(client.frozen, false); // nothing reveals the (real) freeze
  assert.equal(client.preferences.accent, 'blue'); // same look as the real session
  assert.ok(Number(onchain.usdc) > 0 && Number(onchain.usdc) < 1000);
  assert.ok(onchain.owners.includes(key.address));
  assert.ok(txs.length >= 3 && txs.every((t: any) => !t.txHash));
  const all = JSON.stringify({ client, onchain, txs, bankProfile, d });
  for (const real of [realDevice.safeAddress, 'real-keystore', '8120', 'Bahnhofstrasse', 'S7654321', 'decoy', 'duress']) assert.equal(all.includes(real), false, real);
  // the same decoy every time for this client (consistent if opened again)
  assert.equal((await decoyRequest('cosigner', 'GET', '/clients/CH-100235/onchain')).safeAddress, onchain.safeAddress);
});

test('decoy: anything that would move or reveal value fails like a busy service; passkeys and config pass through', async () => {
  await assert.rejects(decoyRequest('cosigner', 'POST', '/tx/prepare', { safeTx: {} }), (e: any) => e.status === 503);
  await assert.rejects(decoyRequest('cosigner', 'POST', '/clients/CH-100235/freeze', { frozen: false }), (e: any) => e.status === 503);
  await assert.rejects(decoyRequest('bank', 'POST', '/clients/CH-100235/transfer-to-wallet', { amount: 5 }), (e: any) => e.status === 503);
  await assert.rejects(decoyRequest('partner', 'POST', '/sessions', {}), (e: any) => e.status === 503);
  assert.equal(decoyPassThrough('POST', '/webauthn/auth/options'), true);
  assert.equal(decoyPassThrough('GET', '/clients/CH-100235/terms'), true);
  assert.equal(decoyPassThrough('GET', '/clients/CH-100235/activity'), false);
  assert.equal(decoyPassThrough('POST', '/tx/submit'), false);
  // the code typed again keeps the same session; the real password does not open anything here
  assert.equal(isDecoyCode('blue-river-42'), true);
  assert.equal(isDecoyCode('real-password'), false);
  endDecoy();
  assert.equal(decoyActive(), false);
  assert.equal(decoyDevice(), null);
});
