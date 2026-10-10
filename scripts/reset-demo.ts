// Resets the demo state of the three services (clients, wallets, logs) while KEEPING the funded keys
// (relayer, treasury). On-chain Safes created earlier keep existing on Sepolia, they are simply forgotten.
// Then, in the browser: the app detects the reset and returns to the login screen automatically.

import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_URLS } from '@sq/shared';
import { internalHeaders, loadDotenv } from '@sq/shared/server';

// The reset routes are POST-only, need the service-to-service token (INTERNAL_API_TOKEN, root .env) and do not
// exist when NODE_ENV=production.
loadDotenv();

const root = path.resolve(import.meta.dirname, '..');
const targets = [
  { name: 'sq-cosigner', url: SERVICE_URLS.cosigner, file: 'services/sq-cosigner/data/db.json' },
  { name: 'recovery-partner', url: SERVICE_URLS.partner, file: 'services/recovery-partner/data/partner.json' },
  { name: 'sq-bank', url: SERVICE_URLS.bank, file: null },
];

for (const t of targets) {
  const res = await fetch(`${t.url}/admin/reset`, { method: 'POST', headers: internalHeaders(), body: '{}' }).catch(() => null);
  if (res?.ok) console.log(`✔ ${t.name}: reset (running service)`);
  else if (res) console.log(`✖ ${t.name}: reset refused (HTTP ${res.status}) — nothing deleted. Check INTERNAL_API_TOKEN in .env (restart npm run dev after changing it).`);
  else if (t.file && fs.existsSync(path.join(root, t.file))) {
    fs.rmSync(path.join(root, t.file));
    console.log(`✔ ${t.name}: data file removed (service not running)`);
  } else console.log(`• ${t.name}: nothing to reset${t.file ? '' : ' (start it and re-run to reset accounts)'}`);
}
console.log('\nDone. Open http://localhost:5173 — you start again as Alice, before wallet creation.');
console.log('Tip: in Chrome you may also delete old passkeys for "localhost" (Settings → Passwords → Passkeys). Not required.');
