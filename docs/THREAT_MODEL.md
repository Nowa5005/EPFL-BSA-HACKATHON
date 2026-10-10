# Custody & threat model — SQ Wallet

## 1. Custody model in one picture

The wallet is a **Safe smart account (v1.4.1) on Ethereum, 2-of-3 owners**. The 2-of-3 rule is enforced **on-chain by the audited Safe contract**, not by a Swissquote promise.

| Key | Holder | Where it lives | Used for |
|---|---|---|---|
| **K1 — device key** | Client | Generated in the browser/app; encrypted at rest **twice**: ethers keystore (scrypt) with the wallet password, wrapped in AES-GCM under a key derived from the **device passkey's WebAuthn PRF** output (hardware binding, #11 — fallback: password only when the browser has no PRF); usable only after a **passkey** (Touch ID / Face ID) | Every-day signing |
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
- **Unlock** requires the wallet password (scrypt keystore decrypted locally; 5 attempts then a 30 s wait in the demo) **and** a passkey assertion; the session is only marked unlocked after both. On a hardware-bound device (#11, §10) the passkey comes first and its PRF output is what opens the outer layer of K1, so the password cannot even be tried without the passkey.
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
- Hardware binding of K1 (#11) needs WebAuthn PRF; browsers / passkey providers without it fall back to the password-only keystore (shown in Security). See §10.

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

## 8. Client under threat — duress code and delayed limits (#16)

- **Threat**: someone forces the client (physically, or by threats) to open My Wall and send funds.
- **Duress code** (optional, Security → "Duress code"; passkey to set or remove). Typed **instead of the wallet
  password**, the unlock looks exactly like a normal one (same progress bar, same passkey step) and opens a **decoy**
  wallet: same screens, a small plausible fictitious balance and history, a fictitious address — served from memory
  (`apps/web/src/lib/decoy.ts`); nothing in the DOM, `localStorage` or the client's activity feed mentions it. The decoy
  session has **no real key** (a throwaway key that owns nothing), never sends a transaction to the co-signer, and the
  co-signer was **frozen** at the same moment: even another device cannot get a co-signature (423). The freeze is
  recorded as a compliance freeze, so the client cannot be forced to lift it; a **duress alert** appears in the
  console (`GET /admin/duress`), with the procedure (contact via a verified channel, security / police, lift only once
  the client is safe).
- **Storage & check**: the device derives `proof = scrypt(code, "mywall-duress-v1:<clientId>")` (ethers); the server
  stores only `scrypt(proof, random salt)` (node:crypto), like the backup code. **Every** unlock calls
  `POST /clients/:id/unlock/check` — with a random value when the password was right — and the server always runs the
  same scrypt (a dummy record when no code is set) and a constant-time compare: same work, same requests, same latency
  (measured ≈ 60 ms in every case) whichever code was typed.
- **Delayed limits**: the daily limit is chosen by the client; lowering is immediate; raising waits 24 h (demo 60 s)
  with e-mail + app notifications and can be cancelled; first payments ≥ the step-up threshold to a new recipient are
  always delayed (confirmation code, cooling-off, four-eyes). Pending approved operations are not executed while frozen.
- **Residual limits**: an attacker who knows the real wallet address (e.g. from earlier transfers) and checks it on a
  block explorer can tell the decoy balance is not real; the decoy cannot move money (sends fail with a generic
  "service unavailable" error), which a persistent attacker may find suspicious; the K1 + K3 exit (recovery kit) is not
  blocked by the freeze — the attacker would also need the paper code and the security key. Reloading the page ends
  the decoy (back to the unlock screen).


## 9. On-chain protection — guard + delay modules (#5 #6 #7 #8 #13, Phase B)

Full description: [ONCHAIN_PROTECTION.md](ONCHAIN_PROTECTION.md). `MyWallGuard` (custom, **not audited**) + official Zodiac Delay modules.

| Threat | Before | Now |
|---|---|---|
| Two keys stolen (e.g. K2 + K3, or K1 + K3) | Immediate theft possible | Direct transaction **reverted by the guard**; only a queue in D1 (48 h prod) with alert + veto by the client |
| Swissquote + recovery partner collude | Already impossible (partner holds 1 of 3 parts of K3) | Unchanged, and even a reconstructed K3 + K2 is delayed and vetoable |
| Recovery delay bypassed by a rogue Swissquote server | Delay only off-chain | Delay **on-chain** (D1); the server delay remains as a complement |
| Device lost AND Swissquote gone | Not possible | K3 alone through D2 (30 days prod), vetoable |
| Swissquote blocks an exit | Escape hatch K1 + K3 (immediate) | Still guaranteed, with 48 h notice (D1) — Swissquote can delay, never block |
| Configuration tampering (remove the guard, shorten a delay, add an owner/module) without K1 + K2 | — | Refused directly; only through D1 (48 h, veto) |
| Wallet drained through gas refunds by two stolen keys | Refund parameters refused by K2 only | Refused on-chain for any pair other than K1 + K2 |

Residual risks: guard not audited; an attacker with two keys can veto (block) the client's own queued exit but not steal;
FIFO queue can be stalled by a failing item until vetoed/expired; after the D1 delay any two owners can change
everything (by design, with notice); the off-chain inbox "cancel" is not binding on-chain — the veto (K1 + K2) is.

## 10. Device key bound to the hardware — WebAuthn PRF (#11)

**Before**: K1 was an ethers keystore (scrypt + password) in `localStorage`. The passkey was checked by the co-signer
(unlock, every transaction) but the key file itself only needed the password: a copy of the browser storage (malware,
backup, forensic image) + a guessed / phished password = K1.

**Now** (`packages/shared/src/deviceBinding.ts`, `apps/web/src/lib/device.ts`):
- At passkey creation (onboarding and `/recover`) the device asks for the **PRF extension** with a fresh per-wallet
  salt (`prf.eval.first`, 32 random bytes, not secret). The authenticator (Secure Enclave, TPM, platform passkey
  manager, or a FIDO2 key with hmac-secret) computes `PRF = HMAC(secret that never leaves it, salt)` only after user
  verification.
- K1 is encrypted **twice**: the existing password keystore (scrypt) is wrapped with AES-256-GCM under
  `HKDF-SHA256(PRF output, random salt, info = wallet address)`; authenticated data binds the ciphertext to the K1
  address and the credential id. **Only the outer ciphertext is stored** (`hwKeystore`; `keystore` is emptied).
- **Unlock**: passkey assertion on the co-signer's `unlock` challenge **with PRF** (one Touch ID) → outer layer
  removed in memory → password decrypts the keystore (attempt limiting and the #16 duress check unchanged). The PRF
  output is stripped from every WebAuthn response sent to the co-signer (it never leaves the device).
- **In-session**: the password-encrypted keystore stays in memory until `lock()` (never stored in clear), so
  password re-checks during the session (privacy-lock fallback N1, re-authentication before showing a secret, duress
  code setup, recovery-kit replacement) need no extra prompt. A wrong password before unlock drops it (the next try
  needs the passkey again).
- **Privacy lock (N1) decision**: the password fallback of the privacy screen still works on a bound device — the
  wallet is still unlocked (K1 already in memory, the passkey already used at unlock), so the password is only
  *verified* against the in-memory keystore, which acts as the password verifier; nothing new is decrypted from
  storage. After a lock or a reload, a full unlock (passkey + password) is required.
- **Backup code** (passkey alternative): it cannot open a hardware-bound key. On a bound device the Unlock screen says
  so and points to "I lost my device" (recovery creates a new, bound device key).
- **Recovery** (`/recover`): the new passkey is created with PRF and the new K1 sealed the same way. The recovery
  kit's part ② security key is a **separate** credential (cross-platform, own salt and HKDF label) — never confused
  with the device passkey.
- **Existing devices**: keep working with the former scheme (no migration needed). Security → *Hardware binding*
  shows "not set on this device" and offers a one-tap binding; it succeeds only if the existing passkey can return a
  PRF output (many credentials created without the PRF extension cannot — then the binding is applied at the next
  device setup).
- **Browsers without PRF**: password-only keystore, Security says **"Hardware binding: not available on this
  browser"** (vs **"Hardware binding: active"**). Signatures still need the passkey assertion and K2.

| Threat | Before | Now (bound device) |
|---|---|---|
| Copy of the browser storage + password (malware, phishing, stolen backup) | K1 decrypted | ❌ needs the passkey on **this** hardware (PRF never leaves it) |
| Stolen unlocked laptop/phone (session open) | K1 in memory | Unchanged: privacy lock + passkey per transaction + K2 policy (production: shorter session) |
| Stolen device, locked, password known | Passkey needed to sign anyway, but K1 readable | K1 unreadable without user verification on the device (biometrics / device PIN) |
| Passkey synced to another device of the same account (iCloud / Google) | — | That device can produce the same PRF output: the binding is to the passkey provider account + biometrics, not strictly one chip (production target below fixes this) |

Tests: `packages/shared/test/deviceBinding.test.ts` (simulated PRF output: right passkey + password → K1; wrong PRF /
wrong salt / password alone / tampered record → refused); Playwright with Chrome's virtual authenticator
(`hasPrf: true, hasUserVerification: true`: create → unlock → lock → unlock, wrong password, storage copied to another
browser stays locked, privacy-lock fallback) and without `hasPrf` (fallback path).

**Production target**: a native app (iOS / Android) where K1 never exists in a web context —
- iOS: K1 encrypted with a key held in the **Keychain** with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` +
  access control `.biometryCurrentSet` (or a Secure-Enclave P-256 key used to wrap K1): not synced, not in backups,
  invalidated if biometrics change;
- Android: **StrongBox** / TEE Keystore key with `setUserAuthenticationRequired(true)` and
  `setIsStrongBoxBacked(true)` wrapping K1;
- or remove K1 altogether: make the **passkey itself a Safe owner** through Safe's WebAuthn signer (`SafeWebAuthnSigner`
  / shared signer, P-256 signature verified on-chain — cheap where the **RIP-7212** P-256 precompile exists, e.g. most
  L2s; via a Solidity verifier on Ethereum L1). Then no device private key exists in software at all.

