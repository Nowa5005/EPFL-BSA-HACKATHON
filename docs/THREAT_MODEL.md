# Custody & threat model — SQ Wallet

## 1. Custody model in one picture

The wallet is a **Safe smart account (v1.4.1) on Ethereum, 2-of-3 owners**. The 2-of-3 rule is enforced **on-chain by the audited Safe contract**, not by a Swissquote promise.

| Key | Holder | Where it lives | Used for |
|---|---|---|---|
| **K1 — device key** | Client | Generated in the browser/app; encrypted at rest (ethers keystore, scrypt) with the wallet password; usable only after a **passkey** (Touch ID / Face ID) | Every-day signing |
| **K2 — co-signer key** | Swissquote | Generated and used **server-side only** in `sq-cosigner` (HSM in production, JSON file in the prototype) | Co-signs **after** checks: passkey, compliance, limits, delays |
| **K3 — recovery key** | Client | Generated client-side, immediately **split Shamir 2-of-3**: ① paper code (steel plate advised; home or bank safe-deposit box) · ② **physical security key** (FIDO2, WebAuthn PRF — Swissquote stores only the ciphertext; fallback: offline file + distinct backup password) · ③ independent recovery partner. **No cloud backup.** The full key is erased from memory | Recovery + escape hatch |

| Combination | Possible? | Meaning |
|---|---|---|
| K1 + K2 | ✅ | Normal use: client signs, Swissquote co-signs after checks |
| K3 + K2 | ✅ (after identity checks + delay) | Lost device: rotate K1 → K1′ (`swapOwner`) |
| K1 + K3 | ✅ | **Escape hatch**: client alone, without Swissquote |
| K2 alone | ❌ | Swissquote **cannot move funds** |
| K2 + partner share ③ | ❌ | ③ is 1 of 3 Shamir parts → K3 cannot be rebuilt |

Swissquote can **block** (refuse to co-sign, e.g. sanctions) but can **never move** the client's funds. The block itself is bounded by the escape hatch.

## 2. Assets & trust assumptions

- **Assets**: the funds in the Safe; the ability to sign; the client's privacy.
- **Trusted computing base**: Safe contracts (audited, >$100B secured), Ethereum consensus, `ethers` v6, `shamir-secret-sharing` (audited, Privy), `@simplewebauthn/*`, WebCrypto, the platform authenticator (Secure Enclave / TPM).
- **No custom cryptography**: hashing/signing is EIP-712 via ethers; signature verification is done by the Safe contract; Shamir via the audited library; encryption via WebCrypto (AES-GCM, HKDF, PBKDF2) and the ethers keystore / scrypt; part ② of K3 is keyed by the WebAuthn **PRF** extension (CTAP2 hmac-secret) of the client's security key.

## 3. Threats

| # | Threat | Can steal? | Can block? | Counter-measures in the prototype |
|---|---|---|---|---|
| T1 | **Phone thief** | No | No | K1 is encrypted by the password; every transaction needs a **passkey assertion bound to the Safe tx hash** (WebAuthn challenge = SafeTx hash) verified by `sq-cosigner`; without it K2 refuses → 1 signature max. Owner rotation via recovery revokes the stolen device **on-chain**. *Demo: `/attacker` step 1.* |
| T2 | **Phone + email compromised** | No | No | Recovery requires **liveness vs KYC photo** (hard requirement), the **paper kit** (otherwise +40 risk), risk score (new device, unusual IP, **recent SIM swap**); security questions have **low weight**. The real client is alerted in the **Swissquote account (separate login)**. Even after a successful recovery request, a **delay** (48 h prod / 2 min demo) with one-tap **cancel**. Part ② of the recovery key is locked to a **physical security key** the attacker does not have. *Demo: `/attacker` steps 2–3, `npm run e2e` step 3b.* |
| T3 | **SIM swap** | No | No | SMS is a notification only, never a factor sufficient on its own; a recent SIM swap raises the recovery risk score. |
| T4 | **Swissquote alone / rogue employee** | **No** (1 of 3 keys) | Yes (refuse to co-sign) | Escape hatch K1+K3; **four-eyes** approval for reinforced transactions; full audit log; freeze is visible to the client. |
| T5 | **Swissquote + recovery partner collude** (or are both compelled) | **No** | — | Partner holds only Shamir share ③ (1 of 3) — K3 cannot be rebuilt. There is **no cloud provider** to compel any more: Swissquote stores part ② only as ciphertext that needs the client's physical key, and the partner never holds part ②. Even Swissquote + partner together hold K2 + one K3 part + an unreadable ciphertext. |
| T6 | **Swissquote server breached, K2 stolen** | Not alone (needs K1 or K3 too) | Possible (DoS) | HSM in production; K2 rotation via K1+K3; relayer key separate from K2. |
| T7 | **Client loses everything** (device + paper + security key) | — | Loss | Human-assisted recovery is a product decision (premium): partner + video-ident; advice to keep 2 paper copies. In production: Zodiac **Delay module** for long-timeout fallbacks. |
| T8 | **Swissquote disappears** | — | No | **Escape hatch**: `npm run escape-hatch` rebuilds K3 from paper + security key (or offline file) and signs with K1+K3, using only a public RPC; also works in the public Safe UI (app.safe.global). |
| T9 | **Phishing / malicious dApp** | Reduced | — | **dApp whitelist**, **sanctions screening** of every counterparty, **plain-language simulation** (`eth_call`) before signing, **red alert on unlimited `approve`**, step-up for every dApp interaction, DELEGATECALL never co-signed, owner changes only through the recovery procedure. |
| T10 | **Malicious relayer / gas griefing** | No | Possible delay | Relayer only submits; it holds no owner key. Gas cap per tx, daily sponsored quota per client, sponsorship only if the policy engine approves. |
| T11 | **Replay of a passkey assertion** | No | — | Challenge = SafeTx hash which includes the Safe **nonce** → valid for exactly one transaction; WebAuthn signature counter tracked. |
| T12 | **Device limit bypass** (attacker adds a 3rd device) | No | — | Server refuses more than 1 mobile + 1 computer; adding a device requires an existing device; a new device registered during recovery stays *pending* until the rotation completes. |

## 4. Local secrets on the device (My Wall UI)
- **Unlock** requires the wallet password (scrypt keystore decrypted locally; 5 attempts then a 30 s wait in the demo) **and** a passkey assertion; the session is only marked unlocked after both.
- **Recovery code kept on the device**: share ① is stored **encrypted with the wallet password** (AES-GCM, PBKDF2) so that it can be shown again after re-authentication. Trade-off: an attacker with the device **and** the password would hold part ① — still only 1 of 3: part ② needs the physical security key (or the offline file + its distinct backup password) and part ③ the partner's identity checks. Mitigations: re-authentication with passkey to reveal, 30 s display, the client can delete it from the device after printing; production would keep it only until the client confirms the paper kit.
- **Secrets display**: never written to logs, history, notifications or storage in clear; re-masked on expiry, page exit and when the app goes to the background; clipboard cleared after 30 s (best effort).
- **Security questions**: 3 distinct out of 15, answers normalised then scrypt-hashed with a per-answer salt at the partner; low weight in the risk score, never sufficient alone.
- **Device-key backup file**: ethers keystore v3 (scrypt + AES-128-CTR + MAC) plus a SHA-256 of the keystore to report accidental corruption before trying the password.

## 5. Wallet-level hardening (this iteration)
- **K2 / relayer keys encrypted at rest** (ethers keystore, `SERVICE_MASTER_KEY` from the environment / secret store); atomic, idempotent migration with address checks. A stolen `keys.json` alone is useless; `.env` and `data/` are git-ignored. Residual risk: an attacker with both the data directory and the master key (same machine) — production: HSM.
- **Co-signer never trusts the client's summary**: it decodes the calldata, accepts only known operations in canonical form, re-simulates, and signs only the exact SafeTx of a single-use, unexpired preview. T13 *tampered calldata after confirmation* → refused (test + e2e).
- **Passkey challenge bound to chain, Safe, SafeTx hash, nonce and preview id** → no replay across transactions (T11 strengthened).
- **Client-side freeze** (passkey only): T14 *client suspects compromise* → freezes Swissquote's signature in one tap; funds stay reachable with K1 + K3.
- **Backup code**: helps users without working biometrics without weakening passkey-only actions (freeze, reveal amounts/secrets, device registration). Hash only, rate-limited, single-use challenges. Residual risk: a phished backup code + unlocked device + wallet password could confirm a standard operation — still subject to policy, limits, step-up and the co-signer.
- **Address poisoning** (look-alike recipient) flagged with the differing characters; unlimited approvals flagged with a cap option; authorised apps can be revoked.

## 5b. Service authentication, CORS & CSRF
Implementation: `packages/shared/src/serverAuth.ts`, installed in front of every route of the four services. Tests: `services/sq-cosigner/test/auth.test.ts`.

| # | Threat | Control |
|---|--------|---------|
| T15 | **Anyone on the network calls a client's routes** (read another client's data, act for them) | Signed session token (HMAC-SHA256, `SESSION_SIGNING_KEY`) required on every non-public route; a client token may only act on its own client id (path, body/query `clientId`, owner of the addressed resource). Default deny: unknown owner → 403; new routes under `/clients/:id/…` covered automatically. |
| T16 | **Hostile web page drives the victim's browser** (CSRF) | The token is a `Bearer` header stored by the app, not a cookie: the browser never sends it on its own, so a cross-site request arrives unauthenticated (401). In addition: `POST` must be `application/json` (forms → 415), and requests with an Origin outside the allow-list are refused (403) before any handler. |
| T17 | **Hostile origin reads responses** (CORS) | Explicit allow-list (`ALLOWED_ORIGINS`), exact echo, no wildcard, no credentials, only `GET/POST/OPTIONS` and `content-type, authorization, x-lang`. |
| T18 | **Demo reset abused** (wipe a client, or the whole demo) | `POST` only, absent in production; global reset needs the internal token or a compliance session; per-client reset needs the client's token **and** a fresh re-authentication (password re-entered, token valid 5 min). |
| T19 | **Spoofed service call** (fake recovery alert, fake receipt, attestation probing) | Service-to-service routes need `x-internal-token` (`INTERNAL_API_TOKEN`); a request carrying an `Origin` header cannot use it; the Origin header is never an identity. |
| T20 | **Recovery "Swissquote login" factor declared by the caller** | The partner now derives it from the verified bank session token of that very client, instead of trusting the request body. |

**Token storage trade-off (XSS).** The session token lives in `localStorage` (the device record and encrypted K1 already do). A successful XSS on the app origin could read it and act as the client **within the session's limits** — it still cannot sign: transactions need K1 (encrypted with the wallet password) and a passkey assertion bound to the exact SafeTx, and sensitive actions need the passkey. An HttpOnly cookie would hide the token from scripts but brings back CSRF (SameSite + anti-CSRF token) and does not work cleanly for the Capacitor app across origins; the prototype keeps Bearer tokens and relies on a strict CSP / no `dangerouslySetInnerHTML` in production. Tokens are stateless: logout clears them locally; server-side revocation (deny-list of `jti`, or rotating `SESSION_SIGNING_KEY` which logs everyone out) is the production path. One key is shared by the three services (single trust domain in this prototype; production: asymmetric signatures, per-service audience).

**Residual demo shortcuts (labelled DEMO):** bank `/login` accepts any password and `/reauth` any non-empty password, the `compliance` user is a demo account, and `/admin/test-session` (internal token, non-production) lets scripts get a client session for headless E2E clients. No rate limiting on login in the prototype.

## 6. Known limitations (prototype)

- K2 and the relayer key are JSON files (MOCK HSM). Liveness, SMS/email, sanctions feed, KYC and the recovery partner are mocks (clearly labeled in the UI).
- The headless e2e demo client skips the passkey step (no browser); the UI always uses real passkeys.
- Recovery when the device **and** Swissquote are lost is documented, not built (Zodiac Delay module).
- EVM only (no Bitcoin) — MPC/TSS would be the path for BTC.
- Passkeys registered on the same Mac during the recovery demo replace each other (same user handle); fine for the demo.

## 7. Recovery key part ② — physical security key, no cloud (N2)
Why the cloud backup was removed: a cloud account (iCloud / Google Drive) is usually reachable from the unlocked phone itself, so a phone thief could collect part ② and, with the paper code photographed or found nearby, rebuild K3.

| Threat | Result | Why |
|---|---|---|
| T15 Remote attacker (malware, phishing, server breach) wants part ② | ❌ | The AES key is derived (HKDF) from the **PRF output computed inside the security key** from a secret that never leaves it; WebAuthn binds the credential to the wallet's domain (RP ID), so a phishing site cannot ask the key for it. Nothing to steal remotely. |
| T16 Phone thief | ❌ | The physical key is not with the phone (advice: keep it apart from the phone and from the paper code). |
| T17 Swissquote (or its database leaks) | ❌ | Stores only the ciphertext (AES-256-GCM, authenticated data binds wallet + credential); unreadable without the key, present and touched. |
| T18 Swissquote + partner collude | ❌ | K2 + share ③ + an unreadable ciphertext: K3 cannot be rebuilt (2-of-3 needs a second readable part). The partner never stores part ②, even encrypted. |
| T19 Physical key **and** paper code stolen together | ⚠️ | K3 rebuilt — but K3 + K1 or K3 + K2 are **not immediate** on a protected wallet (D1 48 h, D2 30 days, client veto with K1 + K2), and the client can "Replace my recovery kit" (K1 + K2, immediate) which retires both. |
| T20 Offline file (fallback) stolen | ⚠️ | Needs the **distinct backup password** (≥ 15 chars, same rules as the wallet password, different from it): scrypt N = 2¹⁷ per guess. Never uploaded to Swissquote (no offline brute-force by the service). |
| T21 Old parts after "Replace cloud backup" | ✅ retired | The replacement **rotates K3 → K3′ on-chain** (K1 + K2). Re-splitting the same K3 would not retire anything (old paper + old cloud file would still rebuild it). On a protected wallet the guard config and D2 move to K3′ in the **same batch** — otherwise K3′ would count as a device key for the guard (proved by the counter-example test). Residual: the emergency gas reserve on the old K3 address. |

Limits: the PRF credential is bound to the web domain (RP ID: `localhost` in the demo — production: the Swissquote domain, or a native app with associated domains). Chrome evaluates hmac-secret on an assertion only with authenticators that support it (FIDO2 keys with clientPIN/UV support, platform passkeys with PRF, iOS 18+ / Android); the onboarding detects PRF support (`getClientCapabilities`) and otherwise offers the offline file. The headless e2e client has no authenticator: its PRF output is **simulated** (HMAC of a test secret, test only); the real ceremony is tested in Chrome with a virtual FIDO2 authenticator (`hasPrf: true`).
