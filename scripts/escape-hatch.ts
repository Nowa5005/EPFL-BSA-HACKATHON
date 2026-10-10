// ESCAPE HATCH — "What if Swissquote disappears forever?"
// Moves all funds out of the Safe with the client's OWN two keys: device key (K1) + recovery key (K3 rebuilt
// from paper kit ① + cloud backup ②). It talks to NO Swissquote service and NO recovery partner: only a public
// Ethereum RPC. Equivalent manual path: https://app.safe.global (Sepolia) with the same two keys.
//
// Usage:
//   npm run escape-hatch -- --device-key <my-wall-device-key-backup-*.json> --paper <recovery code, or a .txt file containing it>
//                           --cloud <my-wall-cloud-backup-*.json> --to <destination address>
//   Password: asked interactively (or ESCAPE_PASSWORD / ESCAPE_CLOUD_PASSWORD env vars).
//   Gas: paid by the device key's own address (it needs ~0.001 Sepolia ETH, from any source), or by GAS_PAYER_KEY.

import fs from 'node:fs';
import readline from 'node:readline';
import { Contract, Wallet, formatEther, formatUnits, getAddress, isAddress } from 'ethers';
import {
  ERC20_ABI,
  USDC_ADDRESS,
  USDC_DECIMALS,
  buildSafeTx,
  combineShares,
  decodeRecoveryCode,
  decryptCloudShare,
  execArgs,
  explorerAddress,
  explorerTx,
  makeProvider,
  packSignatures,
  safeContract,
  signSafeTx,
  usdcTransferData,
  type CloudBackup,
} from '@sq/shared';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function readPaper(arg: string): string {
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  const r = decodeRecoveryCode(text);
  if (!r.ok) throw new Error(`Recovery code: ${r.error}`);
  return r.share;
}

async function askPassword(question: string, envVar: string): Promise<string> {
  if (process.env[envVar] !== undefined) return process.env[envVar]!;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const anyRl = rl as any;
  anyRl._writeToOutput = (s: string) => anyRl.output.write(s.includes(question) ? s : '*');
  const pw = await new Promise<string>((r) => rl.question(question, r));
  rl.close();
  console.log();
  return pw;
}

async function main() {
  const deviceFile = arg('device-key');
  const paperFile = arg('paper');
  const cloudFile = arg('cloud');
  const to = arg('to');
  if (!deviceFile || !paperFile || !cloudFile || !to || !isAddress(to)) {
    console.log('Usage: npm run escape-hatch -- --device-key <backup.json> --paper "<recovery code>" --cloud <cloud-backup.json> --to <0xDestination>');
    process.exit(1);
  }
  const provider = makeProvider();
  console.log('\n🔓 My Wall escape hatch — no Swissquote server involved, only a public Ethereum RPC.\n');

  const device = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
  const backup = JSON.parse(fs.readFileSync(cloudFile, 'utf8')) as CloudBackup;
  const paper = { share: readPaper(paperFile) };
  const safeAddress = getAddress(device.safeAddress);
  if (getAddress(backup.safeAddress) !== safeAddress) throw new Error('These files belong to different wallets');

  const password = await askPassword('Device-key backup password: ', 'ESCAPE_PASSWORD');
  const keystoreJson = typeof device.keystore === 'string' ? device.keystore : JSON.stringify(device.keystore);
  const k1 = await Wallet.fromEncryptedJson(keystoreJson, password).catch(() => {
    throw new Error('Wrong password for the device-key backup');
  });
  // The cloud backup keeps the password chosen at wallet creation (it may differ after a device recovery).
  const cloudShare = await decryptCloudShare(backup, password).catch(async () =>
    decryptCloudShare(backup, await askPassword('Cloud backup password (the one chosen at wallet creation): ', 'ESCAPE_CLOUD_PASSWORD')),
  );
  const k3 = new Wallet(await combineShares([paper.share, cloudShare]));
  console.log(`✔ device key   ${k1.address}`);
  console.log(`✔ recovery key ${k3.address} (rebuilt from paper kit ① + cloud backup ②)`);

  const safe = safeContract(safeAddress, provider);
  const owners: string[] = (await safe.getOwners()).map((o: string) => getAddress(o));
  for (const k of [k1, k3]) if (!owners.includes(k.address)) throw new Error(`${k.address} is not an owner of ${safeAddress}`);
  console.log(`✔ both are owners of Safe ${safeAddress} (threshold ${await safe.getThreshold()}) → 2 of 3 without Swissquote`);

  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const [usdcBal, ethBal] = await Promise.all([usdc.balanceOf(safeAddress) as Promise<bigint>, provider.getBalance(safeAddress)]);
  console.log(`  wallet holds ${formatUnits(usdcBal, USDC_DECIMALS)} USDC and ${formatEther(ethBal)} ETH`);

  const payer = process.env.GAS_PAYER_KEY ? new Wallet(process.env.GAS_PAYER_KEY, provider) : k1.connect(provider);
  const payerBal = await provider.getBalance(payer.address);
  if (payerBal === 0n) {
    console.log(`\n⛽ The gas payer ${payer.address} has no Sepolia ETH.`);
    console.log('   Without Swissquote nobody sponsors fees: send ~0.001 Sepolia ETH to this address from any source, then re-run.');
    process.exit(2);
  }

  const send = async (label: string, txData: { to: string; value?: bigint; data?: string }) => {
    const tx = buildSafeTx({ ...txData, nonce: await safe.nonce() });
    const sigs = packSignatures([
      { signer: k1.address, signature: await signSafeTx(k1, safeAddress, tx) },
      { signer: k3.address, signature: await signSafeTx(k3, safeAddress, tx) },
    ]);
    const sent = await safeContract(safeAddress, payer).execTransaction(...execArgs(tx, sigs));
    console.log(`  ${label}: ${explorerTx(sent.hash)}`);
    const rc = await sent.wait();
    if (!rc || rc.status !== 1) throw new Error(`${label} failed`);
  };

  console.log(`\n→ moving funds to ${getAddress(to)} (signed by device key + recovery key)`);
  if (usdcBal > 0n) await send(`${formatUnits(usdcBal, USDC_DECIMALS)} USDC`, { to: USDC_ADDRESS, data: usdcTransferData(to, usdcBal) });
  if (ethBal > 0n) await send(`${formatEther(ethBal)} ETH`, { to, value: ethBal });
  if (usdcBal === 0n && ethBal === 0n) {
    // Still prove the keys work: a zero-value transaction executed without Swissquote.
    await send('proof transaction (0 ETH, wallet empty)', { to, value: 0n });
  }
  console.log(`\n✅ Done — funds moved without Swissquote. Wallet: ${explorerAddress(safeAddress)}`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
