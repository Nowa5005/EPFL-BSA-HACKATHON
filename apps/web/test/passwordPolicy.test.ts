import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword } from '../src/lib/passwordPolicy';

const alice = { firstName: 'Alice', lastName: 'Muster', birthDate: '1992-03-14' };

test('a strong password passes', () => {
  assert.equal(checkPassword('Lac-Leman-2026-bleu!', alice).ok, true);
});
test('too short is refused', () => {
  const r = checkPassword('Ab12!xyzw', alice);
  assert.equal(r.ok, false);
  assert.match(r.message!, /15 caractères/);
});
test('needs 5 letters, upper and lower case', () => {
  assert.equal(checkPassword('1234567890123!Ab', alice).ok, false); // 2 letters
  assert.equal(checkPassword('abcdefgh12345!!!', alice).ok, false); // no upper
  assert.equal(checkPassword('ABCDEFGH12345!!!', alice).ok, false); // no lower
});
test('needs 2 digits and a special character', () => {
  assert.equal(checkPassword('Montagnes-Vertes-1', alice).ok, false);
  assert.equal(checkPassword('MontagnesVertes12', alice).ok, false);
});
test('must not contain the name (accents and case ignored)', () => {
  const r = checkPassword('Montagne-ÁLICE-42!', alice);
  assert.equal(r.ok, false);
  assert.equal(r.message, 'Votre mot de passe ne doit pas contenir votre nom ou votre date de naissance.');
  assert.ok(!r.message!.includes('Alice'));
  assert.equal(checkPassword('Montagne-muster-42!', alice).ok, false);
});
test('must not contain the birth date in any common format', () => {
  for (const d of ['14031992', '19920314', '140392', '14/03/1992', '14.03.92', '1992-03-14'])
    assert.equal(checkPassword(`Montagne-Verte-${d}!`, alice).ok, false, d);
});
test('paste-friendly: long passwords up to 128 chars accepted, beyond refused', () => {
  assert.equal(checkPassword('Aa1!' + 'x'.repeat(100) + '23', alice).ok, true);
  assert.equal(checkPassword('Aa12!' + 'x'.repeat(130), alice).ok, false);
});
