// #9 — Travel Rule transmission: IVMS101 validation, Ed25519 envelopes (verify / tamper), approve / reject paths
// against the simulated counterparty VASP (in-process, own temp data dir) gating the co-signature, and the
// self-hosted wallet ownership proof (EIP-191). Isolated temp data dirs — never the real services' data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Wallet } from 'ethers';
import {
  SWISSQUOTE_VASP,
  VASPS,
  ownershipProofMessage,
  parseOwnershipProofMessage,
  personFromName,
  vaspLegalPerson,
  validateIvms101,
  isValidLei,
  type Ivms101Message,
} from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-trp-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

const { loadOrCreateVaspKey, signEnvelope, verifyEnvelope, EnvelopeError } = await import('@sq/shared/server');
const { createVaspApp } = await import('../../vasp-mock/src/app');
const { buildInquiry, buildIvms101, transmitInquiry } = await import('../src/trpClient');
const { transmitTravelRule, assertTravelRuleCleared, recordSubmitted, travelRuleSummary } = await import('../src/travelRuleGlue');
const { verifyOwnershipProof } = await import('../src/travelRule');
const { db } = await import('../src/db');

const DANA = '0xDE0E0000000000000000000000000000000d0E01';
const SAFE = '0x1111111111111111111111111111111111111111';
const vasp = VASPS['demo-exchange-ag'];
const sqKey = loadOrCreateVaspKey(path.join(dir, 'sq-key.json'), 'swissquote', process.env.SERVICE_MASTER_KEY);

// Counterparty VASP in-process (own data dir), trusting our test Swissquote key.
const vaspDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-vasp-'));
const lines: string[] = [];
const v = createVaspApp({ dataDir: vaspDir, resolveSenderKey: async () => sqKey.publicKeyPem, log: (l) => lines.push(l) });
const server = v.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const redirect: typeof fetch = (url, init) => fetch(String(url).replace(vasp.endpoint, base), init);
const deps = { key: sqKey, counterpartyKey: async () => v.key.publicKeyPem, fetchImpl: redirect };

const originator = personFromName('Bruno Beispiel', { customerIdentification: 'CH-100235', address: { addressType: 'HOME', addressLine: ['Bahnhofstrasse 1', '8001 Zürich'], country: 'CH' } });
const ivms = (name: string, recipient = DANA): Ivms101Message => buildIvms101({ originator, safeAddress: SAFE, beneficiary: { name, walletType: 'hosted', providerName: 'Demo Exchange AG' }, recipient, vasp });

test('IVMS101: a message built from our records is valid; the validator rejects malformed data', () => {
  assert.deepEqual(validateIvms101(ivms('Dana Example'), { requireBeneficiaryVasp: true }), []);
  assert.ok(isValidLei(SWISSQUOTE_VASP.lei) && isValidLei(vasp.lei));
  assert.equal(isValidLei('DEMO00SWISSQUOTE0178'), false); // wrong check digits
  const m = JSON.parse(JSON.stringify(ivms('Dana Example')));
  const errs = (x: unknown, o = {}) => validateIvms101(x, o).join(' | ');
  // no legal (LEGL) name
  const a = JSON.parse(JSON.stringify(m));
  a.beneficiary.beneficiaryPersons[0].naturalPerson.name.nameIdentifier[0].nameIdentifierType = 'ALIA';
  assert.match(errs(a), /legal name/);
  // bad country code
  const b = JSON.parse(JSON.stringify(m));
  b.originator.originatorPersons[0].naturalPerson.geographicAddress[0].country = 'Switzerland';
  assert.match(errs(b), /country code/);
  // element outside our subset
  const c = JSON.parse(JSON.stringify(m));
  c.originator.originatorPersons[0].naturalPerson.secretNote = 'x';
  assert.match(errs(c), /not allowed/);
  // VASP LEI with wrong check digits
  const d = JSON.parse(JSON.stringify(m));
  d.originatingVASP.originatingVASP.legalPerson.nationalIdentification.nationalIdentifier = 'DEMO00SWISSQUOTE0178';
  assert.match(errs(d), /not a valid LEI/);
  // originator without address / customer id / national id / birth data
  const e = JSON.parse(JSON.stringify(m));
  delete e.originator.originatorPersons[0].naturalPerson.geographicAddress;
  delete e.originator.originatorPersons[0].naturalPerson.customerIdentification;
  assert.match(errs(e), /originator needs/);
  // date of birth in the future, person with two kinds, missing beneficiary VASP
  const f = JSON.parse(JSON.stringify(m));
  f.originator.originatorPersons[0].naturalPerson.dateAndPlaceOfBirth = { dateOfBirth: '2999-01-01', placeOfBirth: 'Bern' };
  f.beneficiary.beneficiaryPersons[0] = { naturalPerson: {}, legalPerson: {} };
  delete f.beneficiaryVASP;
  const fe = errs(f, { requireBeneficiaryVasp: true });
  assert.match(fe, /past date/);
  assert.match(fe, /exactly one of/);
  assert.match(fe, /beneficiaryVASP: required/);
  // company names become legal persons
  assert.ok('legalPerson' in personFromName('Acme Trading AG'));
  assert.deepEqual(validateIvms101({ ...m, beneficiary: { beneficiaryPersons: [personFromName('Acme Trading AG')], accountNumber: [DANA] } }), []);
});

test('Ed25519 envelope: verifies with the right key; tampered payload, other key or forged key id are refused', () => {
  const env = signEnvelope({ hello: 'world', n: 1 }, sqKey);
  assert.deepEqual(verifyEnvelope(env, sqKey.publicKeyPem, 'swissquote'), { hello: 'world', n: 1 });
  assert.throws(() => verifyEnvelope({ ...env, payload: env.payload.replace('1', '2') }, sqKey.publicKeyPem), EnvelopeError);
  assert.throws(() => verifyEnvelope(env, v.key.publicKeyPem), EnvelopeError); // another VASP's key
  assert.throws(() => verifyEnvelope(env, sqKey.publicKeyPem, 'demo-exchange-ag'), EnvelopeError); // wrong sender id
  const sig = Buffer.from(env.signature, 'base64url');
  sig[0] ^= 1;
  assert.throws(() => verifyEnvelope({ ...env, signature: sig.toString('base64url') }, sqKey.publicKeyPem), /Invalid signature/);
  // keys at rest: mode 600, encrypted with the master key, same key when reloaded (never regenerated)
  const file = path.join(dir, 'sq-key.json');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.match(fs.readFileSync(file, 'utf8'), /ENCRYPTED PRIVATE KEY/);
  assert.equal(loadOrCreateVaspKey(file, 'swissquote', process.env.SERVICE_MASTER_KEY).keyId, sqKey.keyId);
});

test('TRP: matching beneficiary → signed "approved" with a reference; wrong name / unknown address → signed "rejected"', async () => {
  const ok = await transmitInquiry(buildInquiry({ ivms101: ivms('Dana Example'), vasp, asset: 'USDC', amount: '12.5', recipient: DANA }), vasp, deps);
  assert.equal(ok.status, 'approved');
  assert.equal(ok.responseVerified, true);
  assert.match(ok.reference!, /^DEX-TR-\d{8}-[0-9A-F]{6}$/);
  // word order / accents / case are tolerated
  assert.equal((await transmitInquiry(buildInquiry({ ivms101: ivms('EXAMPLE Dána'), vasp, asset: 'ETH', amount: '0', recipient: DANA }), vasp, deps)).status, 'approved');
  const wrong = await transmitInquiry(buildInquiry({ ivms101: ivms('Mallory Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, deps);
  assert.equal(wrong.status, 'rejected');
  assert.equal(wrong.reasonCode, 'beneficiary-name-mismatch');
  assert.equal(wrong.responseVerified, true);
  const other = Wallet.createRandom().address;
  const unknown = await transmitInquiry(buildInquiry({ ivms101: ivms('Dana Example', other), vasp, asset: 'USDC', amount: '1', recipient: other }), vasp, deps);
  assert.equal(unknown.reasonCode, 'unknown-address');
  // no personal data in the counterparty's console lines
  assert.ok(lines.length >= 4 && lines.every((l) => !/Dana|Bruno|Mallory|Bahnhof/.test(l)), lines.join('\n'));
});

test('TRP: forged sender, tampered answer, replay and unreachable VASP are never "approved"', async () => {
  // inquiry signed by an unknown key → the VASP refuses to answer (401) → error
  const rogue = loadOrCreateVaspKey(path.join(dir, 'rogue.json'), 'swissquote');
  const forged = await transmitInquiry(buildInquiry({ ivms101: ivms('Dana Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, { ...deps, key: rogue });
  assert.equal(forged.status, 'error');
  assert.equal(forged.reasonCode, 'http-401');
  // answer altered in transit (rejected → approved) → its signature no longer verifies
  const tamper: typeof fetch = async (url, init) => {
    const r = await redirect(url, init);
    const j: any = await r.json();
    const p = JSON.parse(j.payload);
    delete p.rejected;
    p.approved = { address: DANA, reference: 'FORGED' };
    return new Response(JSON.stringify({ ...j, payload: JSON.stringify(p) }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const t1 = await transmitInquiry(buildInquiry({ ivms101: ivms('Mallory Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, { ...deps, fetchImpl: tamper });
  assert.equal(t1.status, 'error');
  assert.equal(t1.reasonCode, 'bad-response-signature');
  // a genuine approval replayed for ANOTHER inquiry is not bound to it
  let saved: any = null;
  const capture: typeof fetch = async (url, init) => {
    const r = await redirect(url, init);
    saved = await r.json();
    return new Response(JSON.stringify(saved), { status: 200 });
  };
  await transmitInquiry(buildInquiry({ ivms101: ivms('Dana Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, { ...deps, fetchImpl: capture });
  const replayed = await transmitInquiry(buildInquiry({ ivms101: ivms('Mallory Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, { ...deps, fetchImpl: async () => new Response(JSON.stringify(saved), { status: 200 }) });
  assert.equal(replayed.status, 'error');
  assert.equal(replayed.reasonCode, 'response-not-bound');
  // the same inquiry sent twice → refused by the VASP (replay)
  const inq = buildInquiry({ ivms101: ivms('Dana Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA });
  assert.equal((await transmitInquiry(inq, vasp, deps)).status, 'approved');
  assert.equal((await transmitInquiry(inq, vasp, deps)).reasonCode, 'http-409');
  // unreachable
  const down = await transmitInquiry(buildInquiry({ ivms101: ivms('Dana Example'), vasp, asset: 'USDC', amount: '1', recipient: DANA }), vasp, { ...deps, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.reasonCode, 'unreachable');
  // browser requests are refused by the counterparty API
  assert.equal((await fetch(`${base}/trp/transfers`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
});

test('co-signature gate: K2 may sign a VASP transfer only after a verified "approved"', async () => {
  const clientId = 'CH-TRP-1';
  db.update((d) => {
    d.clients[clientId] = { clientId, name: 'Bruno Beispiel', email: 'b@example.ch', devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full', safeAddress: SAFE } as any;
  });
  const run = async (name: string, previewId: string, requestId: string) => {
    const declaration = { kind: 'third-party' as const, beneficiary: { name, walletType: 'hosted' as const, providerName: 'Demo Exchange AG' } };
    db.update((d) => {
      d.clients[clientId].travelRule ??= { records: [] };
      d.clients[clientId].travelRule!.records.push({ id: previewId, previewId, createdAt: new Date().toISOString(), retainUntil: '', recipient: DANA, asset: 'USDC', amount: '5', chf: 4, category: 'third-party', declaration, status: 'prepared', ruleVersion: 'v', route: 'vasp', vasp: { vaspId: vasp.vaspId, name: vasp.name } });
    });
    const result: any = { category: 'third-party', decision: 'allow', route: 'vasp', vasp: { vaspId: vasp.vaspId, name: vasp.name }, chf: { value: 4 }, missing: [], transmission: 'trp-required', checks: [], reasons: [], enhancedRequired: false, aggregateChf: 4, linkedCount: 0, thresholdChf: 1000 };
    const policy: any = { decision: 'approve', level: 'standard', checks: [{ id: 'travel-rule-transmission', label: 'pending', status: 'pass' }], reasons: [] };
    const c = db.data.clients[clientId];
    const outcome = await transmitTravelRule({ c, previewId, tr: { result, declaration, view: { applies: true, ruleVersion: 'v' } }, policy, deps: { ...deps, originator } });
    if (policy.decision !== 'reject') recordSubmitted(clientId, previewId, requestId, 4);
    else db.update((d) => (d.clients[clientId].travelRule!.records.find((r) => r.previewId === previewId)!.requestId = requestId)); // even if forced through
    return { outcome, policy };
  };
  const ok = await run('Dana Example', 'p-ok', 'r-ok');
  assert.equal(ok.policy.decision, 'approve');
  assert.match(ok.policy.checks.find((x: any) => x.id === 'travel-rule-transmission').label, /approved/);
  assert.doesNotThrow(() => assertTravelRuleCleared({ clientId, id: 'r-ok' }));
  const sum = travelRuleSummary(clientId, 'r-ok')!;
  assert.equal(sum.status, 'approved');
  assert.equal(sum.vaspName, 'Demo Exchange AG');
  assert.ok(sum.reference);
  assert.equal(JSON.stringify(sum).includes('Dana'), false); // summary carries no personal data

  const ko = await run('Mallory Example', 'p-ko', 'r-ko');
  assert.equal(ko.policy.decision, 'reject');
  assert.match(ko.policy.reasons.join(' '), /does not match/);
  assert.throws(() => assertTravelRuleCleared({ clientId, id: 'r-ko' }), /not approved/);
  // audit trail: TRP status + reference, no names
  const audit = db.data.travelRuleAudit!.filter((a) => a.stage === 'transmit');
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map((a) => a.trp!.status), ['approved', 'rejected']);
  assert.equal(JSON.stringify(audit).match(/Dana|Mallory|Bruno|Bahnhof/), null);
});

test('self-hosted wallet: ownership proof signed by the beneficiary (EIP-191) — valid, altered, wrong signer, expired', async () => {
  const ben = Wallet.createRandom();
  const now = new Date();
  const ch = { nonce: 'a'.repeat(32), address: ben.address, nameKey: 'bob example', issuedAt: now.toISOString() };
  const message = ownershipProofMessage({ address: ben.address, name: 'Bob Example', nonce: ch.nonce, issuedAt: ch.issuedAt });
  assert.deepEqual(parseOwnershipProofMessage(message), { name: 'Bob Example', address: ben.address, nonce: ch.nonce, issuedAt: ch.issuedAt });
  const signature = await ben.signMessage(message);
  const check = (p: any, opts: { recipient?: string; name?: string; chs?: any[]; at?: Date } = {}) => verifyOwnershipProof(p, opts.recipient ?? ben.address, opts.name ?? 'Bob Example', opts.chs ?? [ch], opts.at ?? now, 86400);
  assert.equal(check({ message, signature }).status, 'valid');
  assert.equal(check(undefined).status, 'absent');
  assert.equal(check({ message: message.replace('Bob Example', 'Eve Example'), signature }).status, 'invalid'); // altered text
  assert.equal(check({ message, signature: await Wallet.createRandom().signMessage(message) }).status, 'invalid'); // someone else signed
  assert.equal(check({ message, signature }, { name: 'Carol Other' }).status, 'invalid'); // other beneficiary declared
  assert.equal(check({ message, signature }, { recipient: Wallet.createRandom().address }).status, 'invalid'); // other recipient
  assert.equal(check({ message, signature }, { chs: [] }).status, 'invalid'); // not issued for this client
  assert.equal(check({ message, signature }, { at: new Date(now.getTime() + 86_401_000) }).status, 'invalid'); // expired
});
