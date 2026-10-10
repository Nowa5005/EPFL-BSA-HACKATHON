// Deploys MyWallGuard ONCE on Sepolia with the Swissquote relayer (a singleton guard serving every My Wall Safe:
// each Safe's configuration is stored under its own address and only that Safe can change it).
//   npm run deploy:guard               → checks the official contracts, the relayer balance, deploys if needed
//   npm run deploy:guard -- --verify   → also submits the source to Sourcify (no API key needed)
// Writes the public address to packages/shared/src/protection.addresses.ts (no key is ever written).

import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, Wallet, formatEther, keccak256 } from 'ethers';
import { explorerAddress, explorerTx, makeProvider } from '@sq/shared';
import { MYWALL_GUARD_ADDRESS, OFFICIAL_CONTRACTS, SAFE_MULTISEND_CALL_ONLY } from '@sq/shared/protection';
import { loadDotenv } from '@sq/shared/server';
import { decryptKey, isEncrypted } from '../services/sq-cosigner/src/keyvault';

loadDotenv();
const root = path.resolve(import.meta.dirname, '..');
const provider = makeProvider();
const MIN_BALANCE = 2_000_000_000_000_000n; // 0.002 ETH — refuse to start below this

async function main() {
  // 1. The official contracts we rely on are deployed on Sepolia with the expected code.
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'contracts/test/fixtures/official-code.json'), 'utf8')).contracts;
  for (const [name, address] of Object.entries(OFFICIAL_CONTRACTS)) {
    const code = await provider.getCode(address);
    if (keccak256(code) !== fixture[name].codehash) throw new Error(`${name} at ${address}: unexpected code on Sepolia`);
    console.log(`✔ ${name.padEnd(32)} ${address}`);
  }

  const art = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/MyWallGuard.json'), 'utf8'));
  if (MYWALL_GUARD_ADDRESS && !process.argv.includes('--force')) {
    const code = await provider.getCode(MYWALL_GUARD_ADDRESS);
    if (code !== '0x') {
      console.log(`MyWallGuard already deployed: ${explorerAddress(MYWALL_GUARD_ADDRESS)} (use --force to deploy a new one)`);
      if (process.argv.includes('--verify')) await sourcify(MYWALL_GUARD_ADDRESS, art);
      return;
    }
  }

  // Recording a deployment made earlier (e.g. the check failed after the transaction was mined).
  const adopt = process.argv.indexOf('--adopt');
  if (adopt > 0) {
    const hash = process.argv[adopt + 1];
    const rc = await provider.getTransactionReceipt(hash);
    if (!rc?.contractAddress || rc.status !== 1) throw new Error('Not a successful contract creation');
    await record(rc.contractAddress, hash, rc.from, art);
    if (process.argv.includes('--verify')) await sourcify(rc.contractAddress, art);
    return;
  }

  // 2. Relayer (keys.json is encrypted at rest; the key is only held in memory here).
  const keys = JSON.parse(fs.readFileSync(path.join(root, 'services/sq-cosigner/data/keys.json'), 'utf8'));
  const relayer = (isEncrypted(keys) ? decryptKey(keys.relayer, process.env.SERVICE_MASTER_KEY ?? '') : new Wallet(keys.relayer.privateKey)).connect(provider);
  const bal = await provider.getBalance(relayer.address);
  console.log(`relayer ${relayer.address}: ${formatEther(bal)} SepoliaETH`);
  if (bal < MIN_BALANCE) throw new Error('Relayer balance too low — top it up from a Sepolia faucet first');

  // 3. Deploy.
  const factory = new ContractFactory(art.abi, art.bytecode, relayer);
  const deployTx = await factory.getDeployTransaction(SAFE_MULTISEND_CALL_ONLY);
  const gas = await provider.estimateGas({ ...deployTx, from: relayer.address });
  const fee = await provider.getFeeData();
  console.log(`deploying MyWallGuard: ~${gas} gas × ${fee.maxFeePerGas ?? fee.gasPrice} wei`);
  const contract = await factory.deploy(SAFE_MULTISEND_CALL_ONLY, { gasLimit: (gas * 12n) / 10n });
  const tx = contract.deploymentTransaction()!;
  console.log(`  tx ${explorerTx(tx.hash)}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  await record(address, tx.hash, relayer.address, art);
  if (process.argv.includes('--verify')) await sourcify(address, art);
}

/** Runtime code on Sepolia = artifact (immutable slots masked), then the public address is written to the repo. */
async function checkRuntime(address: string, art: { deployedBytecode: string; immutableReferences: Record<string, { start: number; length: number }[]> }) {
  const mask = (hex: string) => {
    const b = hex.toLowerCase().slice(2).split('');
    for (const refs of Object.values(art.immutableReferences)) for (const r of refs) for (let i = r.start * 2; i < (r.start + r.length) * 2; i++) b[i] = '0';
    return b.join('');
  };
  const onchain = await provider.getCode(address);
  if (mask(onchain) !== mask(art.deployedBytecode)) throw new Error('Deployed runtime code differs from contracts/artifacts/MyWallGuard.json');
  if (!onchain.toLowerCase().includes(SAFE_MULTISEND_CALL_ONLY.slice(2).toLowerCase())) throw new Error('Immutable MultiSendCallOnly address not found in the runtime code');
  console.log(`✔ MyWallGuard ${explorerAddress(address)} — runtime code = artifact (immutable: MultiSendCallOnly ${SAFE_MULTISEND_CALL_ONLY})`);
}

async function record(address: string, txHash: string, deployer: string, art: any) {
  await checkRuntime(address, art);
  const file = path.join(root, 'packages/shared/src/protection.addresses.ts');
  fs.writeFileSync(
    file,
    `// Written by scripts/deploy-guard.ts — public addresses only (no keys). Ethereum Sepolia (chain 11155111).
export const PROTECTION_DEPLOYMENT = {
  chainId: 11155111,
  guard: '${address}',
  guardDeployTx: '${txHash}',
  guardDeployedAt: '${new Date().toISOString()}',
  deployer: '${deployer}',
} as const;
`,
  );
  console.log(`Wrote ${path.relative(root, file)}`);
}

/** Source verification on Sourcify (API v2, standard-JSON input; no API key). */
async function sourcify(address: string, art: { metadata: string }) {
  const meta = JSON.parse(art.metadata);
  const sources: Record<string, { content: string }> = {};
  for (const src of Object.keys(meta.sources)) {
    const p = src.startsWith('@') ? path.join(root, 'node_modules', src) : path.join(root, src);
    sources[src] = { content: fs.readFileSync(p, 'utf8') };
  }
  const stdJsonInput = { language: 'Solidity', sources, settings: { ...meta.settings, compilationTarget: undefined, outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } } } };
  const res = await fetch(`https://sourcify.dev/server/v2/verify/11155111/${address}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stdJsonInput, compilerVersion: meta.compiler.version, contractIdentifier: 'contracts/MyWallGuard.sol:MyWallGuard' }),
  });
  const body = await res.text();
  console.log(`Sourcify: ${res.status} ${body.slice(0, 300)}`);
  const id = (() => { try { return JSON.parse(body).verificationId; } catch { return undefined; } })();
  for (let i = 0; id && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await (await fetch(`https://sourcify.dev/server/v2/verify/${id}`)).json() as any;
    if (st.isJobCompleted) {
      console.log(`Sourcify job: ${st.error ? 'error ' + JSON.stringify(st.error).slice(0, 300) : JSON.stringify(st.contract?.match ?? st.contract).slice(0, 200)}`);
      break;
    }
  }
  console.log(`Sourcify: https://repo.sourcify.dev/11155111/${address}`);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
