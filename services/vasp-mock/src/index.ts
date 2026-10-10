// vasp-mock entry point: simulated counterparty VASP "Demo Exchange AG" (#9). Port 4005, loopback only (#2).
// Data (customers, received Travel Rule inquiries, Ed25519 key, pinned peer keys): services/vasp-mock/data
// (git-ignored). Override with VASP_DATA_DIR.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenService, loadDotenv } from '@sq/shared/server';
loadDotenv();

import { PORTS } from '@sq/shared';
import { createVaspApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.VASP_DATA_DIR ?? path.join(here, '..', 'data');
const { app, self, key } = createVaspApp({ dataDir });

listenService(app, Number(process.env.VASP_PORT ?? PORTS.vasp), `vasp-mock (${self.name}, simulated)`, () => {
  console.log(`Travel Rule identity ${key.keyId} (Ed25519 public key published at /trp/identity)`);
});
