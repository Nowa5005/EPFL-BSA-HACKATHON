# Custody & threat model — SQ Wallet

## 1. Custody model in one picture

The wallet is a **Safe smart account (v1.4.1) on Ethereum, 2-of-3 owners**. The 2-of-3 rule is enforced **on-chain by the audited Safe contract**, not by a Swissquote promise.

| Key | Holder | Where it lives | Used for |
|---|---|---|---|
| **K1 — device key** | Client | Generated in the browser/app; encrypted at rest (ethers keystore, scrypt) with the wallet password; usable only after a **passkey** (Touch ID / Face ID) | Every-day signing |
| **K2 — co-signer key** | Swissquote | Generated and used **server-side only** in `sq-cosigner` (HSM in production, JSON file in the prototype) | Co-signs **after** checks: passkey, compliance, limits, delays |
| **K3 — recovery key** | Client | Generated client-side, immediately **split Shamir 2-of-3**: ① paper kit (QR) · ② cloud backup (encrypted with the wallet password) · ③ independent recovery partner. The full key is erased from memory | Recovery + escape hatch |

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
- **No custom cryptography**: hashing/signing is EIP-712 via ethers; signature verification is done by the Safe contract; Shamir via the audited library; encryption via WebCrypto (AES-GCM + PBKDF2) and the ethers keystore (scrypt).

## 3. Threats

| # | Threat | Can steal? | Can block? | Counter-measures in the prototype |
|---|---|---|---|---|
| T1 | **Phone thief** | No | No | K1 is encrypted by the password; every transaction needs a **passkey assertion bound to the Safe tx hash** (WebAuthn challenge = SafeTx hash) verified by `sq-cosigner`; without it K2 refuses → 1 signature max. Owner rotation via recovery revokes the stolen device **on-chain**. *Demo: `/attacker` step 1.* |
| T2 | **Phone + email compromised** | No | No | Recovery requires **liveness vs KYC photo** (hard requirement), the **paper kit** (otherwise +40 risk), risk score (new device, unusual IP, **recent SIM swap**); security questions have **low weight**. The real client is alerted in the **Swissquote account (separate login)**. Even after a successful recovery request, a **delay** (48 h prod / 2 min demo) with one-tap **cancel**. The cloud backup is encrypted with the wallet password. *Demo: `/attacker` steps 2–3, `npm run e2e` step 3b.* |
| T3 | **SIM swap** | No | No | SMS is a notification only, never a factor sufficient on its own; a recent SIM swap raises the recovery risk score. |
| T4 | **Swissquote alone / rogue employee** | **No** (1 of 3 keys) | Yes (refuse to co-sign) | Escape hatch K1+K3; **four-eyes** approval for reinforced transactions; full audit log; freeze is visible to the client. |
| T5 | **Swissquote + recovery partner collude** (or are both compelled) | **No** | — | Partner holds only Shamir share ③ (1 of 3) — K3 cannot be rebuilt. Residual risk: partner + client's cloud provider both compelled → mitigated because share ② is **encrypted with the client's password**. |
| T6 | **Swissquote server breached, K2 stolen** | Not alone (needs K1 or K3 too) | Possible (DoS) | HSM in production; K2 rotation via K1+K3; relayer key separate from K2. |
| T7 | **Client loses everything** (device + paper + cloud) | — | Loss | Human-assisted recovery is a product decision (premium): partner + video-ident; advice to keep 2 paper copies. In production: Zodiac **Delay module** for long-timeout fallbacks. |
| T8 | **Swissquote disappears** | — | No | **Escape hatch**: `npm run escape-hatch` rebuilds K3 from paper + cloud and signs with K1+K3, using only a public RPC; also works in the public Safe UI (app.safe.global). |
| T9 | **Phishing / malicious dApp** | Reduced | — | **dApp whitelist**, **sanctions screening** of every counterparty, **plain-language simulation** (`eth_call`) before signing, **red alert on unlimited `approve`**, step-up for every dApp interaction, DELEGATECALL never co-signed, owner changes only through the recovery procedure. |
| T10 | **Malicious relayer / gas griefing** | No | Possible delay | Relayer only submits; it holds no owner key. Gas cap per tx, daily sponsored quota per client, sponsorship only if the policy engine approves. |
| T11 | **Replay of a passkey assertion** | No | — | Challenge = SafeTx hash which includes the Safe **nonce** → valid for exactly one transaction; WebAuthn signature counter tracked. |
| T12 | **Device limit bypass** (attacker adds a 3rd device) | No | — | Server refuses more than 1 mobile + 1 computer; adding a device requires an existing device; a new device registered during recovery stays *pending* until the rotation completes. |

## 4. Local secrets on the device (My Wall UI)
- **Unlock** requires the wallet password (scrypt keystore decrypted locally; 5 attempts then a 30 s wait in the demo) **and** a passkey assertion; the session is only marked unlocked after both.
- **Recovery code kept on the device**: share ① is stored **encrypted with the wallet password** (AES-GCM, PBKDF2) so that it can be shown again after re-authentication. Trade-off: an attacker with the device **and** the password **and** the client's cloud backup (also password-encrypted) could rebuild K3 — the same material as the escape hatch. Mitigations: re-authentication with passkey to reveal, 30 s display, the client can delete it from the device after printing; production would keep it only until the client confirms the paper kit.
- **Secrets display**: never written to logs, history, notifications or storage in clear; re-masked on expiry, page exit and when the app goes to the background; clipboard cleared after 30 s (best effort).
- **Security questions**: 3 distinct out of 15, answers normalised then scrypt-hashed with a per-answer salt at the partner; low weight in the risk score, never sufficient alone.
- **Device-key backup file**: ethers keystore v3 (scrypt + AES-128-CTR + MAC) plus a SHA-256 of the keystore to report accidental corruption before trying the password.

## 5. Known limitations (prototype)

- K2 and the relayer key are JSON files (MOCK HSM). Liveness, SMS/email, sanctions feed, KYC and the recovery partner are mocks (clearly labeled in the UI).
- The headless e2e demo client skips the passkey step (no browser); the UI always uses real passkeys.
- Recovery when the device **and** Swissquote are lost is documented, not built (Zodiac Delay module).
- EVM only (no Bitcoin) — MPC/TSS would be the path for BTC.
- Passkeys registered on the same Mac during the recovery demo replace each other (same user handle); fine for the demo.
