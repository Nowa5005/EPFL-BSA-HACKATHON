// vasp-mock (#9): identity, key storage, sender authentication, timestamp window, signed rejections.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { TRP } from '@sq/shared';
import { keyFingerprint, loadOrCreateVaspKey, signEnvelope, verifyEnvelope } from '@sq/shared/server';
import { createVaspApp, namesMatch } from '../src/app';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-vaspmock-'));
const sender = loadOrCreateVaspKey(path.join(dir, 'sender.json'), 'swissquote');
let now = new Date('2026-10-11T10:00:00Z');
const v = createVaspApp({ dataDir: path.join(dir, 'vasp'), resolveSenderKey: async () => sender.publicKeyPem, now: () => now, log: () => undefined });
const server = v.app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const post = (body: unknown) => fetch(`${base}${TRP.inquiryPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('identity: Ed25519 public key + key id published; private key stored mode 600 in its own data dir', async () => {
  const id: any = await (await fetch(`${base}${TRP.identityPath}`)).json();
  assert.equal(id.vaspId, 'demo-exchange-ag');
  assert.equal(id.keyId, `demo-exchange-ag#${keyFingerprint(id.publicKeyPem)}`);
  assert.equal(JSON.stringify(id).includes('PRIVATE'), false);
  const f = path.join(dir, 'vasp', 'vasp-ed25519.json');
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  const health: any = await (await fetch(`${base}/health`)).json();
  assert.equal(health.simulated, true);
});

test('authentication: unknown sender or bad signature → 401 (no answer signed); malformed JSON → 400', async () => {
  const other = loadOrCreateVaspKey(path.join(dir, 'other.json'), 'evil-vasp');
  assert.equal((await post(signEnvelope({ version: TRP.version }, other))).status, 401);
  const env = signEnvelope({ version: TRP.version }, sender);
  assert.equal((await post({ ...env, payload: env.payload + ' ' })).status, 401);
  assert.equal((await fetch(`${base}${TRP.inquiryPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await fetch(`${base}${TRP.inquiryPath}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
});

test('authenticated but stale or misaddressed inquiry → SIGNED rejection', async () => {
  const inq = { version: TRP.version, requestIdentifier: '11111111-2222-3333-4444-555555555555', createdAt: '2026-10-11T09:00:00Z', originatorVasp: 'swissquote', beneficiaryVasp: 'demo-exchange-ag', asset: { caip19: 'x', symbol: 'ETH' }, amount: '0', beneficiaryAddress: '0xDE0E0000000000000000000000000000000d0E01', ivms101: {} };
  const r: any = await (await post(signEnvelope(inq, sender))).json();
  const resp: any = verifyEnvelope(r, v.key.publicKeyPem, 'demo-exchange-ag');
  assert.equal(resp.rejected.code, 'invalid-inquiry');
  assert.equal(resp.requestIdentifier, inq.requestIdentifier);
  now = new Date('2026-10-11T09:00:30Z');
  const r2: any = await (await post(signEnvelope({ ...inq, requestIdentifier: '11111111-2222-3333-4444-555555555556', beneficiaryVasp: 'someone-else' }, sender))).json();
  assert.equal((verifyEnvelope(r2, v.key.publicKeyPem) as any).rejected.code, 'invalid-inquiry');
  const r3: any = await (await post(signEnvelope({ ...inq, requestIdentifier: '11111111-2222-3333-4444-555555555557' }, sender))).json();
  assert.equal((verifyEnvelope(r3, v.key.publicKeyPem) as any).rejected.code, 'invalid-ivms101');
});

test('name matching ignores case, accents, spacing and word order — nothing else', () => {
  assert.ok(namesMatch('Dana Example', '  EXAMPLE   dána '));
  assert.ok(!namesMatch('Dana Example', 'Dana Exampel'));
  assert.ok(!namesMatch('', ''));
});
