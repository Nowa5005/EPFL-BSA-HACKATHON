import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotenv } from '@sq/shared/server';

// ES imports run before the entry file's body: load .env here so every module sees it (e.g. SERVICE_MASTER_KEY).
loadDotenv();

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.COSIGNER_DATA_DIR ?? path.join(here, '..', 'data');
/** Repo-root .env (git-ignored) — where a development master key is generated if none is provided. */
export const ENV_FILE = process.env.ENV_FILE ?? path.resolve(here, '..', '..', '..', '.env');
