import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHealth, probe } from '../src/lib/serviceHealth';

test('#21 probe: 2xx → up; error status, network error or timeout → down (never throws)', async () => {
  const ok = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const ko = (async () => new Response('', { status: 503 })) as typeof fetch;
  const boom = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const hang = ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
  assert.equal(await probe('http://x', 100, ok), true);
  assert.equal(await probe('http://x', 100, ko), false);
  assert.equal(await probe('http://x', 100, boom), false);
  const t0 = Date.now();
  assert.equal(await probe('http://x', 50, hang), false);
  assert.ok(Date.now() - t0 < 1000, 'timeout honoured');
});

test('#21 two consecutive failures before "down"; one success resets', () => {
  let s = nextHealth(0, false);
  assert.deepEqual(s, { failures: 1, down: false });
  s = nextHealth(s.failures, false);
  assert.equal(s.down, true);
  assert.deepEqual(nextHealth(s.failures, true), { failures: 0, down: false });
});
