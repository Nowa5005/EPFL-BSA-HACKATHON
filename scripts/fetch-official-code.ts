// Snapshots the runtime bytecode of the OFFICIAL contracts deployed on Sepolia (Safe v1.4.1, Zodiac Delay v1.0.1,
// Zodiac ModuleProxyFactory v1.2.0) into contracts/test/fixtures/official-code.json, so the contract tests run
// offline against byte-for-byte the same code (installed at the same addresses with hardhat_setCode).
//   npx tsx scripts/fetch-official-code.ts
import fs from 'node:fs';
import path from 'node:path';
import { keccak256 } from 'ethers';
import { makeProvider } from '@sq/shared';
import { OFFICIAL_CONTRACTS } from '@sq/shared/protection';

const out = path.resolve(import.meta.dirname, '../contracts/test/fixtures/official-code.json');
const provider = makeProvider();
const result: Record<string, { name: string; address: string; codehash: string; code: string }> = {};
for (const [name, address] of Object.entries(OFFICIAL_CONTRACTS)) {
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error(`${name} has no code on Sepolia at ${address}`);
  result[name] = { name, address, codehash: keccak256(code), code };
  console.log(`${name.padEnd(28)} ${address} ${(code.length - 2) / 2} bytes ${keccak256(code)}`);
}
fs.writeFileSync(out, JSON.stringify({ chainId: 11155111, fetchedAt: new Date().toISOString(), contracts: result }, null, 1) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
