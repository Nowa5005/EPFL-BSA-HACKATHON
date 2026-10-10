// #2 — Verifies that the running services listen on loopback only (127.0.0.1 / ::1), never on all interfaces.
// Usage: npm run dev (in another terminal), then `npx tsx scripts/check-bind.ts`. Exit code 1 if a port is exposed.
import { execFileSync } from 'node:child_process';
import { PORTS } from '@sq/shared';

const ports = [PORTS.cosigner, PORTS.partner, PORTS.bank, PORTS.market, PORTS.vasp];
let bad = 0;
for (const port of ports) {
  let out = '';
  try {
    out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  } catch {
    console.log(`:${port}  not listening`);
    continue;
  }
  const addrs = out.split('\n').slice(1).filter(Boolean).map((l) => l.trim().split(/\s+/).at(-2) ?? '');
  const exposed = addrs.filter((a) => !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(a));
  console.log(`:${port}  ${addrs.join(', ')}  ${exposed.length ? 'EXPOSED' : 'loopback only'}`);
  if (exposed.length) bad++;
}
process.exit(bad ? 1 : 0);
