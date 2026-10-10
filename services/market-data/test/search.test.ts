import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSearch } from '../src/providers';

test('search ranking puts default-list instruments (NESN.SW on SIX) before other listings, keeping provider order otherwise', () => {
  const hits = [{ id: 'yf:NSRGY' }, { id: 'yf:NESN.SW' }, { id: 'yf:NESTLEIND.NS' }, { id: 'cg:bitcoin' }, { id: 'cg:nestle-coin' }];
  assert.deepEqual(rankSearch(hits).map((h) => h.id), ['yf:NESN.SW', 'cg:bitcoin', 'yf:NSRGY', 'yf:NESTLEIND.NS', 'cg:nestle-coin']);
});

test('search ranking is stable when nothing is known', () => {
  const hits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(rankSearch(hits, () => false), hits);
});
