// #20 (part D) / #23 — redeploy a client's Safe at the SAME address on another EVM chain.
//
//   npm run redeploy -- <chainId> [--client <clientId> | --safe <0xSafe>] [--execute]
//     chainId: 84532 (Base Sepolia), 421614 (Arbitrum Sepolia), 11155420 (OP Sepolia)
//
// Dry run (default, no gas, no key): reads the client's deployment from the co-signer database (READ-ONLY),
// fetches the original Sepolia deployment transaction, recovers factory/singleton/initializer/saltNonce, checks the
// initializer is chain-independent, checks the canonical Safe v1.4.1 contracts exist on the target chain, then
// predicts the address offline AND by eth_call on the target chain, and verifies both equal the Sepolia address.
//
// --execute: actually sends createProxyWithNonce on the target chain. Needs REDEPLOY_PRIVATE_KEY (a funded EOA on the
// target chain, env var only — never committed). The deployer only pays gas: it gets no rights on the wallet.
// What it does NOT do (documented in docs/MULTICHAIN_BITCOIN.md): the protection layer (MyWallGuard + Zodiac Delay
// D1/D2/D3) is not set up on the target chain — MyWallGuard is only deployed on Sepolia, and the setup batch needs a
// K1 + K2 signature with the target chain's EIP-712 domain.

import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Network, Wallet, formatEther, getAddress } from 'ethers';
import {
  CHAIN_ID,
  SAFE_ABI,
  SAFE_FALLBACK_HANDLER,
  SAFE_L2_SINGLETON,
  SAFE_PROXY_FACTORY,
  SAFE_PROXY_FACTORY_ABI,
  makeProvider,
} from '@sq/shared';
import {
  EVM_CHAINS,
  chainIndependenceIssues,
  decodeSafeDeploymentTx,
  decodeSetupInitializer,
  predictSafeProxyAddress,
  redeployCalldata,
} from '../packages/shared/src/multichain';
import {
  MYWALL_GUARD_ADDRESS,
  SAFE_MULTISEND_CALL_ONLY,
  ZODIAC_DELAY_MASTERCOPY,
  ZODIAC_MODULE_PROXY_FACTORY,
} from '../packages/shared/src/protection';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const chainId = Number(args.find((a) => /^\d+$/.test(a)));
const execute = args.includes('--execute');
const target = EVM_CHAINS[chainId];
if (!target || chainId === CHAIN_ID) {
  console.error(`Usage: npm run redeploy -- <chainId> [--client <id> | --safe <0x..>] [--execute]\nTarget chains: ${Object.values(EVM_CHAINS).filter((c) => !c.active).map((c) => `${c.chainId} (${c.name})`).join(', ')}`);
  process.exit(1);
}

const ok = (b: boolean) => (b ? 'OK ' : 'NO ');
const root = path.resolve(import.meta.dirname, '..');

// ── 1. the client's deployment record (read-only: safeAddress + deployTxHash) ──
const dbFile = path.join(root, 'services/sq-cosigner/data/db.json');
const db = fs.existsSync(dbFile) ? (JSON.parse(fs.readFileSync(dbFile, 'utf8')) as { clients: Record<string, { safeAddress?: string; deployTxHash?: string }> }) : { clients: {} };
const wanted = flag('--client');
const wantedSafe = flag('--safe');
const entries = Object.entries(db.clients).filter(([, c]) => c.safeAddress && c.deployTxHash);
const pick =
  wanted ? entries.find(([id]) => id === wanted)
  : wantedSafe ? entries.find(([, c]) => c.safeAddress!.toLowerCase() === wantedSafe.toLowerCase())
  : entries.filter(([id]) => id !== 'CH-100234').at(-1); // default: latest test wallet (never the owner's demo client)
if (!pick) {
  console.error('No deployed wallet found for that client / Safe in services/sq-cosigner/data/db.json.');
  process.exit(1);
}
const [clientId, rec] = pick;
const sepoliaSafe = getAddress(rec.safeAddress!);
console.log(`\nRedeploy plan — client ${clientId}, Safe ${sepoliaSafe}`);
console.log(`Source: Ethereum Sepolia (${CHAIN_ID}) → target: ${target.name} (${chainId})  [${execute ? 'EXECUTE' : 'dry run'}]\n`);

// ── 2. recover the exact deployment parameters from the original transaction ──
const sepolia = makeProvider();
const deployTx = await sepolia.getTransaction(rec.deployTxHash!);
if (!deployTx) throw new Error(`Deployment transaction ${rec.deployTxHash} not found on Sepolia`);
const params = decodeSafeDeploymentTx({ to: deployTx.to, data: deployTx.data });
const setup = decodeSetupInitializer(params.initializer);
console.log(`Deployment tx      ${rec.deployTxHash}`);
console.log(`  factory          ${params.factory}`);
console.log(`  singleton        ${params.singleton}`);
console.log(`  saltNonce        ${params.saltNonce}`);
console.log(`  owners (setup)   ${setup.owners.join(', ')}  threshold ${setup.threshold}`);
const issues = chainIndependenceIssues(params);
console.log(`${ok(issues.length === 0)} initializer is chain-independent (no modules/guard/payment in setup, canonical handler)`);
for (const i of issues) console.log(`    - ${i}`);

// Owners today on Sepolia vs. owners in the initializer: the redeployed Safe starts with the ORIGINAL owners.
const currentOwners = ((await new Contract(sepoliaSafe, SAFE_ABI, sepolia).getOwners()) as string[]).map((o) => getAddress(o));
const sameOwners = currentOwners.length === setup.owners.length && currentOwners.every((o) => setup.owners.includes(o));
console.log(`${ok(sameOwners)} current Sepolia owners equal the initial owners${sameOwners ? '' : ` — redeployed Safe will have the ORIGINAL owners (${setup.owners.join(', ')}); a later recovery (swapOwner) must be replayed there with 2 of them`}`);

// ── 3. the target chain: canonical contracts present? ──
const net = Network.from(chainId);
const remote = new JsonRpcProvider(target.rpcUrls[0], net, { staticNetwork: net });
const code = async (a: string) => (await remote.getCode(a)) !== '0x';
const checks: [string, string, boolean][] = [];
for (const [label, addr] of [
  ['Safe v1.4.1 ProxyFactory', SAFE_PROXY_FACTORY],
  ['SafeL2 v1.4.1 singleton', SAFE_L2_SINGLETON],
  ['CompatibilityFallbackHandler', SAFE_FALLBACK_HANDLER],
  ['MultiSendCallOnly v1.4.1', SAFE_MULTISEND_CALL_ONLY],
  ['Zodiac Delay mastercopy', ZODIAC_DELAY_MASTERCOPY],
  ['Zodiac ModuleProxyFactory', ZODIAC_MODULE_PROXY_FACTORY],
  ['MyWallGuard (Sepolia address)', MYWALL_GUARD_ADDRESS],
] as const) {
  const present = addr ? await code(addr) : false;
  checks.push([label, addr, present]);
  console.log(`${ok(present)} ${label.padEnd(30)} ${addr || '(none)'} on ${target.name}`);
}
const safeCoreOk = checks.slice(0, 3).every((c) => c[2]);

// ── 4. predicted address: offline (CREATE2 with the target factory's creation code) + eth_call on the target ──
const remoteFactory = new Contract(params.factory, SAFE_PROXY_FACTORY_ABI, remote);
const sepoliaFactory = new Contract(params.factory, SAFE_PROXY_FACTORY_ABI, sepolia);
const [remoteCreation, sepoliaCreation] = (await Promise.all([remoteFactory.proxyCreationCode(), sepoliaFactory.proxyCreationCode()])) as [string, string];
console.log(`${ok(remoteCreation === sepoliaCreation)} proxy creation code identical on both chains`);
const offline = predictSafeProxyAddress(params, remoteCreation);
console.log(`${ok(offline === sepoliaSafe)} offline CREATE2 prediction  ${offline}`);
let simulated: string | null = null;
let alreadyThere = false;
if (safeCoreOk) {
  alreadyThere = await code(sepoliaSafe);
  if (alreadyThere) console.log(`OK  a contract already exists at ${sepoliaSafe} on ${target.name} (already redeployed)`);
  else {
    simulated = getAddress(await remoteFactory.createProxyWithNonce.staticCall(params.singleton, params.initializer, params.saltNonce));
    console.log(`${ok(simulated === sepoliaSafe)} eth_call on ${target.name}       ${simulated}`);
  }
}
const sameAddress = offline === sepoliaSafe && (alreadyThere || simulated === sepoliaSafe);
console.log(`\n${sameAddress && issues.length === 0 ? 'RESULT: same address on' : 'RESULT: NOT the same address on'} ${target.name}: ${sepoliaSafe}`);
console.log(`Explorer: ${target.explorer}/address/${sepoliaSafe}`);
const guardThere = checks[6][2];
if (!guardThere) console.log(`Note: MyWallGuard is not deployed on ${target.name}; the redeployed wallet would be a plain 2-of-3 Safe (any 2 keys, no delays) until the guard + Delay modules are deployed and enabled there (K1 + K2).`);

if (!execute) {
  console.log(`\nDry run only. Calldata to send to ${params.factory} on ${target.name}:\n${redeployCalldata(params)}`);
  console.log('To execute: REDEPLOY_PRIVATE_KEY=<funded key on that chain> npm run redeploy -- ' + chainId + ` --client ${clientId} --execute`);
  process.exit(sameAddress && issues.length === 0 ? 0 : 1);
}

// ── 5. real redeploy (needs a funded key on the target chain; never stored in the repo) ──
if (!sameAddress || issues.length) throw new Error('Refusing to redeploy: address would differ');
if (alreadyThere) process.exit(0);
const pk = process.env.REDEPLOY_PRIVATE_KEY;
if (!pk) throw new Error('REDEPLOY_PRIVATE_KEY is not set (a funded EOA on the target chain)');
const deployer = new Wallet(pk, remote);
const bal = await remote.getBalance(deployer.address);
console.log(`Deployer ${deployer.address} balance ${formatEther(bal)} ETH on ${target.name}`);
if (bal === 0n) throw new Error('Deployer has no gas on the target chain');
const tx = await (remoteFactory.connect(deployer) as Contract).createProxyWithNonce(params.singleton, params.initializer, params.saltNonce);
console.log(`Sent ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1) throw new Error('Redeploy failed');
console.log(`Redeployed: ${target.explorer}/tx/${tx.hash}\nSafe ${sepoliaSafe} now exists on ${target.name} with owners ${setup.owners.join(', ')}.`);
