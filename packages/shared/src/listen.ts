// #2 — Services listen on the loopback interface by default.
// HOST overrides it (e.g. HOST=0.0.0.0 for a native app on a physical phone that calls the services directly —
// see docs/MOBILE.md). In phone / tunnel mode only Vite is exposed: it proxies /svc/<service> to 127.0.0.1:400x.
// Node-only (exported from '@sq/shared/server').

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const DEFAULT_BIND_HOST = '127.0.0.1';

/** Interface to bind: process.env.HOST, else 127.0.0.1 (never all interfaces by default). */
export const bindHost = (env: Record<string, string | undefined> = process.env): string => env.HOST?.trim() || DEFAULT_BIND_HOST;

/** "http://127.0.0.1:4001" from the address the socket is REALLY bound to (IPv6 in brackets). */
export function boundUrl(server: Server): string {
  const a = server.address() as AddressInfo | string | null;
  if (!a || typeof a === 'string') return String(a);
  const host = a.family === 'IPv6' || a.family === (6 as unknown as string) ? `[${a.address}]` : a.address;
  return `http://${host}:${a.port}`;
}

interface Listenable {
  listen(port: number, host: string, cb: () => void): Server;
}

/** app.listen(port, HOST ?? 127.0.0.1) and log the real bound address. Returns the http.Server. */
export function listenService(app: Listenable, port: number, label: string, onReady?: (server: Server) => void): Server {
  const host = bindHost();
  const server = app.listen(port, host, () => {
    console.log(`${label} listening on ${boundUrl(server)}${host === DEFAULT_BIND_HOST ? ' (loopback only — set HOST to expose)' : ''}`);
    onReady?.(server);
  });
  return server;
}
