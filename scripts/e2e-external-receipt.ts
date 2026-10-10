// #3 — e2e step: an EXTERNAL receipt (not initiated by the app) appears in the history with its receipt document.
// The Swissquote treasury is used here as an arbitrary third party: it sends 0.01 test USDC DIRECTLY to the Safe
// (plain ERC-20 transfer, no bank / co-signer route involved), then we poll the co-signer API until the indexer
// has recorded the confirmed row and its document. Skipped (not failed) when the treasury lacks USDC or gas.
// Called from scripts/e2e-demo.ts. The treasury key is read from sq-bank's local data (never printed).

import fs from 'node:fs';
import { Contract, Wallet, formatEther, formatUnits, parseUnits, type Provider } from 'ethers';
import { ERC20_ABI, SERVICE_URLS, USDC_ADDRESS, USDC_DECIMALS, explorerTx } from '@sq/shared';

type Call = <T = any>(method: 'GET' | 'POST', url: string, body?: unknown, expectError?: boolean) => Promise<T>;
type Log = (t: string) => void;

export async function externalReceiptStep(o: { provider: Provider; clientId: string; safe: string; call: Call; ok: Log; info: Log }) {
  const file = new URL('../services/sq-bank/data/bank.json', import.meta.url);
  if (!fs.existsSync(file)) return o.info('skipped: sq-bank data not found (treasury key unavailable)');
  const pk = (JSON.parse(fs.readFileSync(file, 'utf8')) as { treasury?: { privateKey?: string } }).treasury?.privateKey;
  if (!pk) return o.info('skipped: no treasury key');
  const third = new Wallet(pk, o.provider);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, third);
  const amount = parseUnits('0.01', USDC_DECIMALS);
  const [bal, eth] = await Promise.all([usdc.balanceOf(third.address) as Promise<bigint>, o.provider.getBalance(third.address)]);
  if (bal < amount) return o.info(`skipped: third-party sender holds ${formatUnits(bal, USDC_DECIMALS)} USDC (< 0.01)`);
  if (eth < 200_000_000_000_000n) return o.info(`skipped: third-party sender has ${formatEther(eth)} ETH for gas`);

  const sent = await usdc.transfer(o.safe, amount);
  o.info(`third party → Safe: 0.01 USDC ${explorerTx(sent.hash)}`);
  await sent.wait(1);
  const hash = String(sent.hash).toLowerCase();
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const txs = (await o.call<any>('GET', `${SERVICE_URLS.cosigner}/clients/${o.clientId}/wallet-txs`)) as any;
    const list: any[] = Array.isArray(txs) ? txs : Object.values(txs).filter((x) => x && typeof x === 'object' && 'txHash' in (x as object));
    const rows = list.filter((t) => t.txHash?.toLowerCase() === hash && t.kind === 'receive');
    if (rows.length > 1) throw new Error(`external receipt listed ${rows.length} times`);
    const row = rows[0];
    if (row?.status === 'confirmed' && row.docId) {
      const docs = (await o.call<any>('GET', `${SERVICE_URLS.cosigner}/clients/${o.clientId}/documents`)) as any;
      const docList: any[] = Array.isArray(docs) ? docs : Object.values(docs).filter((x) => x && typeof x === 'object' && 'docId' in (x as object));
      if (docList.filter((d) => d.docId === row.docId).length !== 1) throw new Error('receipt document missing or duplicated');
      return o.ok(`indexer recorded the external receipt: ${row.amount} USDC, status confirmed, document ${row.reference}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('external receipt not recorded by the indexer within 150 s');
}
