// #20 (part D) / #23 — same Safe address on another EVM chain + Bitcoin 2-of-3 P2WSH multisig (signet).
// Offline tests: fixed vectors, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZeroAddress, getAddress } from 'ethers';
import { SAFE_L2_SINGLETON, SAFE_PROXY_FACTORY, safeIface, setupInitializer } from '../src/index';
import { chainIndependenceIssues, decodeSafeDeploymentTx, decodeSetupInitializer, predictSafeProxyAddress, redeployCalldata } from '../src/multichain';
import { buildPsbt, deriveBtcKey, finalizePsbt, multisig2of3, signPsbt, signatureCount, toHex, type Utxo } from '../src/bitcoin';

// Safe v1.4.1 SafeProxyFactory.proxyCreationCode() — identical on Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia.
const PROXY_CREATION_CODE =
  '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564';

// A real test wallet deployed on Sepolia by the co-signer (tx 0xf0448b6b…58f1), verified by `npm run redeploy -- 84532`.
const VECTOR = {
  owners: ['0xa2666EDac12a5696dBE461D17cbEc27629486d66', '0x819879f341A00b4191CD43CF104E41D78C4b93B8', '0x4Ecf0B4f7B039bD00EEc76B5437322dB213d4823'],
  saltNonce: 1900911124855437537n,
  safe: '0xa246bA5FeBfb3D4130d832F0E41E31C1680C7020',
};

test('#20 D: predicted Safe address equals the deployed Sepolia address (chain-independent inputs)', () => {
  const d = { factory: SAFE_PROXY_FACTORY, singleton: SAFE_L2_SINGLETON, initializer: setupInitializer(VECTOR.owners), saltNonce: VECTOR.saltNonce };
  assert.equal(predictSafeProxyAddress(d, PROXY_CREATION_CODE), getAddress(VECTOR.safe));
  assert.deepEqual(chainIndependenceIssues(d), []);
  // another salt → another address
  assert.notEqual(predictSafeProxyAddress({ ...d, saltNonce: d.saltNonce + 1n }, PROXY_CREATION_CODE), getAddress(VECTOR.safe));
});

test('#20 D: deployment tx round-trips (decode what the co-signer sent, re-encode for the target chain)', () => {
  const d = { factory: SAFE_PROXY_FACTORY, singleton: SAFE_L2_SINGLETON, initializer: setupInitializer(VECTOR.owners), saltNonce: VECTOR.saltNonce };
  const back = decodeSafeDeploymentTx({ to: SAFE_PROXY_FACTORY, data: redeployCalldata(d) });
  assert.deepEqual(back, d);
  assert.deepEqual(decodeSetupInitializer(d.initializer).owners, VECTOR.owners.map((o) => getAddress(o)));
  assert.throws(() => decodeSafeDeploymentTx({ to: null, data: '0x' }));
});

test('#20 D: modules/guard or a refund inside setup() are flagged as chain-specific', () => {
  const withModules = safeIface.encodeFunctionData('setup', [VECTOR.owners, 2, '0x000000000000000000000000000000000000dEaD', '0x1234', '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99', ZeroAddress, 0, ZeroAddress]);
  const issues = chainIndependenceIssues({ factory: SAFE_PROXY_FACTORY, singleton: SAFE_L2_SINGLETON, initializer: withModules, saltNonce: 1n });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /delegatecall/);
  const otherSingleton = chainIndependenceIssues({ factory: SAFE_PROXY_FACTORY, singleton: ZeroAddress, initializer: setupInitializer(VECTOR.owners), saltNonce: 1n });
  assert.match(otherSingleton[0], /singleton/);
});

// ───────────────────────────── Bitcoin ─────────────────────────────

const ETH = { K1: '0x' + '11'.repeat(32), K2: '0x' + '22'.repeat(32), K3: '0x' + '33'.repeat(32) };
const BTC_VECTOR = {
  pubkeys: {
    K1: '023913d41df294e0aa205343b7f89eb1e71ea8009aa85e3f8dd6ae7fffbfaa2eb7',
    K2: '034d311964e1fcca3d7ca52a5081423c8eb754a4f71a18a94b60658e5498f4b295',
    K3: '03746e949df0d5786b56741e7bfabdc5861f22691b1abebde133d2512e7590458f',
  },
  address: 'tb1qnfgefcztj2wwxnhsf6txkucxad0adyl67f5e3dr3ar5uzsyals7qhhwscl',
};
const keys = () => ({ K1: deriveBtcKey(ETH.K1, 'K1'), K2: deriveBtcKey(ETH.K2, 'K2'), K3: deriveBtcKey(ETH.K3, 'K3') });

test('#23: BTC role keys are derived deterministically (HKDF, domain-separated) — fixed vectors', () => {
  const k = keys();
  for (const r of ['K1', 'K2', 'K3'] as const) assert.equal(toHex(k[r].publicKey), BTC_VECTOR.pubkeys[r]);
  // never the ETH key itself, and role / network / index are separated
  assert.notEqual(toHex(k.K1.privateKey!), ETH.K1.slice(2));
  assert.notEqual(toHex(deriveBtcKey(ETH.K1, 'K2').publicKey), BTC_VECTOR.pubkeys.K1);
  assert.notEqual(toHex(deriveBtcKey(ETH.K1, 'K1', 'testnet').publicKey), BTC_VECTOR.pubkeys.K1);
  assert.notEqual(toHex(deriveBtcKey(ETH.K1, 'K1', 'signet', 1).publicKey), BTC_VECTOR.pubkeys.K1);
});

test('#23: 2-of-3 P2WSH address is deterministic and independent of key order (BIP67)', () => {
  const k = keys();
  const a = multisig2of3([k.K1.publicKey, k.K2.publicKey, k.K3.publicKey]);
  const b = multisig2of3([k.K3.publicKey, k.K1.publicKey, k.K2.publicKey]);
  assert.equal(a.address, BTC_VECTOR.address);
  assert.equal(b.address, a.address);
  assert.match(a.address, /^tb1q[0-9a-z]{58}$/); // P2WSH = 32-byte witness program
  assert.throws(() => multisig2of3([k.K1.publicKey, k.K1.publicKey, k.K2.publicKey]), /distinct/);
});

const FAKE_UTXOS: Utxo[] = [
  { txid: 'aa'.repeat(32), vout: 0, value: 60_000n },
  { txid: 'bb'.repeat(32), vout: 1, value: 40_000n },
];

test('#23: send = PSBT signed by K1 then K2 → finalizes; one signature is not enough', () => {
  const k = keys();
  const ms = multisig2of3([k.K1.publicKey, k.K2.publicKey, k.K3.publicKey]);
  const dest = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'; // BIP173 test vector (testnet P2WPKH)
  const { psbt, fee, sent, change } = buildPsbt({ utxos: FAKE_UTXOS, from: ms, to: dest, amount: 25_000n, feeRateSatVb: 2 });
  assert.equal(sent + change + fee, 100_000n);
  const afterK1 = signPsbt(psbt.toBase64(), k.K1);
  assert.equal(signatureCount(afterK1), 1);
  assert.throws(() => finalizePsbt(afterK1)); // K1 alone cannot spend
  const afterK2 = signPsbt(afterK1, k.K2);
  assert.equal(signatureCount(afterK2), 2);
  const tx = finalizePsbt(afterK2);
  assert.match(tx.txid, /^[0-9a-f]{64}$/);
  assert.ok(tx.vsize <= Math.ceil(10.5 + 2 * 104.5 + 2 * 43) + 2, `vsize ${tx.vsize} within the fee estimate`);
});

test('#23: a key outside the multisig cannot sign', () => {
  const k = keys();
  const ms = multisig2of3([k.K1.publicKey, k.K2.publicKey, k.K3.publicKey]);
  const { psbt } = buildPsbt({ utxos: FAKE_UTXOS, from: ms, to: ms.address, amount: 10_000n, feeRateSatVb: 1 });
  const stranger = deriveBtcKey('0x' + '44'.repeat(32), 'K1');
  assert.throws(() => signPsbt(psbt.toBase64(), stranger));
});

test('#23: recovery = sweep everything (K2 + K3) to a new multisig built with the new device key', () => {
  const k = keys();
  const old = multisig2of3([k.K1.publicKey, k.K2.publicKey, k.K3.publicKey]);
  const newK1 = deriveBtcKey('0x' + '55'.repeat(32), 'K1');
  const fresh = multisig2of3([newK1.publicKey, k.K2.publicKey, k.K3.publicKey]);
  assert.notEqual(fresh.address, old.address); // no swapOwner in Bitcoin: the address changes
  const { psbt, sent, fee, change } = buildPsbt({ utxos: FAKE_UTXOS, from: old, to: fresh.address, feeRateSatVb: 2 });
  assert.equal(change, 0n);
  assert.equal(sent + fee, 100_000n);
  const signed = signPsbt(signPsbt(psbt.toBase64(), k.K3), k.K2);
  assert.match(finalizePsbt(signed).hex, /^02000000/);
});
