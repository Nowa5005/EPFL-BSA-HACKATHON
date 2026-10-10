import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// #2 — The services listen on 127.0.0.1 only. When the web app is opened from another device (phone on the LAN via
// `--host`, or a dev tunnel), Vite is the ONLY exposed process: the browser calls /svc/<service>/… on the page's own
// origin and Vite forwards it to 127.0.0.1:400x (apps/web/src/lib/services.ts picks these paths automatically when
// the page is not served from localhost). On the desktop (http://localhost:5173) nothing changes: direct calls.
const SERVICES = { cosigner: 4001, partner: 4002, bank: 4003, market: 4004 } as const;

function serviceProxy(name: string, port: number): ProxyOptions {
  return {
    target: `http://127.0.0.1:${port}`,
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp(`^/svc/${name}`), '') || '/',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Service-to-service credentials never travel through the exposed proxy.
        proxyReq.removeHeader('x-internal-token');
        // Same-origin page (phone / tunnel): present it as the dev web origin so the services' CORS allow-list
        // accepts it. A cross-site Origin is forwarded unchanged and is still refused by the services.
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && host) {
          try {
            if (new URL(origin).host === host) proxyReq.setHeader('origin', 'http://localhost:5173');
          } catch {
            /* malformed Origin: forwarded as is → refused by the service */
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: Object.fromEntries(Object.entries(SERVICES).map(([n, p]) => [`/svc/${n}`, serviceProxy(n, p)])),
  },
});
