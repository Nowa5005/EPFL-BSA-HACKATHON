import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMaskState, isWalletPath } from '../src/lib/maskState';

test('amounts start masked on every new store (new page load = new entry)', () => {
  assert.equal(createMaskState().isMasked(), true);
});

test('reveal is explicit and can be undone immediately', () => {
  const m = createMaskState();
  m.reveal();
  assert.equal(m.isMasked(), false);
  m.hide();
  assert.equal(m.isMasked(), true);
});

test('locking the wallet masks again', () => {
  const m = createMaskState();
  m.reveal();
  m.onLockChange(true);
  assert.equal(m.isMasked(), false);
  m.onLockChange(false);
  assert.equal(m.isMasked(), true);
});

test('navigating inside the wallet keeps the state; leaving it masks again', () => {
  const m = createMaskState();
  m.reveal();
  for (const p of ['/wallet', '/wallet/transactions', '/asset/ETH', '/send', '/wallet/tx/abc']) m.onNavigate(p);
  assert.equal(m.isMasked(), false);
  m.onNavigate('/sq');
  assert.equal(m.isMasked(), true);
  m.reveal();
  m.onNavigate('/wallet/unlock');
  assert.equal(m.isMasked(), true);
});

test('wallet path matching', () => {
  assert.equal(isWalletPath('/wallet'), true);
  assert.equal(isWalletPath('/wallets-fake'), false);
  assert.equal(isWalletPath('/sq/markets'), false);
  assert.equal(isWalletPath('/login'), false);
});
