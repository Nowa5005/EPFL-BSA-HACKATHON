// Read-only smoke checks, plus the documented mock login. Does not create wallets or move funds.
const base = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const origin = process.env.FRONTEND_ORIGIN ?? 'https://epfl-bsa-hackathon-web.vercel.app';
async function request(route, init = {}) {
  return fetch(base + route, { ...init, signal: AbortSignal.timeout(15_000) });
}
function require(condition, message) { if (!condition) throw new Error(message); }

const health = await request('/healthz');
require(health.ok, `Backend not ready: HTTP ${health.status}`);
const readiness = await health.json();
require(readiness.ready && Object.values(readiness.services).every(Boolean), 'A service is unavailable');
console.log('All service readiness checks passed');

const login = await request('/svc/bank/login', {
  method: 'POST', headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ username: 'alice', password: 'demo' }),
});
require(login.ok, `Mock login failed: HTTP ${login.status}`);
require(login.headers.get('access-control-allow-origin') === origin, 'Frontend origin is not allowed');
const session = await login.json();
require(session.role === 'client' && !!session.token && !!session.clientId, 'Invalid login response');
console.log('Alice login and frontend CORS passed (token omitted)');

const own = await request(`/svc/bank/clients/${encodeURIComponent(session.clientId)}`, {
  headers: { authorization: `Bearer ${session.token}`, origin },
});
require(own.ok, `Authenticated client profile failed: HTTP ${own.status}`);
await own.json();
console.log('Authenticated client profile passed');

const badOrigin = await request('/svc/bank/login', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.invalid' },
  body: JSON.stringify({ username: 'alice', password: 'demo' }),
});
require(badOrigin.status === 403, 'Untrusted browser origin was not refused');
const anonymous = await request(`/svc/bank/clients/${encodeURIComponent(session.clientId)}`);
require(anonymous.status === 401, 'Anonymous client data access was not refused');
const internal = await request('/svc/partner/shares/not-a-client', { headers: { 'x-internal-token': 'invalid' } });
require([401, 403].includes(internal.status), 'Internal-only data was not protected');
console.log('Origin, anonymous access and internal-route refusal checks passed');
console.log('No blockchain transactions were submitted. Wallet activation, signing and recovery require funded Sepolia wallets and browser passkeys.');
