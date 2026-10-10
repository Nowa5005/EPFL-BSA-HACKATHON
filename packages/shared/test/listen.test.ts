import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bindHost, boundUrl, listenService } from '../src/listen';

const app = { listen: (port: number, host: string, cb: () => void) => http.createServer((_q, r) => r.end('ok')).listen(port, host, cb) };

test('#2 bind host defaults to loopback; HOST overrides', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(bindHost({ HOST: '  ' }), '127.0.0.1');
  assert.equal(bindHost({ HOST: '0.0.0.0' }), '0.0.0.0');
});

test('#2 a service started with HOST unset is bound to 127.0.0.1 only and logs the real address', async () => {
  const saved = process.env.HOST;
  delete process.env.HOST;
  const logs: string[] = [];
  const orig = console.log;
  console.log = (m: string) => logs.push(String(m));
  try {
    const server = await new Promise<http.Server>((resolve) => {
      const s = listenService(app, 0, 'test-service', () => resolve(s));
    });
    const a = server.address() as AddressInfo;
    assert.equal(a.address, '127.0.0.1');
    assert.equal(boundUrl(server), `http://127.0.0.1:${a.port}`);
    assert.match(logs.join('\n'), new RegExp(`test-service listening on http://127\\.0\\.0\\.1:${a.port}`));
    await new Promise((r) => server.close(r));
  } finally {
    console.log = orig;
    if (saved !== undefined) process.env.HOST = saved;
  }
});
