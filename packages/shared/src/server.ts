// Node-only helpers (JSON file storage, service bootstrap). Not imported by the web app.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Tiny JSON-file store: each service owns its own data/ directory (no shared DB, no native modules). */
export class JsonStore<T extends object> {
  private file: string;
  data: T;
  constructor(dir: string, name: string, initial: () => T) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.json`);
    this.data = fs.existsSync(this.file) ? (JSON.parse(fs.readFileSync(this.file, 'utf8')) as T) : initial();
    this.save();
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  update<R>(fn: (d: T) => R): R {
    const r = fn(this.data);
    this.save();
    return r;
  }
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function loadDotenv() {
  // Load the repo-root .env if present (never committed).
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, '.env');
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
      return;
    }
    dir = path.dirname(dir);
  }
}
