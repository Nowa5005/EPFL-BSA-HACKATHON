import http from 'node:http';

export const services = {
  cosigner: { port: 4001, probe: '/config' },
  partner: { port: 4002, probe: '/health' },
  bank: { port: 4003, probe: '/ready' },
  market: { port: 4004, probe: '/health' },
  vasp: { port: 4005, probe: '/health' },
};

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function cleanHeaders(input) {
  const headers = { ...input };
  for (const name of [...hopHeaders, ...String(input.connection ?? '').toLowerCase().split(',').map(s => s.trim())]) delete headers[name];
  return headers;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createGateway(targets = services) {
  return http.createServer(async (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      const checks = await Promise.all(Object.entries(targets).map(async ([name, target]) => {
        try {
          const response = await fetch(`http://127.0.0.1:${target.port}${target.probe}`, { signal: AbortSignal.timeout(3000) });
          const body = await response.json();
          return [name, response.ok && !!body];
        } catch { return [name, false]; }
      }));
      const ready = checks.every(([, ok]) => ok);
      return json(res, ready ? 200 : 503, { ready, services: Object.fromEntries(checks), network: 'Sepolia', demo: true });
    }
    const match = /^\/svc\/(cosigner|partner|bank|market)(\/[^#]*)?$/.exec(req.url ?? '');
    if (!match || !targets[match[1]]) return json(res, 404, { error: 'Unknown API route' });
    const headers = cleanHeaders(req.headers);
    // Never allow a public caller to impersonate another service, even with a leaked internal token.
    delete headers['x-internal-token'];
    for (const name of Object.keys(headers)) if (name.startsWith('x-forwarded-')) delete headers[name];
    headers.host = `127.0.0.1:${targets[match[1]].port}`;
    // Preserve Origin and Authorization: upstream services enforce CORS, CSRF and session ownership.
    const upstream = http.request({ hostname: '127.0.0.1', port: targets[match[1]].port, path: match[2] || '/', method: req.method, headers }, response => {
      res.writeHead(response.statusCode ?? 502, cleanHeaders(response.headers));
      response.pipe(res);
      response.on('error', () => res.destroy());
    });
    upstream.setTimeout(120_000, () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) json(res, 502, { error: 'Backend service unavailable' });
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  });
}
