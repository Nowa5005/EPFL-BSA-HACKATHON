import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('secret initialization creates private durable keys and refuses replacement', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'backend.env');
  const script = fileURLToPath(new URL('./init-secrets.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script], { env: { ...process.env, BACKEND_ENV_FILE: file }, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0);
  const original = fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const values = original.trim().split('\n').map(line => line.split('=')[1]);
  assert.equal(values.length, 3);
  assert.equal(new Set(values).size, 3);
  for (const value of values) {
    assert.ok(value.length >= 32);
    assert.ok(!first.stdout.includes(value));
  }
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
