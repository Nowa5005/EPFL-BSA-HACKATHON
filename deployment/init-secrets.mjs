import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const file = process.env.BACKEND_ENV_FILE;
if (!file) throw new Error('Set BACKEND_ENV_FILE to a persistent, private file path');
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const contents = ['SESSION_SIGNING_KEY', 'INTERNAL_API_TOKEN', 'SERVICE_MASTER_KEY']
  .map(name => `${name}=${randomBytes(32).toString('base64url')}`).join('\n') + '\n';
// Exclusive creation: never replace keys that protect an existing wallet.
fs.writeFileSync(file, contents, { flag: 'wx', mode: 0o600 });
console.log('Backend secrets created. Back up this file securely together with the persistent service data.');
