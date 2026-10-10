// #23 — Bitcoin with the same 3-key custody model, without MPC: a native 2-of-3 P2WSH multisig on signet.
// Server/script side only (Node): tiny-secp256k1 is a WASM build — this module is NOT re-exported by index.ts.
//
// Libraries only (no custom crypto): bitcoinjs-lib (scripts, PSBT/BIP174, signatures), tiny-secp256k1 + ecpair
// (secp256k1), node:crypto HKDF-SHA256 (RFC 5869) for the key derivation below.
//
// Keys — one BTC key per role, DERIVED from the same-role Ethereum key with HKDF (never the ETH key itself):
//   btcKey(role) = HKDF-SHA256(ikm = ETH private key of that role, salt = "MyWall/BTC/v1", info = "<role>/<network>/<index>")
//   K1 (device)      ← K1 ETH key (inside the passkey-bound keystore, on the client's device)
//   K2 (Swissquote)  ← K2 ETH key of that client (co-signer vault)
//   K3 (recovery)    ← K3 ETH key, rebuilt from the same Shamir recovery kit — so the existing kit also recovers BTC
// One-way: a leaked BTC key reveals nothing about the ETH key; a leaked ETH key of a role exposes that role's BTC key
// (same trust boundary, same holder). Production alternative: independent BIP32 seeds per role (docs/MULTICHAIN_BITCOIN.md).
//
// Spending: PSBT signed by K1 (device) then K2 (co-signer, after its policy checks) → finalized → broadcast.
// Recovery: Bitcoin has no swapOwner — the funds are SWEPT (K2 + K3) to a new multisig built with the new device key.

import { hkdfSync } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory, type ECPairInterface } from 'ecpair';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

export type BtcRole = 'K1' | 'K2' | 'K3';
export type BtcNetworkName = 'signet' | 'testnet' | 'regtest';

/** signet and testnet share the same address/key parameters (bech32 "tb"). */
export function btcNetwork(name: BtcNetworkName): bitcoin.Network {
  return name === 'regtest' ? bitcoin.networks.regtest : bitcoin.networks.testnet;
}

/** Public Esplora API (mempool.space) — no key needed. */
export const ESPLORA_URLS: Record<Exclude<BtcNetworkName, 'regtest'>, string> = {
  signet: 'https://mempool.space/signet/api',
  testnet: 'https://mempool.space/testnet4/api',
};

export const BTC_DERIVATION_SALT = 'MyWall/BTC/v1';

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
export const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Deterministic BTC key for a role, derived from that role's Ethereum private key (see header). */
export function deriveBtcKey(ethPrivateKey: string, role: BtcRole, network: BtcNetworkName = 'signet', index = 0): ECPairInterface {
  const ikm = hexToBytes(ethPrivateKey);
  if (ikm.length !== 32) throw new Error('Expected a 32-byte private key');
  // A 32-byte HKDF output is a valid secp256k1 scalar with probability 1 - 2^-128; retry with a counter just in case.
  for (let ctr = 0; ctr < 8; ctr++) {
    const okm = new Uint8Array(hkdfSync('sha256', ikm, BTC_DERIVATION_SALT, `${role}/${network}/${index}${ctr ? `/${ctr}` : ''}`, 32));
    if (ecc.isPrivate(okm)) return ECPair.fromPrivateKey(okm, { network: btcNetwork(network), compressed: true });
  }
  throw new Error('Key derivation failed');
}

export interface Multisig {
  address: string;
  /** P2WSH witness script: OP_2 <pk> <pk> <pk> OP_3 OP_CHECKMULTISIG (keys sorted, BIP67) */
  witnessScript: Uint8Array;
  /** scriptPubKey of the address (OP_0 <sha256(witnessScript)>) */
  output: Uint8Array;
  /** compressed public keys in script order */
  pubkeys: Uint8Array[];
}

/** 2-of-3 native SegWit multisig (P2WSH). Public keys are sorted (BIP67) so the address doesn't depend on role order. */
export function multisig2of3(pubkeys: Uint8Array[], network: BtcNetworkName = 'signet'): Multisig {
  if (pubkeys.length !== 3) throw new Error('Exactly 3 public keys');
  const sorted = [...pubkeys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (new Set(sorted.map(toHex)).size !== 3) throw new Error('The 3 keys must be distinct');
  const net = btcNetwork(network);
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sorted, network: net });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: net });
  return { address: p2wsh.address!, witnessScript: p2ms.output!, output: p2wsh.output!, pubkeys: sorted };
}

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
}

/** vsize estimate of a P2WSH 2-of-3 spend: ~104.5 vB per input, 43 vB per P2WSH output, 10.5 vB overhead. */
export function estimateVsize(inputs: number, outputs: number): number {
  return Math.ceil(10.5 + inputs * 104.5 + outputs * 43);
}

export const DUST_SAT = 330n;

export interface SpendPlan {
  utxos: Utxo[];
  from: Multisig;
  to: string;
  /** amount to send in sats; omit to sweep everything (recovery) */
  amount?: bigint;
  /** change back to this address (defaults to the sending multisig) */
  changeAddress?: string;
  feeRateSatVb: number;
  network?: BtcNetworkName;
}

/** Builds an unsigned PSBT (BIP174) spending multisig UTXOs. */
export function buildPsbt(p: SpendPlan): { psbt: bitcoin.Psbt; fee: bigint; sent: bigint; change: bigint } {
  const net = btcNetwork(p.network ?? 'signet');
  if (!p.utxos.length) throw new Error('No UTXO to spend');
  const total = p.utxos.reduce((s, u) => s + u.value, 0n);
  const psbt = new bitcoin.Psbt({ network: net });
  for (const u of p.utxos)
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: p.from.output, value: u.value }, witnessScript: p.from.witnessScript });
  const sweep = p.amount === undefined;
  let fee = BigInt(Math.ceil(estimateVsize(p.utxos.length, sweep ? 1 : 2) * p.feeRateSatVb));
  let sent = sweep ? total - fee : p.amount!;
  let change = sweep ? 0n : total - sent - fee;
  if (!sweep && change < DUST_SAT) {
    // no change output: the remainder goes to fees
    fee = total - sent;
    change = 0n;
  }
  if (sent < DUST_SAT) throw new Error('Amount below dust / not enough to pay the fee');
  if (change < 0n) throw new Error('Insufficient funds');
  psbt.addOutput({ address: p.to, value: sent });
  if (change > 0n) psbt.addOutput({ address: p.changeAddress ?? p.from.address, value: change });
  return { psbt, fee, sent, change };
}

/** Adds one key's signatures to every input (K1 on the device, K2 in the co-signer, K3 at recovery). */
export function signPsbt(psbtBase64: string, key: ECPairInterface, network: BtcNetworkName = 'signet'): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNetwork(network) });
  psbt.signAllInputs(key);
  if (!psbt.validateSignaturesOfAllInputs((pubkey, msghash, signature) => ecc.verify(msghash, pubkey, signature))) throw new Error('Invalid signature');
  return psbt.toBase64();
}

/** Number of distinct signatures already present on input 0. */
export function signatureCount(psbtBase64: string, network: BtcNetworkName = 'signet'): number {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNetwork(network) });
  return psbt.data.inputs[0]?.partialSig?.length ?? 0;
}

/** Finalizes (needs 2 signatures per input) and returns the raw transaction hex + txid. */
export function finalizePsbt(psbtBase64: string, network: BtcNetworkName = 'signet'): { hex: string; txid: string; vsize: number } {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNetwork(network) });
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { hex: tx.toHex(), txid: tx.getId(), vsize: tx.virtualSize() };
}

// ── Esplora (mempool.space) ──

export async function fetchUtxos(address: string, network: Exclude<BtcNetworkName, 'regtest'> = 'signet'): Promise<Utxo[]> {
  const r = await fetch(`${ESPLORA_URLS[network]}/address/${address}/utxo`);
  if (!r.ok) throw new Error(`Esplora ${r.status}`);
  const list = (await r.json()) as { txid: string; vout: number; value: number }[];
  return list.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value) }));
}

export async function fetchBalance(address: string, network: Exclude<BtcNetworkName, 'regtest'> = 'signet'): Promise<{ confirmed: bigint; unconfirmed: bigint }> {
  const r = await fetch(`${ESPLORA_URLS[network]}/address/${address}`);
  if (!r.ok) throw new Error(`Esplora ${r.status}`);
  const j = (await r.json()) as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number } };
  return {
    confirmed: BigInt(j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum),
    unconfirmed: BigInt(j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum),
  };
}

export async function fetchFeeRate(network: Exclude<BtcNetworkName, 'regtest'> = 'signet'): Promise<number> {
  const r = await fetch(`${ESPLORA_URLS[network]}/v1/fees/recommended`);
  if (!r.ok) return 2;
  const j = (await r.json()) as { halfHourFee?: number };
  return Math.max(1, j.halfHourFee ?? 2);
}

export async function broadcastTx(hex: string, network: Exclude<BtcNetworkName, 'regtest'> = 'signet'): Promise<string> {
  const r = await fetch(`${ESPLORA_URLS[network]}/tx`, { method: 'POST', body: hex });
  const text = await r.text();
  if (!r.ok) throw new Error(`Broadcast refused: ${text}`);
  return text; // txid
}

export function explorerBtcAddress(address: string, network: Exclude<BtcNetworkName, 'regtest'> = 'signet') {
  return `https://mempool.space/${network === 'signet' ? 'signet' : 'testnet4'}/address/${address}`;
}
