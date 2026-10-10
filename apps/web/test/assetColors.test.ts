// N8: one colour per asset, whatever the naming (symbol, name, market-data id), on phone and desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetColor, assetKey } from '../src/lib/assetColors';

test('the same asset maps to the same colour from every naming', () => {
  for (const n of ['ETH', 'eth', 'Ether', 'WETH', 'cg:ethereum']) assert.equal(assetKey(n), 'eth', n);
  for (const n of ['USDC', 'USD Coin', 'cg:usd-coin']) assert.equal(assetKey(n), 'usdc', n);
  for (const n of ['BTC', 'Bitcoin', 'cg:bitcoin']) assert.equal(assetKey(n), 'btc', n);
  assert.equal(assetColor('ETH')!.fg, 'var(--asset-eth)');
  assert.equal(assetColor('cg:ethereum')!.bg, 'var(--asset-eth-bg)');
});

test('other crypto get the neutral tone; stocks / indices have no asset colour', () => {
  assert.equal(assetKey('cg:solana'), 'other');
  assert.equal(assetColor('yf:NESN.SW'), null);
  assert.equal(assetColor('yf:^SSMI'), null);
  assert.equal(assetColor(''), null);
});
