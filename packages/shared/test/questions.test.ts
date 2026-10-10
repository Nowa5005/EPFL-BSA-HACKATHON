import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionLabel, questionText, RECOVERY_QUESTION_SET, RECOVERY_QUESTIONS } from '../src/index';

test('15 bilingual recovery questions with unique ids and wordings', () => {
  assert.equal(RECOVERY_QUESTION_SET.length, 15);
  for (const key of ['id', 'en', 'fr'] as const) assert.equal(new Set(RECOVERY_QUESTION_SET.map((q) => q[key])).size, 15);
});

test('stored value stays the historical French wording (existing enrolments keep working)', () => {
  assert.equal(RECOVERY_QUESTIONS[1], 'Quel était le nom de votre premier animal de compagnie ?');
  assert.equal(RECOVERY_QUESTIONS[14], "Quel endroit fréquentiez-vous le plus après l'école ?");
});

test('a stored question is displayed in the chosen language', () => {
  const stored = RECOVERY_QUESTIONS[3];
  assert.equal(questionLabel(stored, 'en'), 'What street did you live on as a child?');
  assert.equal(questionLabel(stored, 'fr'), stored);
  assert.equal(questionLabel(questionText(3, 'en'), 'fr'), stored);
  assert.equal(questionLabel('Unknown custom question?', 'en'), 'Unknown custom question?');
});
