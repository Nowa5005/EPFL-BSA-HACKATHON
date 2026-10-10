// Terms of Use (N4): acceptance records, substantive vs non-substantive publication, per-client authorisation.
// A real express app wired like sq-bank (edge → json → guard → localize → routes) runs on an ephemeral port with a
// temporary data directory and a catalog that also contains a non-substantive draft.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-terms-'));
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SESSION_SIGNING_KEY = 'test-session-signing-key-0123456789abcdefghij';
process.env.INTERNAL_API_TOKEN = 'test-internal-api-token-0123456789abcdefghijk';
delete process.env.ALLOWED_ORIGINS;
delete process.env.NODE_ENV;

const { createSecurity, issueToken, localizeResponses } = await import('@sq/shared/server');
const terms = await import('../src/terms');
const { TERMS_CATALOG, createTermsService, termsStatus, acceptTerms, publishTerms, initialTermsState } = terms;

// Catalog for the tests: the real v1.0 and v1.1 (substantive) + an editorial v1.1.1 (non-substantive).
const CATALOG = [...TERMS_CATALOG, { ...TERMS_CATALOG[1], version: '1.1.1', file: 'TERMS_v1.1.md', substantive: false, changeSummary: ['Typo fixed.'], changeSummaryFr: ['Coquille corrigée.'] }];
const A = 'CH-T-0001';
const B = 'CH-T-0002';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).then((r) => !res.headersSent && res.json(r ?? { ok: true })).catch(next);

let server: Server;
let base = '';
const tok = { a: '', b: '', compliance: '' };

before(async () => {
  const app = express();
  const sec = createSecurity({ service: 'test-bank', publicRoutes: [['GET', '/health']] });
  app.use(sec.edge);
  app.use(express.json());
  app.use(sec.guard);
  app.use(localizeResponses);
  const svc = createTermsService({ dataDir: dir, catalog: CATALOG, httpError: HttpError });
  svc.register(app, route);
  app.use((err: unknown, _q: Request, res: Response, _n: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: String(err) });
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tok.a = issueToken({ sub: A, role: 'client' });
  tok.b = issueToken({ sub: B, role: 'client' });
  tok.compliance = issueToken({ sub: 'compliance:compliance', role: 'compliance' });
});
after(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method: 'GET' | 'POST', p: string, token: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'TestAgent/1.0', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const accept = (token: string, id: string, version: string, extra: object = {}) => call('POST', `/clients/${id}/terms/accept`, token, { version, accept: true, deviceLabel: 'Chrome on Mac', lang: 'en', ...extra });

test('pure: first opening needs acceptance; acceptance of an old version is refused', () => {
  const s = initialTermsState(CATALOG);
  const st = termsStatus(CATALOG, s, A);
  assert.equal(st.current?.version, '1.0');
  assert.equal(st.needsAcceptance, true);
  assert.equal(st.reason, 'first');
  assert.throws(() => acceptTerms(CATALOG, s, A, { version: '1.0', accept: false }, 'ua'), /Tick/);
  assert.throws(() => acceptTerms(CATALOG, s, A, { version: '1.1', accept: true }, 'ua'), /no longer the current version/);
  assert.throws(() => publishTerms(CATALOG, s, '9.9', 'x'), /Unknown/);
});

test('first opening: status requires acceptance, the full text is served, the summary has 5 points in both languages', async () => {
  const r = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(r.status, 200);
  assert.equal(r.body.needsAcceptance, true);
  assert.equal(r.body.reason, 'first');
  assert.match(r.body.text, /Prototype — not legal advice, to be reviewed by Swissquote Legal/);
  assert.match(r.body.text, /Version 1\.0 — 10\.10\.2026/);
  assert.equal(r.body.current.summary.length, 5);
  const fr = await call('GET', `/clients/${A}/terms`, tok.a, undefined, { 'x-lang': 'fr' });
  assert.equal(fr.body.current.summary.length, 5);
  assert.match(fr.body.current.summary[0], /Vous gardez le contrôle/);
  assert.equal(fr.body.current.summaryFr, undefined); // folded by localizeResponses
});

test('acceptance is recorded with version, date, device label and a hashed user agent', async () => {
  const unchecked = await call('POST', `/clients/${A}/terms/accept`, tok.a, { version: '1.0', accept: false });
  assert.equal(unchecked.status, 400);
  const r = await accept(tok.a, A, '1.0');
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted.version, '1.0');
  assert.equal(r.body.accepted.deviceLabel, 'Chrome on Mac');
  assert.match(r.body.accepted.userAgentHash, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(r.body).includes('TestAgent')); // raw user agent never stored
  assert.ok(Math.abs(Date.parse(r.body.accepted.acceptedAt) - Date.now()) < 10_000);
  const st = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(st.body.needsAcceptance, false);
  assert.equal(st.body.accepted.version, '1.0');
  // persisted on disk
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'terms.json'), 'utf8'));
  assert.equal(saved.clients[A].acceptances[0].version, '1.0');
});

test("another client's token is refused (read and accept)", async () => {
  assert.equal((await call('GET', `/clients/${A}/terms`, tok.b)).status, 403);
  assert.equal((await accept(tok.b, A, '1.0')).status, 403);
  assert.equal((await call('POST', `/clients/${B}/terms/accept`, tok.a, { version: '1.0', accept: true, clientId: B })).status, 403);
});

test('only the compliance role can publish', async () => {
  assert.equal((await call('POST', '/admin/terms/publish', tok.a, { version: '1.1' })).status, 403);
  assert.equal((await call('GET', '/admin/terms', tok.a)).status, 403);
});

test('a substantive publication forces re-acceptance and is announced with its change summary', async () => {
  const p = await call('POST', '/admin/terms/publish', tok.compliance, { version: '1.1' });
  assert.equal(p.status, 200);
  assert.equal(p.body.version, '1.1');
  assert.equal((await call('POST', '/admin/terms/publish', tok.compliance, { version: '1.1' })).status, 409);
  const st = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(st.body.current.version, '1.1');
  assert.equal(st.body.needsAcceptance, true);
  assert.equal(st.body.reason, 'updated');
  assert.equal(st.body.accepted.version, '1.0');
  assert.equal(st.body.updates[0].version, '1.1');
  assert.match(st.body.updates[0].changeSummary[0], /10 transactions per day/);
  assert.match(st.body.text, /Version 1\.1/);
  // accepting the old version is no longer possible
  assert.equal((await accept(tok.a, A, '1.0')).status, 409);
  assert.equal((await accept(tok.a, A, '1.1')).status, 200);
  const after = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(after.body.needsAcceptance, false);
  assert.equal(after.body.updates[0].acceptedByYou, true);
  assert.equal(after.body.acceptances.length, 2); // history kept
  // the accepted version stays viewable (PDF)
  const v10 = await call('GET', `/clients/${A}/terms/versions/1.0`, tok.a);
  assert.equal(v10.status, 200);
  assert.match(v10.body.text, /Version 1\.0/);
});

test('a non-substantive publication is information only (no re-acceptance)', async () => {
  assert.equal((await call('POST', '/admin/terms/publish', tok.compliance, { version: '1.1.1' })).status, 200);
  const st = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(st.body.current.version, '1.1.1');
  assert.equal(st.body.needsAcceptance, false);
  assert.equal(st.body.infoOnly, true);
  assert.equal(st.body.updates[0].version, '1.1.1');
  assert.equal(st.body.updates[0].substantive, false);
  // a brand-new client must still accept (the latest substantive version is 1.1; it accepts the current 1.1.1)
  const b = await call('GET', `/clients/${B}/terms`, tok.b);
  assert.equal(b.body.needsAcceptance, true);
  assert.equal(b.body.reason, 'first');
  assert.equal((await accept(tok.b, B, '1.1.1')).status, 200);
  assert.equal((await call('GET', `/clients/${B}/terms`, tok.b)).body.needsAcceptance, false);
  const admin = await call('GET', '/admin/terms', tok.compliance);
  assert.deepEqual(
    admin.body.versions.map((v: any) => [v.version, v.published, v.acceptedBy]),
    [
      ['1.0', true, 1],
      ['1.1', true, 1],
      ['1.1.1', true, 1],
    ],
  );
});

test('demo reset unpublishes the later versions and forgets their acceptances', async () => {
  assert.equal((await call('POST', '/admin/terms/reset-demo', tok.compliance, {})).status, 200);
  const st = await call('GET', `/clients/${A}/terms`, tok.a);
  assert.equal(st.body.current.version, '1.0');
  assert.equal(st.body.needsAcceptance, false); // A accepted 1.0 before
  assert.equal(st.body.updates.length, 0);
  assert.equal((await call('GET', `/clients/${B}/terms`, tok.b)).body.needsAcceptance, true);
  assert.equal((await call('GET', `/clients/${A}/terms/versions/1.1`, tok.a)).status, 404);
});
