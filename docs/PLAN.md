# SQ Wallet — Build plan

Priority: the **create → sign → recover** journey must work end-to-end on Sepolia before any bonus or polish.

## Key technical choices
- **Safe v1.4.1 (SafeL2) 2-of-3** on Ethereum Sepolia, driven with **ethers v6** + the official Safe contracts/addresses
  (`@safe-global/safe-deployments`). We do not use protocol-kit v8 at runtime: it adds a viem/API-kit layer we don't need,
  and signature checks are done on-chain by the audited Safe contract anyway. Safe tx hashes are computed with EIP-712
  (ethers `TypedDataEncoder`) and cross-checked against `Safe.getTransactionHash` on-chain.
- **Shamir 2-of-3** for the recovery key with `shamir-secret-sharing` (Privy, audited).
- **Passkeys** with `@simplewebauthn/browser` + `@simplewebauthn/server`; the WebAuthn challenge is bound to the Safe tx hash.
- **Storage**: one JSON file store per service (`services/*/data/`), no native modules.
- **Public RPCs** with fallback (publicnode, drpc) — no API key.

## Milestones
- [x] **M0 — Setup**: npm workspaces monorepo, shared package, `.gitignore`, `.env.example`, relayer key generated, POUR_NOA grouped message.
- [x] **M1 — Headless critical path** (`npm run e2e`): deploy Safe via relayer → K1+K2 tx → lose K1 → rebuild K3 from 2 shares → `swapOwner` K3+K2 → tx with new K1. Real on Sepolia.
- [x] **M2 — Separate services + policy**: `sq-cosigner` (cosign, deploy, relayer, policy, log), `recovery-partner` (share ③), `sq-bank` (mock KYC/accounts). Policy unit tests.
- [x] **M3 — Web onboarding**: passkey, password, key generation, recovery kit (QR + download), Safe deployment, overview with real balances.
- [x] **M4 — Send**: plain-language simulation, Touch ID, co-sign, sponsored execution, step-up (OTP + cooling-off + four-eyes in /admin).
- [x] **M5 — Recovery**: scenario A (lost device, delay + cancel, on-chain rotation), B (/attacker refused), C (`npm run escape-hatch`).
- [x] **M6 — dApp compliance**: whitelist, sanctions refusal, `approve` simulation alert, admin log.
- [x] **M7 — UX polish + docs + pitch**: README, THREAT_MODEL, LEGAL, BUSINESS, DEMO_SCRIPT, `npm run reset-demo`.
- [~] **M8 (optional)** — privacy setting ✅, device limit ✅, admin freeze ✅; external wallet ownership proof and FR/EN not done.

## Risks
| Risk | Mitigation |
|---|---|
| Relayer not funded (faucet) | Blocking request in POUR_NOA.md asap; alternative faucets/mentors |
| Public RPC flaky | FallbackProvider over 2 RPCs |
| WebAuthn quirks on localhost | rpID `localhost`, origin `http://localhost:5173`; headless e2e script as safety net |
| No USDC in demo Safe | Circle faucet request; ETH transfer path works too |
| Library API drift | Versions pinned; APIs checked in installed READMEs |

## Verification status (2026-10-10)
- `npm test`: 10/10 policy tests pass.
- **Full chain logic verified on a local Hardhat fork of Sepolia** (real Safe v1.4.1 + Circle USDC bytecode):
  `npm run e2e` passes (deploy, K1+K2 tx, EIP-1271, attacker refused, recovery with delay, old key revoked on-chain, new key tx).
- **Full UI flow verified headless** (Playwright + Chrome virtual WebAuthn authenticator, on the fork): onboarding with passkey,
  recovery kit download, bank → wallet USDC, standard send, step-up (OTP + cooling-off + admin approval), sanctions refusal,
  dApp approvals (whitelisted / unknown), attacker page, lost-device recovery with paper-kit PNG upload, send with the new device.
- **Escape hatch verified on the fork with all Swissquote services stopped.**
- ✅ **`npm run e2e` passed on real Sepolia** (201 s) — tx links in the README.
- ⏳ Real-Sepolia USDC flows need test USDC in the treasury (faucet.circle.com); real Touch ID to be tried by Noa in Chrome.
