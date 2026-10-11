import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { createGateway } from './gateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: process.env.BACKEND_ENV_FILE ?? path.join(root, '.env'), quiet: true });
for (const name of ['SESSION_SIGNING_KEY', 'INTERNAL_API_TOKEN', 'SERVICE_MASTER_KEY']) {
  if (!process.env[name] || process.env[name].length < 32) throw new Error(`${name} must be supplied (at least 32 characters)`);
}
for (const name of ['ALLOWED_ORIGINS', 'WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN']) {
  if (!process.env[name]) throw new Error(`${name} must be configured for the frontend domain`);
}
const children = [];
let stopping = false;
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const server = createGateway();
function stop(code) {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 5000).unref();
  Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  }))).then(() => process.exit(code));
}
// One public gateway, five private service processes. VASP remains private even at the gateway.
for (const name of ['sq-cosigner', 'recovery-partner', 'sq-bank', 'market-data', 'vasp-mock']) {
  const child = spawn(process.execPath, ['--import', 'tsx', `services/${name}/src/index.ts`], {
    cwd: root, stdio: 'inherit', env: { ...process.env, HOST: '127.0.0.1', ALLOW_HEADLESS_CLIENTS: 'false' },
  });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', () => { if (!stopping) { console.error(`${name} stopped; shutting down backend`); stop(1); } });
}
server.on('error', error => { console.error(error.message); stop(1); });
server.listen(port, '0.0.0.0', () => console.log('Sepolia demo API gateway started'));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
