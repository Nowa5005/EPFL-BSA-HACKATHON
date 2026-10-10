// Headless end-to-end run of the ON-CHAIN PROTECTION layer on Ethereum Sepolia (SECURITY_GAPS_FIX §3):
// MyWallGuard + Zodiac Delay D1 / D2 on a fresh wallet created through the running services.
//   (setup) K1 + K2 batch: D1 + D2 + guard, emergency gas reserve on K3
//   (f) K1 + K2 normal transfer → immediate          (a) K2 + K3 direct → reverted by the guard (lab Safe, test K2)
//   (a') K1 + K3 direct → reverted by the guard      (c) veto: a queued operation is cancelled (K1 + K2, setTxNonce)
//   (d) K1 + K3 protected exit via D1 (submitted and executed by K3 alone, no Swissquote service)
//   (b) "I lost my device": swapOwner queued in D1 by K3 + K2, executed after the on-chain cooldown by the relayer
//   (e) K3 alone queues in D2, executes after D2's longer cooldown
// Delays are the co-signer's demo values (PROTECTION_D1_COOLDOWN_SEC=120, PROTECTION_D2_COOLDOWN_SEC=240 by default).
// Run with the services up: npm run e2e (runs e2e-demo then this script) or: npx tsx scripts/e2e-protection.ts

import fs from 'node:fs';
import { BaseWallet, Contract, NonceManager, Wallet, formatEther, parseEther, sha256, type Signer, type TransactionReceipt } from 'ethers';
import {
  RECOVERY_QUESTIONS,
  SAFE_ABI,
  SAFE_L2_SINGLETON,
  SAFE_PROXY_FACTORY,
  SAFE_PROXY_FACTORY_ABI,
  SERVICE_URLS,
  buildSafeTx,
  execArgs,
  explorerAddress,
  explorerTx,
  makeProvider,
  packSignatures,
  safeContract,
  setupInitializer,
  signSafeTx,
  splitRecoveryKey,
} from '@sq/shared';
import {
  DELAY_ABI,
  MYWALL_GUARD_ADDRESS,
  batchSafeTx,
  planProtectionSetup,
  queueInD1SafeTx,
  readDelayQueue,
  readProtection,
  recoveryQueueSafeTx,
  type InnerTx,
} from '@sq/shared/protection';
import { internalHeaders, loadDotenv } from '@sq/shared/server';

loadDotenv();
const provider = makeProvider();
const C = SERVICE_URLS.cosigner;
const P = SERVICE_URLS.partner;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (n: number | string, t: string) => console.log(`\n\x1b[1m\x1b[35m[P${n}] ${t}\x1b[0m`);
const ok = (t: string) => console.log(`  \x1b[32m✔\x1b[0m ${t}`);
const info = (t: string) => console.log(`  ${t}`);
const proof: Record<string, string> = {};

let sessionToken = '';
async function call<T = any>(method: 'GET' | 'POST', url: string, body?: unknown, expectError = false): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  const res = await fetch(url, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !expectError) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(json)}`);
  return { ...json, _status: res.status } as T;
}
/** Public RPC nodes lag behind each other (fresh balance / nonce): retry a send a few times. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i >= 6 || !/INSUFFICIENT_FUNDS|NONCE_EXPIRED|nonce too low|insufficient funds/i.test(String(e?.code ?? '') + (e?.message ?? ''))) throw e;
      await sleep(5000);
    }
  }
}
const errText = (e: any): string => [e?.reason, e?.shortMessage, e?.info?.error?.message, e?.message].filter(Boolean).join(' | ');

/** Public RPC nodes lag: read the Safe nonce until it reaches at least `min`. */
async function nonceAtLeast(safe: string, min = 0n) {
  for (let i = 0; i < 20; i++) {
    const n: bigint | null = await safeContract(safe, provider).nonce().catch(() => null); // not visible yet on this node
    if (n !== null && n >= min) return n;
    await sleep(2000);
  }
  throw new Error('RPC lagging behind');
}
async function waitUntil(label: string, unixSec: number) {
  while (Date.now() / 1000 < unixSec + 3) {
    process.stdout.write(`  … ${label}: ${Math.max(0, Math.round(unixSec + 3 - Date.now() / 1000))}s   \r`);
    await sleep(3000);
  }
  console.log();
}
/** Signs with the given owners and submits execTransaction from `payer` (its own ETH: no Swissquote). */
async function execDirect(safe: string, tx: ReturnType<typeof buildSafeTx>, keys: BaseWallet[], payer: Signer): Promise<TransactionReceipt> {
  const sigs = packSignatures(await Promise.all(keys.map(async (k) => ({ signer: k.address, signature: await signSafeTx(k, safe, tx) }))));
  const sent = await new Contract(safe, SAFE_ABI, payer).execTransaction(...execArgs(tx, sigs));
  const rc = await sent.wait();
  if (!rc || rc.status !== 1) throw new Error('execTransaction failed');
  return rc;
}
/** Expected refusal: the reason from eth_call, then (once) a real reverted transaction for the Etherscan proof. */
async function refusedOnChain(label: string, safe: string, tx: ReturnType<typeof buildSafeTx>, keys: BaseWallet[], payer: Signer, sendReal: boolean) {
  const sigs = packSignatures(await Promise.all(keys.map(async (k) => ({ signer: k.address, signature: await signSafeTx(k, safe, tx) }))));
  const s = new Contract(safe, SAFE_ABI, payer);
  try {
    await s.execTransaction.staticCall(...execArgs(tx, sigs));
    throw new Error(`${label}: NOT refused by the guard`);
  } catch (e) {
    const m = errText(e);
    if (!/MyWallGuard/.test(m)) throw new Error(`${label}: unexpected error ${m}`);
    ok(`${label} → refused by the guard: "${(m.match(/MyWallGuard:[^"|]*/) ?? [m])[0].trim()}"`);
  }
  if (sendReal) {
    const sent = await s.execTransaction(...execArgs(tx, sigs), { gasLimit: 200_000 });
    const rc = await sent.wait().catch((e: any) => e.receipt);
    if (rc?.status !== 0) throw new Error(`${label}: transaction did not revert`);
    info(`reverted on-chain: ${explorerTx(sent.hash)}`);
    return sent.hash as string;
  }
  return '';
}

async function main() {
  const t0 = Date.now();
  step(0, 'Services, relayer, guard');
  const health = await call('GET', `${C}/health`);
  info(`relayer ${health.relayer} — ${health.relayerEth} SepoliaETH`);
  if (!MYWALL_GUARD_ADDRESS) throw new Error('MyWallGuard not deployed (npm run deploy:guard)');
  info(`MyWallGuard ${explorerAddress(MYWALL_GUARD_ADDRESS)}`);

  const clientId = `E2EP-${Date.now()}`;
  const ts = await fetch(`${SERVICE_URLS.bank}/admin/test-session`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ clientId }) });
  if (!ts.ok) throw new Error(`Could not obtain a test session from sq-bank (${ts.status})`);
  sessionToken = ((await ts.json()) as { token: string }).token;
  await call('POST', `${C}/clients`, { clientId, name: 'E2E Protection Client', email: 'e2e-protection@example.ch', headless: true });

  step(1, 'Create the wallet and activate the on-chain protection (K1 + K2 batch)');
  const k1 = Wallet.createRandom();
  const k3 = Wallet.createRandom().connect(provider) as unknown as Wallet;
  const k3s = new NonceManager(k3); // K3 pays its own gas (emergency reserve); one nonce sequence
  const { address: k2 } = await call('POST', `${C}/clients/${clientId}/cosigner-key`);
  const dep = await call('POST', `${C}/wallets/deploy`, { clientId, deviceAddress: k1.address, recoveryAddress: k3.address });
  const safe: string = dep.safeAddress;
  ok(`Safe ${safe} deployed: ${explorerTx(dep.txHash)}`);
  proof.deploy = dep.txHash;
  const shares = (await splitRecoveryKey(k3.privateKey)) as Record<string, string>;
  const [paper, second] = Object.values(shares);
  await call('POST', `${P}/shares`, {
    clientId,
    safeAddress: safe,
    share: shares.partner,
    kyc: { name: 'E2E Protection Client', dob: '1990-01-01', idNumber: 'E2E' },
    questions: [
      { question: RECOVERY_QUESTIONS[1], answer: 'Rex' },
      { question: RECOVERY_QUESTIONS[3], answer: 'Rue du Lac' },
      { question: RECOVERY_QUESTIONS[5], answer: 'Mme Dupont' },
    ],
    paperCommitment: sha256(paper),
    share2Commitment: sha256(second),
  });
  await nonceAtLeast(safe);
  let prep: any;
  for (let i = 0; i < 6; i++) {
    prep = await call('POST', `${C}/clients/${clientId}/protection/setup/prepare`, {}, true);
    if (prep._status < 400) break;
    await sleep(4000); // lagging RPC: Safe not visible yet
  }
  if (prep._status >= 400) throw new Error(`setup prepare: ${JSON.stringify(prep)}`);
  const setup = await call('POST', `${C}/clients/${clientId}/protection/setup/submit`, { previewId: prep.previewId, safeTx: prep.safeTx, signatureK1: await signSafeTx(k1, safe, prep.safeTx) });
  ok(`Guard + D1 (${prep.delays.d1.cooldown}s) + D2 (${prep.delays.d2.cooldown}s) active, signed K1 + K2, gas ${setup.gasUsed}: ${explorerTx(setup.txHash)}`);
  proof.setup = setup.txHash;
  if (setup.reserveTx) {
    ok(`Emergency gas reserve deposited on K3: ${explorerTx(setup.reserveTx)}`);
    proof.reserve = setup.reserveTx;
  }
  const st = await readProtection(provider, safe);
  if (!st.protected || !st.config) throw new Error('protection not active on-chain');
  const { d1, d2 } = st.config;
  info(`D1 ${d1} · D2 ${d2}`);
  for (let i = 0; i < 10 && (await provider.getBalance(k3.address)) === 0n; i++) await sleep(2000);
  info(`K3 balance ${formatEther(await provider.getBalance(k3.address))} ETH (reserve)`);

  step(2, '(e) K3 ALONE queues in D2 (long cooldown) — started first, it runs in the background');
  const d2Inner: InnerTx = { to: k3.address, value: 0n, data: '0x' };
  const d2c = new Contract(d2, DELAY_ABI, k3s);
  const q2 = await (await retry(() => d2c.execTransactionFromModule(d2Inner.to, 0n, '0x', 0))).wait();
  const d2At = (await provider.getBlock(q2!.blockNumber))!.timestamp + Number(await d2c.txCooldown());
  ok(`Queued in D2 by K3 alone (no other key, no Swissquote): ${explorerTx(q2!.hash)} — executable at ${new Date(d2At * 1000).toISOString()}`);
  proof.d2Queue = q2!.hash;

  step(3, '(a) K2 + K3 direct is refused by the guard — lab Safe whose "K2" is a test key (simulated compromised Swissquote key)');
  const labK2 = Wallet.createRandom();
  const factory = new Contract(SAFE_PROXY_FACTORY, SAFE_PROXY_FACTORY_ABI, k3s);
  const salt = BigInt(Date.now());
  const init = setupInitializer([k1.address, labK2.address, k3.address]);
  const lab: string = await factory.createProxyWithNonce.staticCall(SAFE_L2_SINGLETON, init, salt);
  await (await retry(() => factory.createProxyWithNonce(SAFE_L2_SINGLETON, init, salt))).wait();
  const labPlan = planProtectionSetup({ safe: lab, k2: labK2.address, k3: k3.address, guard: MYWALL_GUARD_ADDRESS, delays: prep.delays });
  await execDirect(lab, batchSafeTx(labPlan.data, await nonceAtLeast(lab)), [k1, labK2], k3s);
  ok(`Lab Safe ${lab} protected by the same guard (K1 + test K2)`);
  const labSwap = buildSafeTx({ to: lab, data: new Contract(lab, SAFE_ABI).interface.encodeFunctionData('swapOwner', ['0x0000000000000000000000000000000000000001', k1.address, Wallet.createRandom().address]), nonce: await nonceAtLeast(lab, 1n) });
  proof.k2k3Refused = await refusedOnChain('K2 + K3 direct swapOwner (lab)', lab, labSwap, [labK2, k3], k3s, true);

  step(4, '(f) K1 + K2 normal transfer — immediate');
  const bob = Wallet.createRandom().address;
  await call('POST', `${C}/clients/${clientId}/contacts`, { name: 'Bob', address: bob });
  const cool = (await call('GET', `${C}/config`)).policy.coolingOffNewRecipientSec;
  const transfer = { kind: 'third-party', beneficiary: { name: 'Bob Example', walletType: 'unhosted', street: 'Rue du Test 1', city: 'Lausanne', country: 'CH', relationship: 'friend', purpose: 'E2E protection ping (0 ETH)', accuracyConfirmed: true, declaresOwnership: true } };
  const sendPing = async (signer: BaseWallet) => {
    let p: any;
    let tx: any;
    for (let attempt = 0; attempt < 6; attempt++) {
      tx = buildSafeTx({ to: bob, value: 0n, nonce: await safeContract(safe, provider).nonce() });
      p = await call('POST', `${C}/tx/prepare`, { clientId, safeTx: tx, transfer }, true);
      if (p._status !== 409) break;
      await sleep(4000);
    }
    if (p._status >= 400) throw new Error(`prepare: ${JSON.stringify(p)}`);
    return call('POST', `${C}/tx/submit`, { clientId, previewId: p.previewId, safeTx: tx, signatureK1: await signSafeTx(signer, safe, tx) }, true);
  };

  step(5, '(a\') K1 + K3 direct transfer is refused by the guard (real reverted transaction, paid by K3)');
  const nowNonce = await nonceAtLeast(safe, 1n);
  proof.k1k3Refused = await refusedOnChain('K1 + K3 direct transfer', safe, buildSafeTx({ to: k3.address, value: 0n, nonce: nowNonce }), [k1, k3], k3s, true);

  step(6, '(c) VETO — K1 + K3 queue an operation in D1, the client cancels it immediately (K1 + K2, setTxNonce)');
  const hostile: InnerTx = { to: Wallet.createRandom().address, value: 0n, data: '0x' };
  const qv = await execDirect(safe, queueInD1SafeTx(d1, hostile, await nonceAtLeast(safe, 1n)), [k1, k3], k3s);
  ok(`Queued in D1 (K1 + K3, gas from the K3 reserve): ${explorerTx(qv.hash)}`);
  proof.vetoQueued = qv.hash;
  await sleep(4000);
  let vp: any;
  for (let i = 0; i < 6; i++) {
    vp = await call('POST', `${C}/clients/${clientId}/protection/veto/prepare`, { module: 'D1' }, true);
    if (vp._status < 400) break;
    await sleep(4000);
  }
  if (vp._status >= 400) throw new Error(`veto prepare: ${JSON.stringify(vp)}`);
  const veto = await call('POST', `${C}/clients/${clientId}/protection/veto/submit`, { previewId: vp.previewId, safeTx: vp.safeTx, signatureK1: await signSafeTx(k1, safe, vp.safeTx) });
  ok(`Vetoed on-chain (setTxNonce ${veto.newTxNonce}, K1 + K2): ${explorerTx(veto.txHash)}`);
  proof.veto = veto.txHash;
  const qAfterVeto = await readDelayQueue(provider, d1);
  if (qAfterVeto.pending.length !== 0) throw new Error('veto did not clear the D1 queue');
  try {
    await new Contract(d1, DELAY_ABI, provider).executeNextTx.staticCall(hostile.to, 0n, '0x', 0, { from: k3.address });
    throw new Error('vetoed operation still executable');
  } catch (e) {
    if (!/queue is empty/i.test(errText(e))) throw e;
    ok('The vetoed operation can no longer be executed ("Transaction queue is empty")');
  }

  step(7, '(d) PROTECTED EXIT — K1 + K3 queue a withdrawal in D1 (no Swissquote service involved)');
  const exitTo = Wallet.createRandom().address;
  const deposit = await (await k3s.sendTransaction({ to: safe, value: parseEther('0.0001') })).wait();
  info(`0.0001 ETH put in the wallet for the demo: ${explorerTx(deposit!.hash)}`);
  const exitInner: InnerTx = { to: exitTo, value: parseEther('0.0001'), data: '0x' };
  const qe = await execDirect(safe, queueInD1SafeTx(d1, exitInner, await nonceAtLeast(safe, 1n)), [k1, k3], k3s);
  const exitAt = (await provider.getBlock(qe.blockNumber))!.timestamp + prep.delays.d1.cooldown;
  ok(`Exit queued in D1 (K1 + K3): ${explorerTx(qe.hash)} — executable at ${new Date(exitAt * 1000).toISOString()}`);
  proof.exitQueued = qe.hash;

  // (f) runs while the exit's cooldown elapses
  info(`(f) waiting the ${cool}s cooling-off for the new contact…`);
  await sleep((cool + 2) * 1000);
  const tx1 = await sendPing(k1);
  if (tx1.status !== 'executed') throw new Error(`K1 + K2 transfer not executed: ${JSON.stringify(tx1)}`);
  ok(`(f) K1 + K2 transfer executed immediately (guard active): ${explorerTx(tx1.txHash)}`);
  proof.k1k2 = tx1.txHash;

  await waitUntil('protected exit cooldown (D1)', exitAt);
  const d1k3 = new Contract(d1, DELAY_ABI, k3s);
  const ex = await (await d1k3.executeNextTx(exitInner.to, exitInner.value, '0x', 0)).wait();
  const got = await provider.getBalance(exitTo);
  if (got !== parseEther('0.0001')) throw new Error('exit not received');
  ok(`(d) Exit executed by K3 alone after the delay (anyone can execute; gas from the K3 reserve): ${explorerTx(ex!.hash)}`);
  proof.exitExecuted = ex!.hash;

  step(8, '(b) "I LOST MY DEVICE" — swapOwner queued in D1 by K3 + K2, on-chain countdown, executed by the relayer');
  const k1new = Wallet.createRandom();
  const ses = await call('POST', `${P}/sessions`, { clientId, context: { swissquoteLogin: true, newDevice: true, unusualIp: false, simSwapRecent: false } });
  await call('POST', `${P}/sessions/${ses.sessionId}/liveness`, { result: 'match' });
  await call('POST', `${P}/sessions/${ses.sessionId}/answers`, { answers: ['rex', 'Rue du Lac', 'mme dupont'] });
  await call('POST', `${P}/sessions/${ses.sessionId}/paper-proof`, { commitment: sha256(paper) });
  const dec = await call('POST', `${P}/sessions/${ses.sessionId}/decide`);
  if (dec.decision !== 'released') throw new Error(`Partner refused: ${JSON.stringify(dec)}`);
  ok(`Partner attestation (risk ${dec.riskScore})`);
  let rec: any;
  for (let attempt = 0; attempt < 6; attempt++) {
    const owners: string[] = await safeContract(safe, provider).getOwners();
    const { safeTx } = recoveryQueueSafeTx(safe, d1, owners, k1.address, k1new.address, await safeContract(safe, provider).nonce());
    rec = await call('POST', `${C}/recovery/request`, { clientId, safeTx, signatureK3: await signSafeTx(k3, safe, safeTx), partnerAttestationId: dec.attestationId }, true);
    if (rec._status !== 409) break;
    await sleep(4000);
  }
  if (rec._status >= 400) throw new Error(`recovery request failed: ${JSON.stringify(rec)}`);
  ok(`Rotation QUEUED ON-CHAIN in D1 (K3 + K2): ${explorerTx(rec.onchain.queueTx)} — on-chain executable at ${rec.onchain.executableAt}, completes after ${rec.executeAfter}`);
  proof.recoveryQueued = rec.onchain.queueTx;
  let r: any = rec;
  while (r.status === 'pending-delay' || r.status === 'executing') {
    await sleep(5000);
    r = await call('GET', `${C}/recovery/${rec.id}`);
    process.stdout.write(`  … ${r.status} ${Math.max(0, Math.round((new Date(r.executeAfter).getTime() - Date.now()) / 1000))}s   \r`);
  }
  console.log();
  if (r.status !== 'completed') throw new Error(`Recovery ${r.status}: ${r.error}`);
  ok(`Old device key revoked ON-CHAIN from D1 (executeNextTx, relayer): ${explorerTx(r.txHash)}`);
  proof.recoveryExecuted = r.txHash;
  const owners3: string[] = await safeContract(safe, provider).getOwners();
  if (owners3.some((o) => o.toLowerCase() === k1.address.toLowerCase()) || !owners3.some((o) => o.toLowerCase() === k1new.address.toLowerCase())) throw new Error('owners not rotated');
  const tx2 = await sendPing(k1new);
  if (tx2.status !== 'executed') throw new Error(`K1′ + K2 transfer not executed: ${JSON.stringify(tx2)}`);
  ok(`New device key K1′ + K2 is immediate (the guard reads K1 dynamically): ${explorerTx(tx2.txHash)}`);
  proof.k1newK2 = tx2.txHash;

  step(9, '(e) K3 alone: D2 execution after its longer cooldown');
  await waitUntil('D2 cooldown', d2At);
  const e2 = await (await d2c.executeNextTx(d2Inner.to, 0n, '0x', 0)).wait();
  ok(`Executed from D2 (K3 alone, after ${prep.delays.d2.cooldown}s): ${explorerTx(e2!.hash)}`);
  proof.d2Executed = e2!.hash;

  const state = { clientId, safe, lab, guard: MYWALL_GUARD_ADDRESS, d1, d2, proof, at: new Date().toISOString() };
  fs.writeFileSync(new URL('./.e2e-protection-state.json', import.meta.url), JSON.stringify(state, null, 2));
  console.log(`\n\x1b[1m\x1b[32m✅ E2E PROTECTION PASSED in ${Math.round((Date.now() - t0) / 1000)}s\x1b[0m — Safe ${explorerAddress(safe)}`);
}

main().catch((e) => {
  console.error(`\n\x1b[31m❌ E2E PROTECTION FAILED: ${e.message}\x1b[0m`);
  process.exit(1);
});
