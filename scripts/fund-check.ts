// (--quiet: used automatically by `npm run dev`; never fails the start)
// Ops helper (Swissquote side): shows the balances of the relayer and the treasury, and tops up
// the treasury's gas from the relayer when needed.
//   npm run fund-check                      → report + treasury gas top-up
//   npm run fund-check -- --tip 0xADDR 0.002 → send a little Sepolia ETH to any address
//     (used before the escape-hatch demo: "the client bought a little ETH anywhere to pay gas herself")

import fs from 'node:fs';
import path from 'node:path';
import { Wallet, formatEther, formatUnits, parseEther } from 'ethers';
import { USDC_DECIMALS, explorerTx, makeProvider, usdcContract } from '@sq/shared';
import { loadDotenv } from '@sq/shared/server';
import { decryptKey, isEncrypted } from '../services/sq-cosigner/src/keyvault';

loadDotenv();

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => (fs.existsSync(path.join(root, f)) ? JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) : null);
const provider = makeProvider();
const keys = read('services/sq-cosigner/data/keys.json');
const bank = read('services/sq-bank/data/bank.json');
const quiet = process.argv.includes('--quiet');
if (!keys) {
  if (!quiet) console.log('Start the services once (npm run dev) to generate the keys.');
  process.exit(0);
}

// keys.json is encrypted at rest (keystore + SERVICE_MASTER_KEY from .env); older plaintext files are still read.
const relayer = (isEncrypted(keys) ? decryptKey(keys.relayer, process.env.SERVICE_MASTER_KEY ?? '') : new Wallet(keys.relayer.privateKey)).connect(provider);
const usdc = usdcContract(provider);
const show = async (label: string, addr: string) => {
  const [e, u] = await Promise.all([provider.getBalance(addr), usdc.balanceOf(addr) as Promise<bigint>]);
  console.log(`${label.padEnd(22)} ${addr}  ${formatEther(e).padStart(10)} ETH  ${formatUnits(u, USDC_DECIMALS).padStart(10)} USDC`);
  return { eth: e, usdc: u };
};

process.on('unhandledRejection', (e) => {
  console.log(`fund-check skipped: ${(e as Error).message}`);
  process.exit(0);
});

const rel = await show('Relayer (gas sponsor)', relayer.address);
if (rel.eth === 0n) console.log('  ⚠️  Relayer has no ETH — fund it with the Sepolia faucet (see POUR_NOA.md).');

const args = process.argv.slice(2).filter((a) => a !== '--quiet');
if (args[0] === '--tip') {
  const [, to, amount = '0.002'] = args;
  const tx = await relayer.sendTransaction({ to, value: parseEther(amount) });
  await tx.wait();
  console.log(`Sent ${amount} ETH to ${to}: ${explorerTx(tx.hash)}`);
  process.exit(0);
}

if (bank) {
  const t = await show('Treasury (bank USDC)', bank.treasury.address);
  if (t.eth < parseEther('0.001') && rel.eth > parseEther('0.004')) {
    const tx = await relayer.sendTransaction({ to: bank.treasury.address, value: parseEther('0.003') });
    await tx.wait();
    console.log(`  → topped up treasury gas with 0.003 ETH: ${explorerTx(tx.hash)}`);
  }
  if (t.usdc === 0n) console.log('  ⚠️  Treasury has no test USDC — use faucet.circle.com (see POUR_NOA.md).');
}
