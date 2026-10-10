// Compiles contracts/MyWallGuard.sol with the npm `solc` package (solc-js, WebAssembly: no native install) and
// writes contracts/artifacts/MyWallGuard.json (ABI, bytecode, compiler settings, solc metadata).
//   npm run build:contracts            → (re)write the artifact
//   npm run build:contracts -- --check → fail if the committed artifact differs from a fresh compile
// The committed artifact is what the tests, the Sepolia deployment and the shared builders use.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');
const root = path.resolve(import.meta.dirname, '..');
const SOURCE = 'contracts/MyWallGuard.sol';
const OUT = path.join(root, 'contracts/artifacts/MyWallGuard.json');

export const SOLC_SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'cancun',
  viaIR: true,
  metadata: { bytecodeHash: 'ipfs' },
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
} as const;

export function compileGuard() {
  const input = {
    language: 'Solidity',
    sources: { [SOURCE]: { content: fs.readFileSync(path.join(root, SOURCE), 'utf8') } },
    settings: SOLC_SETTINGS,
  };
  const findImports = (p: string) => {
    const file = path.join(root, 'node_modules', p);
    return fs.existsSync(file) ? { contents: fs.readFileSync(file, 'utf8') } : { error: `not found: ${p}` };
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (out.errors ?? []).filter((e: any) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e: any) => e.formattedMessage).join('\n'));
  for (const w of out.errors ?? []) if (w.severity !== 'error') console.warn(w.formattedMessage);
  const c = out.contracts[SOURCE].MyWallGuard;
  return {
    contractName: 'MyWallGuard',
    sourceName: SOURCE,
    compiler: `solc-js ${solc.version()}`,
    settings: { optimizer: SOLC_SETTINGS.optimizer, evmVersion: SOLC_SETTINGS.evmVersion, viaIR: SOLC_SETTINGS.viaIR },
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    deployedBytecode: '0x' + c.evm.deployedBytecode.object,
    metadata: c.metadata as string,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const art = compileGuard();
  const json = JSON.stringify(art, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== json) {
      console.error('contracts/artifacts/MyWallGuard.json is out of date — run npm run build:contracts');
      process.exit(1);
    }
    console.log('MyWallGuard artifact up to date');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    console.log(`Wrote ${path.relative(root, OUT)} (${(art.deployedBytecode.length - 2) / 2} bytes runtime)`);
  }
}
