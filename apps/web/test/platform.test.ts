import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameSrc, previewUrlFor, safeAppPath, stripAppFlag } from '../src/lib/previewPaths';
import { resolveServiceUrls } from '../src/lib/services';

test('preview only accepts same-origin app paths (no open redirect)', () => {
  assert.equal(safeAppPath('/sq/markets?tab=crypto'), '/sq/markets?tab=crypto');
  for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null, undefined, '/preview/app?path=/sq'])
    assert.equal(safeAppPath(bad as any), '/sq', String(bad));
  assert.equal(previewUrlFor('//evil.example'), '/preview/app?path=%2Fsq');
});

test('the frame loads the same route marked as app mode, and reports it back without the marker', () => {
  assert.equal(frameSrc('/sq/markets'), '/sq/markets?app=1');
  assert.equal(frameSrc('/wallet?x=1#top'), '/wallet?x=1&app=1#top');
  assert.equal(stripAppFlag('/sq/markets?app=1'), '/sq/markets');
  assert.equal(stripAppFlag('/wallet?x=1&app=1#top'), '/wallet?x=1#top');
});

test('service URLs: localhost by default, build-time host for a device, per-service override', () => {
  assert.equal(resolveServiceUrls({}).cosigner, 'http://localhost:4001');
  const lan = resolveServiceUrls({ VITE_API_HOST: 'http://192.168.1.20/' });
  assert.deepEqual(lan, { cosigner: 'http://192.168.1.20:4001', partner: 'http://192.168.1.20:4002', bank: 'http://192.168.1.20:4003', market: 'http://192.168.1.20:4004' });
  assert.equal(resolveServiceUrls({ VITE_API_HOST: 'http://10.0.2.2', VITE_MARKET_URL: 'https://market.example/' }).market, 'https://market.example');
});

test('#2 phone / tunnel page uses the same-origin Vite proxy; localhost and explicit hosts unchanged', () => {
  const page = (origin: string) => { const u = new URL(origin); return { origin: u.origin, hostname: u.hostname, protocol: u.protocol }; };
  assert.equal(resolveServiceUrls({}, page('http://localhost:5173')).cosigner, 'http://localhost:4001');
  assert.equal(resolveServiceUrls({}, page('http://127.0.0.1:5173')).bank, 'http://localhost:4003');
  assert.equal(resolveServiceUrls({}, page('capacitor://localhost')).bank, 'http://localhost:4003');
  assert.equal(resolveServiceUrls({}, page('http://192.168.1.20:5173')).cosigner, 'http://192.168.1.20:5173/svc/cosigner');
  assert.equal(resolveServiceUrls({}, page('https://abc.trycloudflare.com')).market, 'https://abc.trycloudflare.com/svc/market');
  assert.equal(resolveServiceUrls({ VITE_API_HOST: 'http://10.0.2.2' }, page('http://192.168.1.20:5173')).partner, 'http://10.0.2.2:4002');
});
