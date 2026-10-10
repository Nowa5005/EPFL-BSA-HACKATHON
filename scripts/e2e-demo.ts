// Headless end-to-end demo on Ethereum Sepolia: CREATE → SIGN → LOSE DEVICE → RECOVER → SIGN AGAIN.
// Uses the three running services (npm run dev:services). Everything on-chain is REAL.
// The only shortcut: this scripted client has no browser, so the passkey step is skipped (headless demo client).

import fs from 'node:fs';
import { BaseWallet, Contract, Wallet, hashMessage, hexlify, randomBytes, sha256 } from 'ethers';
import {
  EIP1271_ABI,
  RECOVERY_QUESTIONS,
  decodeRecoveryCode,
  encodeRecoveryCode,
  EIP1271_MAGIC,
  SERVICE_URLS,
  TEST_ONLY_simulatePrf,
  buildSafeTx,
  decryptShareWithPrf,
  encryptShareWithPrf,
  newPrfSalt,
  parseShare2Record,
  reconstructK3FromShares,
  explorerAddress,
  explorerTx,
  makeProvider,
  ownershipStatement,
  safeContract,
  signSafeMessage,
  signSafeTx,
  splitRecoveryKey,
  swapOwnerData,
  type SecurityKeyShare,
} from '@sq/shared';
import { internalHeaders, loadDotenv } from '@sq/shared/server';

loadDotenv(); // INTERNAL_API_TOKEN (dev only) to obtain a session token for the headless client
const provider = makeProvider();
const C = SERVICE_URLS.cosigner;
const P = SERVICE_URLS.partner;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
import { externalReceiptStep } from './e2e-external-receipt';
const step = (n: number | string, t: string) => console.log(`\n\x1b[1m\x1b[34m[${n}] ${t}\x1b[0m`);
const ok = (t: string) => console.log(`  \x1b[32m✔\x1b[0m ${t}`);
const info = (t: string) => console.log(`  ${t}`);

// Session token of the headless E2E client (bank POST /admin/test-session, dev only, x-internal-token).
let sessionToken = '';
async function call<T = any>(method: 'GET' | 'POST', url: string, body?: unknown, expectError = false): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  const res = await fetch(url, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !expectError) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(json)}`);
  return { ...json, _status: res.status } as T;
}

async function main() {
  const t0 = Date.now();
  step(0, 'Services & relayer');
  const health = await call('GET', `${C}/health`).catch(() => {
    throw new Error('sq-cosigner is not running. Start the services first: npm run dev:services');
  });
  await call('GET', `${P}/health`);
  info(`relayer ${health.relayer} — ${health.relayerEth} SepoliaETH`);
  if (!health.relayerEth || Number(health.relayerEth) === 0) throw new Error('Relayer has no Sepolia ETH — see POUR_NOA.md');

  const clientId = `E2E-${Date.now()}`;
  const ts = await fetch(`${SERVICE_URLS.bank}/admin/test-session`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ clientId }) });
  if (!ts.ok) throw new Error(`Could not obtain a test session from sq-bank (${ts.status}). Is INTERNAL_API_TOKEN in .env and NODE_ENV not production?`);
  sessionToken = ((await ts.json()) as { token: string }).token;
  await call('POST', `${C}/clients`, { clientId, name: 'E2E Demo Client', email: 'e2e@example.ch', headless: true });

  step(1, 'CREATE — keys generated client-side, recovery key split 2-of-3');
  const k1 = Wallet.createRandom();
  const k3 = Wallet.createRandom();
  const shares = await splitRecoveryKey(k3.privateKey);
  info(`device key K1     ${k1.address}`);
  info(`recovery key K3   ${k3.address} → split into ① paper / ② security key / ③ partner shares`);
  const { address: k2 } = await call('POST', `${C}/clients/${clientId}/cosigner-key`);
  info(`Swissquote K2     ${k2} (generated server-side, never leaves sq-cosigner)`);

  const dep = await call('POST', `${C}/wallets/deploy`, { clientId, deviceAddress: k1.address, recoveryAddress: k3.address });
  const safe: string = dep.safeAddress;
  ok(`Safe 2-of-3 deployed by the Swissquote relayer (client paid no gas): ${safe}`);
  info(explorerTx(dep.txHash));

  await call('POST', `${P}/shares`, {
    clientId,
    safeAddress: safe,
    share: shares.partner,
    kyc: { name: 'E2E Demo Client', dob: '1990-01-01', idNumber: 'E2E' },
    questions: [
      { question: RECOVERY_QUESTIONS[1], answer: 'Rex' },
      { question: RECOVERY_QUESTIONS[3], answer: 'Rue du Lac' },
      { question: RECOVERY_QUESTIONS[5], answer: 'Mme Dupont' },
    ],
    paperCommitment: sha256(shares.paper),
    share2Commitment: sha256(shares.key),
  });
  ok('Share ③ stored at the independent recovery partner (separate process)');

  // Share ② — protected by a physical security key through WebAuthn PRF. This headless client has no authenticator:
  // TEST ONLY, the PRF output is simulated deterministically (HMAC of a test secret, like a real hmac-secret key).
  const testKeySecret = hexlify(randomBytes(32)); // stands for the secret inside the physical key (test only)
  const prfSalt = newPrfSalt();
  const share2Record = await encryptShareWithPrf({
    safeAddress: safe,
    share: shares.key,
    prfOutput: TEST_ONLY_simulatePrf(testKeySecret, prfSalt),
    credentialId: 'ZTJlLXRlc3Qtc2VjdXJpdHkta2V5',
    rpId: 'localhost',
    prfSalt,
  });
  await call('POST', `${C}/clients/${clientId}/recovery-kit/share2`, { method: 'security-key', record: share2Record });
  ok('Share ② encrypted with the (simulated) security key — Swissquote stores only the ciphertext');

  const s = safeContract(safe, provider);
  const owners: string[] = await s.getOwners();
  info(`on-chain owners: ${owners.join(', ')} — threshold ${await s.getThreshold()}`);

  step('1b', 'EIP-1271 proof of ownership (Travel Rule self-hosted wallet verification)');
  const statement = ownershipStatement(clientId, safe, new Date().toISOString());
  const sigK1msg = await signSafeMessage(k1, safe, hashMessage(statement));
  const proof = await call('POST', `${C}/wallets/ownership-proof`, { clientId, message: statement, signatureK1: sigK1msg });
  const magic: string = await new Contract(safe, EIP1271_ABI, provider).isValidSignature(hashMessage(statement), proof.signature);
  if (magic.toLowerCase() !== EIP1271_MAGIC) throw new Error('EIP-1271 proof invalid');
  ok(`Safe.isValidSignature → ${magic} (valid, verified on-chain)`);

  step(2, 'SIGN — device key K1 + Swissquote co-signature K2, gas sponsored');
  const bob = Wallet.createRandom().address;
  await call('POST', `${C}/clients/${clientId}/contacts`, { name: 'Bob', address: bob });
  const cfg = await call('GET', `${C}/config`);
  const cool = cfg.policy.coolingOffNewRecipientSec;
  info(`contact Bob ${bob} added — waiting the ${cool}s cooling-off for new recipients…`);
  // Travel Rule: Bob is a third party → his full name is always required. The enhanced fields are also given so the
  // ping passes even if no CHF rate is available (an unknown counter-value is treated as ≥ the threshold).
  // The services run in Travel Rule DEMO mode outside production (data collected, not transmitted — not compliant).
  const transfer = {
    kind: 'third-party',
    beneficiary: { name: 'Bob Example', walletType: 'unhosted', street: 'Rue du Test 1', city: 'Lausanne', country: 'CH', relationship: 'friend', purpose: 'E2E test ping (0 ETH)', accuracyConfirmed: true },
  };
  await sleep((cool + 2) * 1000);

  const sendPing = async (signer: BaseWallet, label: string) => {
    let prep: any;
    let tx: any;
    for (let attempt = 0; attempt < 6; attempt++) {
      tx = buildSafeTx({ to: bob, value: 0n, nonce: await s.nonce() });
      prep = await call('POST', `${C}/tx/prepare`, { clientId, safeTx: tx, transfer }, true);
      if (prep._status !== 409) break;
      await sleep(4000); // lagging RPC node: stale nonce
    }
    info(`simulation: "${prep.decoded.summary}" — decision ${prep.policy.decision}`);
    const sig = await signSafeTx(signer, safe, tx);
    return call('POST', `${C}/tx/submit`, { clientId, previewId: prep.previewId, safeTx: tx, signatureK1: sig }, true).then((r) => ({ ...r, label }));
  };
  {
    const nonce = await s.nonce();
    const tx = buildSafeTx({ to: bob, value: 0n, nonce });
    const prep = await call('POST', `${C}/tx/prepare`, { clientId, safeTx: tx, transfer });
    const tampered = { ...tx, value: '1' };
    const r = await call('POST', `${C}/tx/submit`, { clientId, previewId: prep.previewId, safeTx: tampered, signatureK1: await signSafeTx(k1, safe, tampered) }, true);
    if (r._status !== 409) throw new Error(`Tampered tx not refused: ${JSON.stringify(r)}`);
    ok(`Transaction modified after its preview → refused by the co-signer: "${r.error}"`);
  }
  const tx1 = await sendPing(k1, 'K1');
  if (tx1.status !== 'executed') throw new Error(`tx1 not executed: ${JSON.stringify(tx1)}`);
  ok(`Executed (signed K1 + K2, Safe holds 0 ETH): ${explorerTx(tx1.txHash)}`);

  step(3, 'LOSE DEVICE — K1 is gone. New device generates K1′');
  const k1new = Wallet.createRandom();
  info(`new device key K1′ ${k1new.address}`);

  step('3b', 'Attacker with phone + email tries a recovery (must be REFUSED)');
  const atk = await call('POST', `${P}/sessions`, { clientId, context: { swissquoteLogin: true, newDevice: true, unusualIp: true, simSwapRecent: true, actor: 'attacker' } });
  await call('POST', `${P}/sessions/${atk.sessionId}/liveness`, { result: 'no-match' });
  await call('POST', `${P}/sessions/${atk.sessionId}/answers`, { answers: ['Rex', 'unknown', 'unknown'] });
  const atkDecision = await call('POST', `${P}/sessions/${atk.sessionId}/decide`);
  if (atkDecision.decision !== 'refused' || atkDecision.share) throw new Error('Attacker was NOT refused!');
  ok(`Refused — risk score ${atkDecision.riskScore}; failed: ${atkDecision.factors.filter((f: any) => !f.ok).map((f: any) => f.factor).join(' | ')}`);

  step(4, 'RECOVER — identity check at the partner, paper kit + partner share → K3');
  const ses = await call('POST', `${P}/sessions`, { clientId, context: { swissquoteLogin: true, newDevice: true, unusualIp: false, simSwapRecent: false } });
  await call('POST', `${P}/sessions/${ses.sessionId}/liveness`, { result: 'match' });
  await call('POST', `${P}/sessions/${ses.sessionId}/answers`, { answers: ['rex', 'Rue du Lac', 'mme dupont'] });
  await call('POST', `${P}/sessions/${ses.sessionId}/paper-proof`, { commitment: sha256(shares.paper) });
  const dec = await call('POST', `${P}/sessions/${ses.sessionId}/decide`);
  if (dec.decision !== 'released') throw new Error(`Partner refused: ${JSON.stringify(dec)}`);
  ok(`Partner released share ③ (risk score ${dec.riskScore})`);
  const typed = decodeRecoveryCode(encodeRecoveryCode(shares.paper)); // the client types the printed code
  if (!typed.ok) throw new Error(typed.error);
  const k3rebuilt = await reconstructK3FromShares([typed.share, dec.share], { expectedAddress: k3.address });
  ok(`K3 rebuilt from paper + partner shares: ${k3rebuilt.address}`);
  // The other valid pairs (offline check, no gas): paper + security key, security key + partner.
  const kit = await call('GET', `${C}/clients/${clientId}/recovery-kit`);
  const fromKey = await decryptShareWithPrf(parseShare2Record(kit.share2.record) as SecurityKeyShare, TEST_ONLY_simulatePrf(testKeySecret, prfSalt));
  await reconstructK3FromShares([typed.share, fromKey], { expectedAddress: k3.address });
  await reconstructK3FromShares([fromKey, dec.share], { expectedAddress: k3.address });
  ok('Also rebuilt from paper + security key, and from security key + partner (2 of 3, any pair)');
  const wrongKey = await decryptShareWithPrf(parseShare2Record(kit.share2.record) as SecurityKeyShare, TEST_ONLY_simulatePrf(hexlify(randomBytes(32)), prfSalt)).catch(() => null);
  if (wrongKey) throw new Error('Share ② opened with another security key!');
  ok('Another security key cannot open share ②');

  // Public RPC nodes can lag a few seconds behind each other: retry if the nonce we read was stale.
  let rec: any;
  for (let attempt = 0; attempt < 6; attempt++) {
    const owners2: string[] = await s.getOwners();
    const rot = buildSafeTx({ to: safe, data: swapOwnerData(owners2, k1.address, k1new.address), nonce: await s.nonce() });
    const sigK3 = await signSafeTx(k3rebuilt, safe, rot);
    rec = await call('POST', `${C}/recovery/request`, { clientId, safeTx: rot, signatureK3: sigK3, partnerAttestationId: dec.attestationId }, true);
    if (rec._status !== 409) break;
    await sleep(4000);
  }
  if (rec._status >= 400) throw new Error(`recovery request failed: ${JSON.stringify(rec)}`);
  ok(`Rotation requested. Security delay until ${rec.executeAfter} (client notified everywhere, can cancel)`);

  let status = rec.status;
  let r: any = rec;
  while (status === 'pending-delay' || status === 'executing') {
    await sleep(5000);
    r = await call('GET', `${C}/recovery/${rec.id}`);
    status = r.status;
    process.stdout.write(`  … ${status} ${Math.max(0, Math.round((new Date(r.executeAfter).getTime() - Date.now()) / 1000))}s\r`);
  }
  console.log();
  if (status !== 'completed') throw new Error(`Recovery ${status}: ${r.error}`);
  ok(`Old device key revoked ON-CHAIN (K3 + K2): ${explorerTx(r.txHash)}`);
  const owners3: string[] = await s.getOwners();
  info(`owners now: ${owners3.join(', ')}`);
  if (owners3.map((o) => o.toLowerCase()).includes(k1.address.toLowerCase())) throw new Error('Old K1 still owner');

  step(5, 'SIGN AGAIN — old key refused, new device key works');
  const old = await sendPing(k1, 'old K1');
  if (old._status === 401) ok(`Old K1 refused by co-signer: "${old.error}"`);
  else throw new Error(`Old K1 not refused: ${JSON.stringify(old)}`);
  const tx2 = await sendPing(k1new, 'K1′');
  if (tx2.status !== 'executed') throw new Error(`tx2 not executed: ${JSON.stringify(tx2)}`);
  ok(`Executed with new device key: ${explorerTx(tx2.txHash)}`);

  step('5b', 'EXTERNAL RECEIPT — a third party pays the Safe directly; the on-chain indexer records row + receipt (#3)');
  await externalReceiptStep({ provider, clientId, safe, call, ok, info });

  const state = { clientId, safe, deployTx: dep.txHash, tx1: tx1.txHash, recoveryTx: r.txHash, tx2: tx2.txHash, at: new Date().toISOString() };
  fs.writeFileSync(new URL('./.e2e-state.json', import.meta.url), JSON.stringify(state, null, 2));
  console.log(`\n\x1b[1m\x1b[32m✅ E2E PASSED in ${Math.round((Date.now() - t0) / 1000)}s\x1b[0m — Safe ${explorerAddress(safe)}`);
}

main().catch((e) => {
  console.error(`\n\x1b[31m❌ E2E FAILED: ${e.message}\x1b[0m`);
  process.exit(1);
});
