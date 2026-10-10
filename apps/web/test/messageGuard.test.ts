import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSensitive } from '../src/lib/messageGuard';

test('blocks keys, codes, keystores, passwords and seed-like phrases; allows normal messages', () => {
  assert.ok(findSensitive('ma clé 0x' + 'ab'.repeat(32)));
  assert.ok(findSensitive('ABCD EFGH JKMN PQRS TVWX YZ01 2345 6789 ABCD EFGH JKMN'));
  assert.ok(findSensitive('code: K7QM-2P9X-4RTV'));
  assert.ok(findSensitive('{"Crypto": {"ciphertext": "aa"}}'));
  assert.ok(findSensitive('Mot de passe : Lac-Leman-2026'));
  assert.equal(findSensitive('Bonjour, pouvez-vous me rappeler au sujet de mon virement de 20 USDC vers 0x8f5aC56Fe53A3af46EBb565a936bc094E2Ec3FA0 ? Merci'), null);
});
