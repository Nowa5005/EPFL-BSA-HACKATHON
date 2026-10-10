import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexlify, randomBytes } from 'ethers';
import { availableQuestions, decodeRecoveryCode, encodeRecoveryCode, normalizeAnswer, RECOVERY_QUESTIONS } from '../src/index';

test('recovery code round-trips a 33-byte share', () => {
  for (let i = 0; i < 50; i++) {
    const share = hexlify(randomBytes(33));
    const code = encodeRecoveryCode(share);
    assert.match(code, /^([0-9A-Z]{4} ){18}[0-9A-Z]{4}$/);
    const r = decodeRecoveryCode(code.toLowerCase().replace(/ /g, '-'));
    assert.deepEqual(r, { ok: true, share });
  }
});

test('a single typo is located in its group', () => {
  const code = encodeRecoveryCode(hexlify(randomBytes(33)));
  const groups = code.split(' ');
  const g = groups[4];
  const alt = g[0] === 'A' ? 'B' : 'A';
  groups[4] = alt + g.slice(1);
  const r = decodeRecoveryCode(groups.join(' '));
  assert.equal(r.ok, false);
  assert.equal((r as any).group, 5);
  assert.match((r as any).error, /groupe 5/);
});

test('wrong length is reported', () => {
  const r = decodeRecoveryCode('ABCD EFGH');
  assert.equal(r.ok, false);
});

test('a chosen question disappears from the other slots', () => {
  const sel = [1, null, 7];
  assert.ok(!availableQuestions(sel, 1).includes(1));
  assert.ok(!availableQuestions(sel, 1).includes(7));
  assert.ok(availableQuestions(sel, 0).includes(1)); // own choice stays available
  assert.equal(availableQuestions(sel, 1).length, RECOVERY_QUESTIONS.length - 2);
  assert.equal(availableQuestions([null, null, null], 0).length, 15);
});

test('answers are normalised', () => {
  assert.equal(normalizeAnswer('  Économie   Générale. '), 'economie generale');
  assert.equal(normalizeAnswer('RÉX!!'), 'rex');
  assert.equal(normalizeAnswer("l'école"), "l'ecole");
});
