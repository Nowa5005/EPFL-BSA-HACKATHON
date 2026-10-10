// Service authentication, CORS and CSRF tests (spec §13). A real express app wired exactly like the services
// (edge → express.json → guard → routes) runs on an ephemeral port; each state-changing route increments a counter,
// so every refusal is checked to happen BEFORE any state change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-auth-'));
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SESSION_SIGNING_KEY = 'test-session-signing-key-0123456789abcdefghij';
process.env.INTERNAL_API_TOKEN = 'test-internal-api-token-0123456789abcdefghijk';
delete process.env.ALLOWED_ORIGINS;
delete process.env.NODE_ENV;

const auth = await import('@sq/shared/server');
const { createSecurity, issueToken, verifyToken, ensureSecret } = auth;

const OK_ORIGIN = 'http://localhost:5173';
const EVIL = 'https://evil.example';
const ALICE = 'CH-100234';
const BRUNO = 'CH-100235';
const state = { writes: 0, resets: 0, clientResets: 0 };
const TX_OWNER: Record<string, string> = { 'tx-alice': ALICE };

let server: Server;
let base = '';

before(async () => {
  const app = express();
  const sec = createSecurity({
    service: 'test',
    publicRoutes: [
      ['GET', '/health'],
      ['POST', '/login'],
    ],
    sessionRoutes: [['POST', '/reauth']],
    internalRoutes: [['GET', '/attestations/:id']],
    owner: (req) => {
      const [a, id] = auth.segmentsOf(req.path);
      if (a === 'tx' && id) return TX_OWNER[id] ?? null;
      return undefined;
    },
  });
  app.use(sec.edge);
  app.use(express.json());
  app.use(sec.guard);
  app.get('/health', (_q, r) => void r.json({ ok: true }));
  app.post('/login', (_q, r) => void r.json({ token: issueToken({ sub: ALICE, role: 'client' }) }));
  app.get('/clients/:id', (q, r) => void r.json({ id: q.params.id, writes: state.writes }));
  app.post('/clients/:id/contacts', (_q, r) => void r.json({ writes: ++state.writes }));
  // A route "added later by another package": covered by the guard without any per-route work.
  app.post('/clients/:id/watchlist', (_q, r) => void r.json({ writes: ++state.writes }));
  app.post('/swap/quote', (_q, r) => void r.json({ writes: ++state.writes }));
  app.post('/tx/:id/cancel', (_q, r) => void r.json({ writes: ++state.writes }));
  app.post('/brand-new-route', (_q, r) => void r.json({ writes: ++state.writes }));
  app.get('/attestations/:id', (_q, r) => void r.json({ ok: true }));
  app.get('/admin/overview', (_q, r) => void r.json({ ok: true }));
  app.post('/admin/reset', (_q, r) => void r.json({ resets: ++state.resets }));
  app.post('/admin/clients/:id/reset', (_q, r) => void r.json({ clientResets: ++state.clientResets }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Opts = { method?: string; token?: string; origin?: string; body?: unknown; contentType?: string | null; internal?: string; raw?: string };
async function call(p: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  const method = o.method ?? (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET');
  if (method === 'POST' && o.contentType !== null) headers['content-type'] = o.contentType ?? 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.origin) headers.origin = o.origin;
  if (o.internal) headers['x-internal-token'] = o.internal;
  const res = await fetch(base + p, { method, headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}
const alice = () => issueToken({ sub: ALICE, role: 'client' });
const snapshot = () => ({ ...state });

test('allowed origin: CORS headers echo that exact origin (no wildcard) and preflight is answered', async () => {
  const r = await call(`/clients/${ALICE}`, { token: alice(), origin: OK_ORIGIN });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), OK_ORIGIN);
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  const pre = await call(`/clients/${ALICE}/contacts`, { method: 'OPTIONS', origin: OK_ORIGIN });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), OK_ORIGIN);
  assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);
  assert.doesNotMatch(pre.headers.get('access-control-allow-headers') ?? '', /x-internal-token/);
  // Capacitor app origins are on the default dev list
  assert.equal((await call('/health', { origin: 'capacitor://localhost' })).status, 200);
});

test('hostile origin is refused (403) before any handler runs — even with a valid token', async () => {
  const s0 = snapshot();
  const r = await call(`/clients/${ALICE}/contacts`, { token: alice(), origin: EVIL, body: { name: 'x' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'origin-not-allowed');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const pre = await call(`/clients/${ALICE}/contacts`, { method: 'OPTIONS', origin: EVIL });
  assert.equal(pre.status, 403);
  assert.equal((await call('/health', { origin: 'null' })).status, 403);
  assert.equal((await call('/admin/reset', { origin: EVIL, internal: process.env.INTERNAL_API_TOKEN, body: {} })).status, 403);
  assert.deepEqual(snapshot(), s0);
});

test('unauthenticated call → 401 and nothing changes; public routes stay public', async () => {
  const s0 = snapshot();
  assert.equal((await call('/health')).status, 200);
  for (const p of [`/clients/${ALICE}/contacts`, `/clients/${ALICE}/watchlist`, '/swap/quote', '/brand-new-route']) {
    const r = await call(p, { body: { clientId: ALICE } });
    assert.equal(r.status, 401, p);
    assert.equal(r.json.code, 'auth-required');
  }
  assert.equal((await call(`/clients/${ALICE}`)).status, 401);
  assert.deepEqual(snapshot(), s0);
});

test('a client token only acts on its own client id (path, body, query, resource owner); default deny otherwise', async () => {
  const s0 = snapshot();
  const t = alice();
  assert.equal((await call(`/clients/${BRUNO}`, { token: t })).status, 403);
  assert.equal((await call(`/clients/${BRUNO}/watchlist`, { token: t, body: {} })).status, 403, 'a route added later is covered');
  assert.equal((await call('/swap/quote', { token: t, body: { clientId: BRUNO } })).status, 403);
  assert.equal((await call(`/clients/${ALICE}/contacts`, { token: t, body: { clientId: BRUNO } })).status, 403, 'path and body must both match');
  assert.equal((await call(`/clients/${ALICE}?clientId=${BRUNO}`, { token: t })).status, 403);
  assert.equal((await call('/swap/quote', { token: t, body: { clientId: [ALICE] } })).status, 400, 'non-string clientId (type confusion) refused');
  assert.equal((await call('/brand-new-route', { token: t, body: {} })).status, 403, 'no owner determinable → deny');
  assert.equal((await call('/tx/tx-unknown/cancel', { token: t, body: {} })).status, 404);
  assert.equal((await call('/tx/tx-alice/cancel', { token: issueToken({ sub: BRUNO, role: 'client' }), body: {} })).status, 403);
  assert.equal((await call(`/CLIENTS/${BRUNO}/contacts/`, { token: t, body: {} })).status, 403, 'case / trailing slash variants');
  assert.deepEqual(snapshot(), s0);
  assert.equal((await call(`/clients/${ALICE}/contacts`, { token: t, body: { name: 'Bob' } })).status, 200);
  assert.equal((await call('/tx/tx-alice/cancel', { token: t, body: {} })).status, 200);
  assert.equal(state.writes, s0.writes + 2);
});

test('CSRF: form-encoded / text/plain / missing content-type POSTs are refused (415) with no state change', async () => {
  const s0 = snapshot();
  const t = alice();
  for (const ct of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain', null]) {
    const r = await call(`/clients/${ALICE}/contacts`, { token: t, origin: OK_ORIGIN, raw: 'name=Mallory', contentType: ct });
    assert.equal(r.status, 415, String(ct));
  }
  // Even a "simple" cross-site form POST to the global reset with no credentials changes nothing
  assert.equal((await call('/admin/reset', { raw: 'x=1', contentType: 'application/x-www-form-urlencoded', origin: EVIL })).status, 403);
  assert.equal((await call('/admin/reset', { raw: 'x=1', contentType: 'application/x-www-form-urlencoded' })).status, 415);
  assert.deepEqual(snapshot(), s0);
});

test('reset routes: GET is never accepted; POST needs the internal token or a compliance session', async () => {
  const s0 = snapshot();
  assert.equal((await call('/admin/reset')).status, 405);
  assert.equal((await call('/admin/reset', { internal: process.env.INTERNAL_API_TOKEN })).status, 405, 'GET refused even with the token');
  assert.equal((await call(`/admin/clients/${ALICE}/reset`, { token: alice() })).status, 405);
  assert.equal((await call('/admin/reset', { body: {} })).status, 401);
  assert.equal((await call('/admin/reset', { body: {}, internal: 'wrong-token' })).status, 401);
  assert.equal((await call('/admin/reset', { body: {}, token: alice() })).status, 403);
  assert.equal((await call('/admin/overview', { token: alice() })).status, 403);
  assert.deepEqual(snapshot(), s0);
  assert.equal((await call('/admin/reset', { body: {}, internal: process.env.INTERNAL_API_TOKEN })).status, 200);
  assert.equal((await call('/admin/reset', { body: {}, token: issueToken({ sub: 'compliance:compliance', role: 'compliance' }) })).status, 200);
  assert.equal((await call('/admin/overview', { token: issueToken({ sub: 'compliance:compliance', role: 'compliance' }) })).status, 200);
  assert.equal(state.resets, s0.resets + 2);
});

test('per-client demo reset needs that client’s FRESH token (re-authentication)', async () => {
  const s0 = snapshot();
  const r1 = await call(`/admin/clients/${ALICE}/reset`, { body: {}, token: alice() });
  assert.equal(r1.status, 403);
  assert.equal(r1.json.code, 'reauth-required');
  const fresh = issueToken({ sub: ALICE, role: 'client', fresh: true });
  assert.equal((await call(`/admin/clients/${BRUNO}/reset`, { body: {}, token: fresh })).status, 403, 'fresh token of another client');
  assert.equal((await call(`/admin/clients/${ALICE}/reset`, { body: {}, token: issueToken({ sub: 'compliance:x', role: 'compliance', fresh: true }) })).status, 403);
  assert.deepEqual(snapshot(), s0);
  assert.equal((await call(`/admin/clients/${ALICE}/reset`, { body: {}, token: fresh })).status, 200);
  assert.equal(verifyToken(fresh)!.exp - verifyToken(fresh)!.iat, 300, 'fresh token lives 5 minutes');
});

test('reset routes do not exist with NODE_ENV=production (even with the internal token)', async () => {
  const s0 = snapshot();
  process.env.NODE_ENV = 'production';
  try {
    assert.equal((await call('/admin/reset', { body: {}, internal: process.env.INTERNAL_API_TOKEN })).status, 404);
    assert.equal((await call(`/admin/clients/${ALICE}/reset`, { body: {}, token: issueToken({ sub: ALICE, role: 'client', fresh: true }) })).status, 404);
  } finally {
    delete process.env.NODE_ENV;
  }
  assert.deepEqual(snapshot(), s0);
});

test('expired, tampered, foreign-key and malformed tokens are refused (401)', async () => {
  const s0 = snapshot();
  const expired = issueToken({ sub: ALICE, role: 'client' }, -10);
  const good = alice();
  const [payload, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: BRUNO })).toString('base64url');
  const tampered = `${forged}.${sig}`;
  const escalated = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'compliance' })).toString('base64url')}.${sig}`;
  for (const t of [expired, tampered, escalated, `${payload}.`, 'not-a-token', `${good}x`]) {
    const r = await call(`/clients/${ALICE}/contacts`, { token: t, body: {} });
    assert.equal(r.status, 401, t.slice(0, 20));
  }
  const key = process.env.SESSION_SIGNING_KEY;
  process.env.SESSION_SIGNING_KEY = 'another-signing-key-0123456789abcdefghijklmnop';
  const foreign = issueToken({ sub: ALICE, role: 'client' });
  process.env.SESSION_SIGNING_KEY = key;
  assert.equal(verifyToken(foreign), null);
  assert.equal((await call('/admin/overview', { token: escalated })).status, 401);
  assert.deepEqual(snapshot(), s0);
});

test('internal token: service routes only, never from a browser (Origin present), never exposed to CORS', async () => {
  assert.equal((await call('/attestations/a1', { token: alice() })).status, 403);
  assert.equal((await call('/attestations/a1', { internal: process.env.INTERNAL_API_TOKEN })).status, 200);
  assert.equal((await call('/attestations/a1', { internal: process.env.INTERNAL_API_TOKEN, origin: OK_ORIGIN })).status, 401);
  assert.equal((await call('/reauth', { token: alice(), body: {} })).status, 404, 'session route reached (no handler here)');
  assert.equal((await call('/reauth', { body: {} })).status, 401);
});

test('secrets: generated once into the env file (mode 600), never overwritten, required in production', () => {
  delete process.env.TEST_SECRET_X;
  const v = ensureSecret('TEST_SECRET_X', 'test');
  assert.ok(v.length >= 32);
  assert.equal((fs.statSync(process.env.ENV_FILE!).mode & 0o777).toString(8), '600');
  delete process.env.TEST_SECRET_X;
  assert.equal(ensureSecret('TEST_SECRET_X', 'test'), v, 'an existing value in the file is reused, not regenerated');
  assert.equal(fs.readFileSync(process.env.ENV_FILE!, 'utf8').match(/TEST_SECRET_X=/g)?.length, 1);
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => ensureSecret('TEST_SECRET_MISSING', 'test'), /production/);
    assert.throws(() => auth.allowedOrigins(), /ALLOWED_ORIGINS/);
  } finally {
    delete process.env.NODE_ENV;
  }
  process.env.ALLOWED_ORIGINS = 'https://app.example, *';
  assert.throws(() => auth.allowedOrigins(), /explicit/);
  process.env.ALLOWED_ORIGINS = 'https://app.example/';
  assert.deepEqual([...auth.allowedOrigins()], ['https://app.example']);
  delete process.env.ALLOWED_ORIGINS;
});
