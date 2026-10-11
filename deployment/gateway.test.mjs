import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';

async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

test('gateway forwards login body, query, session and origin; strips internal credentials', async t => {
  let seen;
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    seen = { path: req.url, method: req.method, headers: req.headers, body };
    res.writeHead(201, { 'content-type': 'application/json', 'access-control-allow-origin': 'https://frontend.example' });
    res.end('{"role":"client"}');
  });
  const port = await listen(upstream, t);
  const gateway = await listen(createGateway({ bank: { port, probe: '/ready' } }), t);
  const r = await fetch(`http://127.0.0.1:${gateway}/svc/bank/login?lang=en`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://frontend.example', authorization: 'Bearer example', 'x-internal-token': 'do-not-forward', 'x-forwarded-for': 'spoofed' },
    body: '{"username":"alice","password":"demo"}',
  });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { role: 'client' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://frontend.example');
  assert.equal(seen.path, '/login?lang=en');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.origin, 'https://frontend.example');
  assert.equal(seen.headers.authorization, 'Bearer example');
  assert.equal(seen.headers['x-internal-token'], undefined);
  assert.equal(seen.headers['x-forwarded-for'], undefined);
  assert.equal(JSON.parse(seen.body).username, 'alice');
});

test('readiness fails when an upstream fails, and VASP/internal services are not exposed', async t => {
  let available = true;
  const port = await listen(http.createServer((req, res) => {
    res.writeHead(available ? 200 : 503, { 'content-type': 'application/json' });
    res.end('{"ready":true}');
  }), t);
  const gateway = await listen(createGateway({ bank: { port, probe: '/ready' } }), t);
  const base = `http://127.0.0.1:${gateway}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  available = false;
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).services.bank, false);
  assert.equal((await fetch(`${base}/svc/vasp/trp/identity`)).status, 404);
  assert.equal((await fetch(`${base}/login`)).status, 404);
  assert.equal((await fetch(`${base}/svc/bankish/login`)).status, 404);
});

test('unreachable upstream returns 502 instead of crashing the gateway', async t => {
  const unused = http.createServer();
  const port = await listen(unused, t);
  await new Promise(resolve => unused.close(resolve));
  const gateway = await listen(createGateway({ bank: { port, probe: '/ready' } }), t);
  assert.equal((await fetch(`http://127.0.0.1:${gateway}/svc/bank/login`)).status, 502);
});
