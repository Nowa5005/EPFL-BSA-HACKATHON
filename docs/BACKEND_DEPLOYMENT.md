# Deploy the Sepolia demo backend

The repository already implements Safe wallet deployment, co-signing, sponsored transactions, passkeys, recovery,
policy checks, signed sessions, receipts, market data, and mock banking/Travel Rule services. The Vercel frontend
needs these long-running services: a static frontend deployment does not start them.

This deployment is for the hackathon prototype and Sepolia test assets. Banking login (`alice` / any password),
KYC, trustee independence, notifications, securities orders, subscription payments, and exchange execution retain
their documented demo behavior. `NODE_ENV=production` enforces secret configuration and disables reset routes;
it does not turn simulated integrations into real banking. See [production requirements](PRODUCTION_READINESS.md).

## Start on a server

Use a Linux server with Docker Compose, a backend domain, and HTTPS termination (for example Caddy or the hosting
provider's managed HTTPS). One persistent backend replica is required: the JSON stores cannot be shared between
multiple replicas. Only the gateway is exposed; the five underlying services bind loopback.

From the repository root:

```sh
docker compose build
docker compose run --rm backend node deployment/init-secrets.mjs
docker compose up -d
docker compose logs --tail=80 backend
curl --fail http://127.0.0.1:8080/healthz
node deployment/smoke.mjs http://127.0.0.1:8080
```

The secret initialization command creates `/data/backend.env` in the named volume, without printing values.
It intentionally fails if that file already exists. Run it once only; never delete it to fix a startup error.
For an existing backend with created wallets, migrate its original secrets and service data instead of initializing
fresh keys. New keys will not control those wallets. These commands describe a fresh deployment.
Back up the entire volume securely: it contains the encryption master key, encrypted co-signing keys, treasury
test key, recovery shares, and service records. Losing the master key can make existing wallets unrecoverable.
Do not use `docker compose down -v`. Normal rebuilds and `docker compose up -d` retain data.

The gateway listens on container port 8080; Compose binds it to the server's loopback port 8080. Configure your
HTTPS reverse proxy to forward the entire request path to `127.0.0.1:8080`, without rewriting `/svc` away.
Do not expose ports 4001–4005. The mock VASP remains reachable only by the co-signer.

For a managed container host, deploy the Dockerfile, mount durable storage at `/data`, use port 8080 and health
path `/healthz`, and set the three origin/RP settings in `compose.yaml`. Supply the three secret variables through
the host's secret manager or initialize the private file on that persistent disk. Do not use ephemeral storage.

## Connect the existing Vercel frontend

Once the backend has a real HTTPS URL, add these variables in Vercel, replacing `YOUR-BACKEND-DOMAIN`:

```text
VITE_COSIGNER_URL=https://YOUR-BACKEND-DOMAIN/svc/cosigner
VITE_PARTNER_URL=https://YOUR-BACKEND-DOMAIN/svc/partner
VITE_BANK_URL=https://YOUR-BACKEND-DOMAIN/svc/bank
VITE_MARKET_URL=https://YOUR-BACKEND-DOMAIN/svc/market
```

Redeploy the frontend: Vite embeds these values at build time. Do not put backend secrets in any `VITE_*` variable.
Build from the repository root with `npm run build -w apps/web`, serving `apps/web/dist`. Configure a SPA fallback
to `index.html` for frontend routes if your Vercel project does not already have one.

Compose already allows `https://epfl-bsa-hackathon-web.vercel.app` and uses that hostname for WebAuthn. If the
frontend domain changes, update `ALLOWED_ORIGINS`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` before restarting the
backend. Origins include `https://`; the RP ID is a hostname only. Do not use wildcard origins. Existing passkeys
are tied to their RP ID, so changing it can require re-enrollment.

## Verify the deployment

`GET /healthz` must return HTTP 200 with all five services ready. This checks actual API responses without
waiting for blockchain balances; it does not certify RPC access, funding, or external provider availability.
The mock VASP is included in readiness checks but is intentionally absent from public gateway routes.

Try `alice` / `demo` on the Vercel login page. If it fails, inspect the browser Network tab: the request should go
to `https://YOUR-BACKEND-DOMAIN/svc/bank/login`. A 404 at the Vercel domain means the frontend was not rebuilt with
the variables. A 502 means a service is down. An origin rejection means the frontend URL is not in the allowlist.

Next, `GET /svc/cosigner/health` and `/svc/bank/health` must report non-null chain balances. Fund the public relayer
address with Sepolia ETH and the treasury address with Sepolia ETH plus Circle test USDC. These are test assets,
not real money. Do not send mainnet assets. Public addresses are in service logs; private keys must never be shared.

Verify wallet activation with a browser passkey, a small test USDC transfer, the receipt, and the recovery flow.
Public hosting disables headless clients. Headless `npm run e2e` is a separate local test workflow, requiring an
explicit test-only headless setting and funded test wallets; never enable that bypass on the public demo.

## Development validation

The existing backend coverage includes:

| Capability | Implementation / validation |
| --- | --- |
| Safe deployment, transaction simulation, K2 signatures, sponsored execution | `services/sq-cosigner/src/chain.ts`; Sepolia integration scripts require funding and RPC access |
| Passkeys, signed sessions, CORS/CSRF, per-client authorization | `webauthn.ts`, shared `serverAuth.ts`, co-signer auth/security tests |
| Recovery, split recovery key, key rotation, protected exit | recovery-partner service, shared recovery helpers; recovery and Hardhat contract tests |
| Policy, sanctions demo, cooling-off, compliance approvals | co-signer policy/protection/travel-rule tests; production screening remains external |
| Travel Rule messages and self-hosted ownership proofs | signed mock VASP integration tests, SIWE/EIP-191/EIP-1271 verification |
| Incoming transfers, confirmations, receipts and annual exports | indexer, wallet transaction and statement tests; live/archive RPC needed for chain data |
| Watchlists, alerts, prices and charts | bank alert tests, market service tests; live provider access required |
| Subscription pricing and swap quotes | feature tests; charging and exchange execution are explicitly simulated |
| Public backend access for hosted frontend | deployment gateway tests and `deployment/smoke.mjs` |

The unit/contract suites do not replace a funded, browser-based Sepolia activation → send → recover check.
Do that after hosting, passkey origins, RPC access and faucet funding are configured.

```sh
node --test deployment/*.test.mjs
npm test
npm run typecheck
npm run build -w apps/web
```

In the Codex environment, set `XDG_CONFIG_HOME=/workspace/.config`, `XDG_CACHE_HOME=/workspace/.cache`, and
`XDG_DATA_HOME=/workspace/.local/share` before Hardhat tests, since the default home directory is read-only.
