import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSafeTx, usdcTransferData, USDC_ADDRESS } from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-stmt-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';
const S = await import('../src/statements');

test('cut-off instant: 31.12 23:59:59 Europe/Zurich is 22:59:59Z (CET, winter)', () => {
  assert.equal(S.yearEndCutoff(2025).toISOString(), '2025-12-31T22:59:59.000Z');
  assert.equal(S.yearEndCutoff(2026).toISOString(), '2026-12-31T22:59:59.000Z');
  assert.equal(S.yearStart(2026).toISOString(), '2025-12-31T23:00:00.000Z');
  assert.equal(S.formatZurich(S.yearEndCutoff(2025)), '2025-12-31 23:59:59 +01:00');
});

test('DST handled: summer wall-clock times convert with +02:00, and around the switches', () => {
  assert.equal(S.zurichToUtc(2026, 7, 1, 0, 0, 0).toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(S.zurichOffsetMinutes(new Date('2026-03-29T00:59:59Z')), 60); // before the spring switch (01:00Z)
  assert.equal(S.zurichOffsetMinutes(new Date('2026-03-29T01:00:00Z')), 120);
  assert.equal(S.zurichOffsetMinutes(new Date('2026-10-25T00:59:59Z')), 120); // before the autumn switch (01:00Z)
  assert.equal(S.zurichOffsetMinutes(new Date('2026-10-25T01:00:00Z')), 60);
  assert.equal(S.formatZurich(new Date('2026-08-01T10:00:00Z')), '2026-08-01 12:00:00 +02:00');
});

test('block search: last block with timestamp ≤ cut-off (exact hit, between blocks, before genesis, after latest)', async () => {
  const ts = (n: number) => 1_000_000 + n * 12; // 12 s blocks
  let calls = 0;
  const tsOf = async (n: number) => (calls++, ts(n));
  assert.equal(await S.findBlockAtOrBefore(ts(500), 1000, tsOf), 500);
  assert.equal(await S.findBlockAtOrBefore(ts(500) + 11, 1000, tsOf), 500);
  assert.equal(await S.findBlockAtOrBefore(ts(500) - 1, 1000, tsOf), 499);
  assert.equal(await S.findBlockAtOrBefore(999_999, 1000, tsOf), null);
  assert.equal(await S.findBlockAtOrBefore(ts(5000), 1000, tsOf), 1000);
  assert.equal(await S.findBlockAtOrBefore(ts(500), 1000, tsOf, 900), 500); // a wrong narrowing guess still converges
  calls = 0;
  await S.findBlockAtOrBefore(ts(123_456), 10_000_000, tsOf);
  assert.ok(calls < 30, `binary search used ${calls} calls`);
});

const tx = (o: any) => ({ id: o.id ?? Math.random().toString(36), clientId: 'C1', status: 'confirmed', from: '0xA', to: '0xB', source: 'wallet', feesSponsored: true, createdAt: o.at, updatedAt: o.at, confirmedAt: o.status === 'confirmed' || !o.status ? o.at : undefined, ...o });

test('year-end balance reconstruction (fallback) from a fixture: cut-off respected, simulated/failed ignored, flagged incomplete', () => {
  const fx = [
    tx({ kind: 'receive', asset: 'USDC', amount: '100.123456', at: '2025-03-01T10:00:00Z' }),
    tx({ kind: 'send', asset: 'USDC', amount: '20.000001', at: '2025-06-01T10:00:00Z' }),
    tx({ kind: 'receive', asset: 'ETH', amount: '0.000000000000000001', at: '2025-07-01T10:00:00Z' }),
    tx({ kind: 'receive', asset: 'USDC', amount: '5', at: '2025-12-31T22:59:59Z' }), // exactly at the cut-off → counted
    tx({ kind: 'receive', asset: 'USDC', amount: '7', at: '2025-12-31T23:00:00Z' }), // 00:00 on 1.1 Zurich → next year
    tx({ kind: 'receive', asset: 'USDC', amount: '250', at: '2025-05-01T10:00:00Z', simulated: true, source: 'simulation' }),
    tx({ kind: 'send', asset: 'USDC', amount: '50', at: '2025-05-02T10:00:00Z', status: 'failed' }),
    tx({ kind: 'send', asset: 'USDC', amount: '1', at: '2025-12-30T10:00:00Z', status: 'pending' }),
  ];
  const r = S.reconstructFromRecords(fx as any, S.yearEndCutoff(2025));
  assert.equal(r.quantities.USDC, '85.123455');
  assert.equal(r.quantities.ETH, '0.000000000000000001');
  assert.equal(r.incomplete, true);
  assert.equal(r.pendingAtCutoff, 1);
  assert.equal(r.counted, 4);
});

test('CSV cells: RFC 4180 quoting and formula-injection protection', () => {
  assert.equal(S.csvCell('plain'), 'plain');
  assert.equal(S.csvCell('a,b'), '"a,b"');
  assert.equal(S.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(S.csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(S.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(S.csvCell('+41 79'), "'+41 79");
  assert.equal(S.csvCell('-5'), "'-5");
  assert.equal(S.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(S.csvCell('\tx'), "'\tx");
  assert.equal(S.csvCell('\r=1'), `"'\r=1"`);
  assert.equal(S.csvCell(null), '');
  const csv = S.toCsv([]);
  assert.ok(csv.startsWith('﻿date_iso_utc,date_local,type,network,asset,quantity,direction,fee_amount,fee_currency,from_address,to_address,tx_hash,status,chf_value,chf_method\r\n'));
});

test('CSV exhaustiveness: every record of the period, none outside; quantities unsigned with full precision', () => {
  const safe = '0x00000000000000000000000000000000000000aa';
  const bob = '0x00000000000000000000000000000000000000b0';
  const wtx = [
    tx({ id: 'w1', kind: 'receive', asset: 'USDC', amount: '1.000001', at: '2025-12-31T23:00:00Z', txHash: '0x01' }), // 1.1.2026 00:00 Zurich → in 2026
    tx({ id: 'w2', kind: 'send', asset: 'ETH', amount: '0.123456789012345678', at: '2026-05-01T10:00:00Z', txHash: '0x02' }),
    tx({ id: 'w3', kind: 'receive', asset: 'USDC', amount: '250', at: '2026-06-01T10:00:00Z', simulated: true, source: 'simulation' }),
    tx({ id: 'w4', kind: 'receive', asset: 'USDC', amount: '3', at: '2025-12-31T22:59:59Z', txHash: '0x04' }), // 2025
    tx({ id: 'w5', kind: 'send', asset: 'USDC', amount: '9', at: '2026-12-31T23:00:00Z', txHash: '0x05' }), // 2027
  ];
  const approve = buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(bob, 1n).replace(/^0xa9059cbb/, '0x095ea7b3'), nonce: 3n });
  const reqs = [
    { id: 'r1', clientId: 'C1', safeAddress: safe, safeTx: approve, status: 'executed', txHash: '0x0a', createdAt: '2026-02-01T10:00:00Z', updatedAt: '2026-02-01T10:00:05Z' },
    { id: 'r2', clientId: 'C1', safeAddress: safe, safeTx: approve, status: 'executed', txHash: '0x02', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' }, // same tx as w2 → not duplicated
    { id: 'r3', clientId: 'C1', safeAddress: safe, safeTx: approve, status: 'rejected', createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z' },
  ];
  const rows = S.collectCsvRows({ walletTxs: wtx as any, txRequests: reqs as any, safeAddress: safe, deployTxHash: '0xde', deployedAt: '2026-01-15T09:00:00Z' }, S.yearStart(2026), new Date(S.yearEndCutoff(2026).getTime() + 999));
  assert.deepEqual(rows.map((r) => r.tx_hash || r.type), ['0x01', '0xde', '0x0a', '0x02', 'receive']);
  const eth = rows.find((r) => r.tx_hash === '0x02')!;
  assert.equal(eth.quantity, '0.123456789012345678');
  assert.equal(eth.direction, 'out');
  assert.equal(eth.fee_amount, '0');
  assert.equal(eth.fee_currency, 'sponsored');
  assert.ok(rows.every((r) => !r.quantity.startsWith('-')));
  assert.equal(rows[0].date_local, '2026-01-01 00:00:00 +01:00');
  assert.match(rows.find((r) => r.type === 'receive' && !r.tx_hash)!.status, /simulated/);
  assert.equal(rows.find((r) => r.tx_hash === '0x0a')!.type, 'token-approval');
});
