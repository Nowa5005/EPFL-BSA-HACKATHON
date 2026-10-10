import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, hashMessage } from 'ethers';

process.env.SIWE_ALLOWED_ORIGINS = 'http://localhost:5173';
const { buildSiweMessage, createChallenge, parseSiweMessage, verifySiwe, METHOD_1271, METHOD_EOA, SiweError } = await import('../src/siwe');

const SEPOLIA = 11155111;
const never1271 = async () => false;
const t0 = new Date('2026-10-10T12:00:00Z');
const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof SiweError, String(e));
    return (e as InstanceType<typeof SiweError>).code;
  }
  return 'ok';
};

test('challenge: EIP-4361 fields (domain, uri, address, chain, nonce, issuedAt, 5-min expiry, statement) round-trip', () => {
  const w = Wallet.createRandom();
  const ch = createChallenge('CH-1', w.address.toLowerCase(), SEPOLIA, 'http://localhost:5173', t0);
  const f = parseSiweMessage(ch.message);
  assert.equal(f.domain, 'localhost:5173');
  assert.equal(f.uri, 'http://localhost:5173');
  assert.equal(f.address, w.address); // checksummed
  assert.equal(f.chainId, SEPOLIA);
  assert.equal(f.nonce, ch.nonce);
  assert.match(ch.nonce, /^[a-f0-9]{32}$/);
  assert.equal(f.issuedAt, t0.toISOString());
  assert.equal(new Date(f.expirationTime!).getTime() - t0.getTime(), 300_000);
  assert.match(f.statement!, /not a transaction/);
  assert.match(f.statement!, /never ask for your seed phrase or private key/);
  assert.equal(buildSiweMessage(f), ch.message);
  assert.notEqual(createChallenge('CH-1', w.address, SEPOLIA, 'http://localhost:5173', t0).nonce, ch.nonce);
});

test('challenge refuses unknown origins and other networks', () => {
  const a = Wallet.createRandom().address;
  assert.throws(() => createChallenge('CH-1', a, SEPOLIA, 'https://evil.example'), /Origin/);
  assert.throws(() => createChallenge('CH-1', a, 1, 'http://localhost:5173'), /network/);
  assert.throws(() => createChallenge('CH-1', '0x1234', SEPOLIA, 'http://localhost:5173'), /address/);
});

test('valid EOA personal_sign signature is accepted', async () => {
  const w = Wallet.createRandom();
  const ch = createChallenge('CH-1', w.address, SEPOLIA, 'http://localhost:5173', t0);
  const sig = await w.signMessage(ch.message);
  const r = await verifySiwe(ch, ch.message, sig, at(10), never1271);
  assert.equal(r.method, METHOD_EOA);
  assert.equal(r.address, w.address);
});

test('signature by another key, expired challenge, tampered message are refused', async () => {
  const w = Wallet.createRandom();
  const other = Wallet.createRandom();
  const ch = createChallenge('CH-1', w.address, SEPOLIA, 'http://localhost:5173', t0);
  assert.equal(await code(verifySiwe(ch, ch.message, await other.signMessage(ch.message), at(10), never1271)), 'signature');
  assert.equal(await code(verifySiwe(ch, ch.message, await w.signMessage(ch.message), at(301), never1271)), 'expired');
  const tampered = ch.message.replace('Signing is free', 'Signing is cheap');
  assert.equal(await code(verifySiwe(ch, tampered, await w.signMessage(tampered), at(10), never1271)), 'tampered');
  assert.equal(await code(verifySiwe(ch, ch.message + '\nextra', await w.signMessage(ch.message), at(10), never1271)), 'malformed');
});

test('wrong address / domain / chain / nonce in the signed message are refused', async () => {
  const w = Wallet.createRandom();
  const ch = createChallenge('CH-1', w.address, SEPOLIA, 'http://localhost:5173', t0);
  const f = parseSiweMessage(ch.message);
  const variants: [string, string][] = [
    [buildSiweMessage({ ...f, address: Wallet.createRandom().address }), 'mismatch-address'],
    [buildSiweMessage({ ...f, domain: 'evil.example' }), 'mismatch-domain'],
    [buildSiweMessage({ ...f, chainId: 1 }), 'mismatch-chain'],
    [buildSiweMessage({ ...f, nonce: 'abcdef0123456789' }), 'mismatch-nonce'],
  ];
  for (const [m, expected] of variants) assert.equal(await code(verifySiwe(ch, m, await w.signMessage(m), at(10), never1271)), expected);
});

test('contract account (EIP-1271) path: accepted only when isValidSignature returns the magic value for hashMessage(message)', async () => {
  const safe = Wallet.createRandom().address; // stands for a contract account
  const ch = createChallenge('CH-1', safe, SEPOLIA, 'http://localhost:5173', t0);
  const contractSig = '0x' + 'ab'.repeat(130); // packed multi-owner signature (not a 65-byte EOA signature)
  let seen: { address: string; hash: string; sig: string } | null = null;
  const mock = async (address: string, hash: string, sig: string) => {
    seen = { address, hash, sig };
    return sig === contractSig;
  };
  const r = await verifySiwe(ch, ch.message, contractSig, at(10), mock);
  assert.equal(r.method, METHOD_1271);
  assert.deepEqual(seen, { address: safe, hash: hashMessage(ch.message), sig: contractSig });
  assert.equal(await code(verifySiwe(ch, ch.message, '0x' + 'cd'.repeat(130), at(10), mock)), 'signature');
});
