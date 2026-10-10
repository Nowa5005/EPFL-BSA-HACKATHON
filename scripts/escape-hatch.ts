// ESCAPE HATCH — "What if Swissquote disappears forever?"
// Moves all funds out of the Safe with the client's OWN two keys: device key (K1) + recovery key (K3 rebuilt
// from paper code ① + part ②). It talks to NO Swissquote service and NO recovery partner: only a public
// Ethereum RPC. Equivalent manual path: https://app.safe.global (Sepolia) with the same two keys.
//
// Part ② comes from ONE of:
//   --security-key <my-wall-security-key-part-*.json>   offline copy of the part locked to the physical security key.
//        Opening it needs the PRF / hmac-secret output of that key. Without a browser, read it with a FIDO2 tool
//        (e.g. libfido2: `fido2-assert -G -h …`) using the hmac-secret salt this script prints, then pass it with
//        --prf-output <hex|base64url> (or ESCAPE_PRF_OUTPUT). In a browser, My Wall does this for you.
//   --offline <my-wall-offline-backup-*.json>           offline file protected by the backup password
//        (asked interactively, or ESCAPE_BACKUP_PASSWORD).
//
// Usage:
//   npm run escape-hatch -- --device-key <my-wall-device-key-backup-*.json> --paper <recovery code, or a .txt file containing it>
//                           (--security-key <part.json> --prf-output <…> | --offline <file.json>) --to <destination address>
//   Device-key password: asked interactively (or ESCAPE_PASSWORD).
//   Gas: paid by GAS_PAYER_KEY, else by the recovery key's address when it holds the emergency gas reserve deposited at
//        wallet creation, else by the device key's own address (~0.001 Sepolia ETH from any source).
//   Protected wallet (MyWallGuard): K1 + K3 cannot move funds directly — each withdrawal is QUEUED in the delay module
//   D1 and executed after its cooldown (2 min demo / 48 h production). The script waits when the delay is short;
//   otherwise re-run it later with --execute to execute the ready withdrawals (anyone can execute them).

import fs from 'node:fs';
import readline from 'node:readline';
import { Contract, Wallet, formatEther, formatUnits, getAddress, isAddress } from 'ethers';
import {
  ERC20_ABI,
  USDC_ADDRESS,
  USDC_DECIMALS,
  buildSafeTx,
  decodeRecoveryCode,
  decryptShareOffline,
  decryptShareWithPrf,
  execArgs,
  explorerAddress,
  explorerTx,
  makeProvider,
  packSignatures,
  parseShare2Record,
  prfHmacSecretSalt,
  reconstructK3FromShares,
  safeContract,
  signSafeTx,
  usdcTransferData,
} from '@sq/shared';
import { DELAY_ABI, queueInD1SafeTx, readDelayQueue, readProtection } from '@sq/shared/protection';

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
  const part2File = arg('security-key') ?? arg('offline');
  const to = arg('to');
  if (!deviceFile || !paperFile || !part2File || !to || !isAddress(to)) {
    console.log(
      'Usage: npm run escape-hatch -- --device-key <backup.json> --paper "<recovery code>" (--security-key <part.json> --prf-output <hex> | --offline <offline-backup.json>) --to <0xDestination>',
    );
    process.exit(1);
  }
  const provider = makeProvider();
  console.log('\n🔓 My Wall escape hatch — no Swissquote server involved, only a public Ethereum RPC.\n');

  const device = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
  const part2 = parseShare2Record(fs.readFileSync(part2File, 'utf8'));
  const paper = { share: readPaper(paperFile) };
  const safeAddress = getAddress(device.safeAddress);
  if (getAddress(part2.safeAddress) !== safeAddress) throw new Error('These files belong to different wallets');

  const password = await askPassword('Device-key backup password: ', 'ESCAPE_PASSWORD');
  const keystoreJson = typeof device.keystore === 'string' ? device.keystore : JSON.stringify(device.keystore);
  const k1 = await Wallet.fromEncryptedJson(keystoreJson, password).catch(() => {
    throw new Error('Wrong password for the device-key backup');
  });
  let share2: string;
  if (part2.method === 'security-key') {
    const raw = arg('prf-output') ?? process.env.ESCAPE_PRF_OUTPUT;
    if (!raw) {
      console.log('\nPart ② is locked to your physical security key. Read its PRF output with a FIDO2 tool, then re-run with --prf-output:');
      console.log(`  relying party (rp id) : ${part2.rpId}`);
      console.log(`  credential id         : ${part2.credentialId} (base64url)`);
      console.log(`  hmac-secret salt      : ${Buffer.from(prfHmacSecretSalt(part2.prfSalt).slice(2), 'hex').toString('base64')} (base64)`);
      console.log('  e.g. libfido2: fido2-assert -G -h -i <params> /dev/hidrawN  (params: client data hash, rp id, credential id, salt)');
      process.exit(3);
    }
    const prf = /^0x[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw.slice(2), 'hex') : Buffer.from(raw, /^[0-9a-fA-F]{64}$/.test(raw) ? 'hex' : 'base64url');
    share2 = await decryptShareWithPrf(part2, new Uint8Array(prf));
  } else {
    share2 = await decryptShareOffline(part2, await askPassword('Backup password of the offline file (not the wallet password): ', 'ESCAPE_BACKUP_PASSWORD'));
  }
  const k3 = await reconstructK3FromShares([paper.share, share2]);
  console.log(`✔ device key   ${k1.address}`);
  console.log(`✔ recovery key ${k3.address} (rebuilt from paper code ① + ${part2.method === 'security-key' ? 'security key' : 'offline file'} ②)`);

  const safe = safeContract(safeAddress, provider);
  const owners: string[] = (await safe.getOwners()).map((o: string) => getAddress(o));
  for (const k of [k1, k3]) if (!owners.includes(k.address)) throw new Error(`${k.address} is not an owner of ${safeAddress}`);
  console.log(`✔ both are owners of Safe ${safeAddress} (threshold ${await safe.getThreshold()}) → 2 of 3 without Swissquote`);

  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const [usdcBal, ethBal] = await Promise.all([usdc.balanceOf(safeAddress) as Promise<bigint>, provider.getBalance(safeAddress)]);
  console.log(`  wallet holds ${formatUnits(usdcBal, USDC_DECIMALS)} USDC and ${formatEther(ethBal)} ETH`);

  const k3Reserve = await provider.getBalance(k3.address);
  const payer = process.env.GAS_PAYER_KEY ? new Wallet(process.env.GAS_PAYER_KEY, provider) : k3Reserve > 0n ? k3.connect(provider) : k1.connect(provider);
  if (!process.env.GAS_PAYER_KEY && k3Reserve > 0n) console.log(`⛽ gas paid from the emergency reserve on the recovery key (${formatEther(k3Reserve)} ETH)`);
  const payerBal = await provider.getBalance(payer.address);
  if (payerBal === 0n) {
    console.log(`\n⛽ The gas payer ${payer.address} has no Sepolia ETH.`);
    console.log('   Without Swissquote nobody sponsors fees: send ~0.001 Sepolia ETH to this address from any source, then re-run.');
    process.exit(2);
  }

  // Protected wallet: queue in D1 (K1 + K3), then execute after the on-chain cooldown.
  const protection = await readProtection(provider, safeAddress);
  const d1 = protection.config?.d1;
  if (d1) {
    const delay = new Contract(d1, DELAY_ABI, payer);
    const executeReady = async () => {
      const q = await readDelayQueue(provider, d1, { withTxs: true });
      for (const p of q.pending) {
        if (p.status === 'cooldown') {
          const wait = p.executableAt - Math.floor(Date.now() / 1000) + 3;
          if (wait > 600) {
            console.log(`\n⏳ Withdrawal #${p.index} executable at ${new Date(p.executableAt * 1000).toISOString()} — re-run with --execute after that time.`);
            return false;
          }
          console.log(`  waiting ${wait}s for the on-chain delay of withdrawal #${p.index}…`);
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
        if (p.status === 'expired' || !p.tx) continue;
        const sent = await delay.executeNextTx(p.tx.to, BigInt(p.tx.value), p.tx.data, p.tx.operation);
        console.log(`  executed #${p.index}: ${explorerTx(sent.hash)}`);
        await sent.wait();
      }
      return true;
    };
    if (process.argv.includes('--execute')) {
      if (await executeReady()) console.log(`\n✅ Done — funds moved without Swissquote. Wallet: ${explorerAddress(safeAddress)}`);
      return;
    }
    console.log(`\n🛡  Protected wallet: withdrawals are queued in the delay module D1 (${d1}) — the client can still cancel them during the delay.`);
    const queue = async (label: string, txData: { to: string; value?: bigint; data?: string }) => {
      const tx = queueInD1SafeTx(d1, { to: txData.to, value: txData.value ?? 0n, data: txData.data ?? '0x' }, await safe.nonce());
      const sigs = packSignatures([
        { signer: k1.address, signature: await signSafeTx(k1, safeAddress, tx) },
        { signer: k3.address, signature: await signSafeTx(k3, safeAddress, tx) },
      ]);
      const sent = await safeContract(safeAddress, payer).execTransaction(...execArgs(tx, sigs));
      console.log(`  queued ${label}: ${explorerTx(sent.hash)}`);
      const rc = await sent.wait();
      if (!rc || rc.status !== 1) throw new Error(`${label} failed`);
    };
    if (usdcBal > 0n) await queue(`${formatUnits(usdcBal, USDC_DECIMALS)} USDC`, { to: USDC_ADDRESS, data: usdcTransferData(to, usdcBal) });
    if (ethBal > 0n) await queue(`${formatEther(ethBal)} ETH`, { to, value: ethBal });
    if (usdcBal === 0n && ethBal === 0n) await queue('proof transaction (0 ETH, wallet empty)', { to, value: 0n });
    if (await executeReady()) console.log(`\n✅ Done — funds moved without Swissquote (after the on-chain delay). Wallet: ${explorerAddress(safeAddress)}`);
    return;
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
