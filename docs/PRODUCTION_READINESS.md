# Production readiness — what is simulated in this prototype, and what replaces it

My Wall is a hackathon prototype on the **Ethereum Sepolia testnet**. The custody core is real (Safe 2-of-3 contracts,
signatures, owner rotation, policy engine, cryptographic libraries). Everything a bank would buy from a regulated
provider or run on dedicated infrastructure is **simulated**. This matrix lists each simulated element, the type of
production integration planned, the risk of shipping it as is, and an effort estimate.

Effort: **S** ≤ 2 weeks · **M** 1–2 months · **L** 3+ months (one team, integration + tests + compliance sign-off).
Provider names are examples of the *type* of partner, not a selection.

| # | Element | What is simulated | Production integration (type) | Risk if shipped as is | Effort |
|---|---|---|---|---|---|
| 1 | Client identity (KYC) at activation | Document check runs locally; only an "OK" outcome is stored | **FINMA-approved video / online identification provider** (FINMA Circ. 2016/7), linked to Swissquote's existing KYC file | No legal identification — not allowed for a real client | M |
| 2 | Liveness check at recovery | Scripted pass / fail in the recovery-partner mock | Same identification provider (selfie + liveness vs KYC photo), with presentation-attack detection certified (ISO 30107-3) | A thief could pass the identity step | M |
| 3 | Sanctions screening | Small hard-coded list (incl. 2 real OFAC addresses) | **Sanctions & blockchain-analytics data provider** (SECO, OFAC, EU, UN lists + address risk scoring, e.g. Chainalysis / Elliptic / TRM type), screened on every co-signature and on incoming funds | Sanctioned transfers not detected; regulatory breach | M |
| 4 | Swissquote co-signing key K2 | Encrypted keystore file (`SERVICE_MASTER_KEY`) on the service host | **HSM** (FIPS 140-3 L3 / Common Criteria) or cloud HSM / KMS, key ceremony, dual control, per-client key derivation, rotation (#17) | Theft of the host = theft of all K2 (still not enough alone to move funds, but blocks clients) | L |
| 5 | Recovery partner (share ③ holder) | Separate demo service run by the same team | **Independent Swiss fiduciary / trustee partner** under contract (escrow agreement, own infrastructure, own identity checks, audits) | No real independence: Swissquote + "partner" are one party | L |
| 6 | Core banking: client account, CHF/USDC balance, treasury | JSON files; treasury is a test wallet funded from faucets | Swissquote core banking + regulated stablecoin treasury (custody of the float, reconciliation, accounting) | Balances and transfers are fictitious | L |
| 7 | Email / SMS / push notifications | "Mock Inbox" page; nothing is sent | Transactional email & SMS gateway, mobile push (APNs / FCM), templates validated by compliance | Clients never warned of a recovery or a theft attempt | S |
| 8 | Travel Rule transmission | Beneficiary data collected and checked, **not transmitted**; third-party sends blocked outside demo mode | **Travel Rule network** (TRP / OpenVASP or a commercial Travel Rule network), IVMS101 messages, VASP directory, self-hosted wallet proofs | Non-compliant with FINMA Guidance 02/2019 for third-party transfers | M |
| 9 | Compliance console (four-eyes, audit log) | Single demo login `compliance`, any password | Swissquote back-office SSO (MFA), role separation, case management, WORM audit storage, retention 10 years | Anyone with the demo login could approve | M |
| 10 | Gas sponsoring (relayer) | One hot wallet funded from a faucet, quotas in a JSON file | ERC-4337 paymaster or a relayer service with HSM-held key, monitoring, budget alerts; EIP-7702 when available | Relayer key theft drains the gas budget; outage blocks normal sends | M |
| 11 | Blockchain access & on-chain indexer | Free public RPCs (publicnode, drpc, Tenderly gateway) polled every 15 s | Own Ethereum nodes or a contracted RPC / indexing provider with SLA, websocket subscriptions, reorg handling, archive access | Missed or late receipts, rate limits, no SLA | M |
| 12 | Market data (quotes, charts, wallet CHF values) | Yahoo Finance public endpoints (no contract) + CoinGecko free tier | Licensed market-data feed (e.g. SIX for securities, a regulated crypto price index), redistribution licence | Licence breach; values can stop without notice | M |
| 13 | Tax valuation of the annual statement | CoinGecko CHF estimate at 31.12 | Official ESTV year-end rates (Kursliste) where available | Statement values may differ from tax values | S |
| 14 | Order ticket (Buy / Sell), token exchange (Swaplet) | Quote is real server logic; **never executed** | Swissquote order routing / crypto trading desk, best-execution policy | — (nothing executes) | L |
| 15 | Subscriptions & payment | Demo payment mode; nothing charged | Payment service provider + billing, VAT, invoicing | — (nothing charged) | S |
| 16 | Session & service secrets | Generated once into a git-ignored `.env` | Secret manager / KMS, rotation, mTLS between services, WAF, rate limiting | Secret leak = session forgery | M |
| 17 | Device key K1 | Encrypted in the browser (password + passkey gate; PRF binding when supported) | Native app: Secure Enclave / StrongBox key, or a passkey directly owner of the Safe (WebAuthn signer) | Browser storage copy + password guess | L |
| 18 | Recovery part ② (physical security key) | WebAuthn PRF with a demo / virtual authenticator | FIDO2 hardware keys distributed or certified by Swissquote; enrolment ceremony; spare key | Demo authenticators are not hardware-bound | S |
| 19 | Native iOS / Android apps | Capacitor projects generated, not compiled or signed | Store builds, code signing, associated domains (passkeys), MDM / jailbreak checks, release process | No real mobile distribution | M |
| 20 | Terms of use, legal texts | Prototype drafts | Review and approval by Swissquote Legal & Compliance; versioning in the client contract system | Not legally binding as written | S |
| 21 | Co-signer response-time commitments ([COSIGNER_COMMITMENTS.md](COSIGNER_COMMITMENTS.md)) | Mechanics only (motivated refusals, decision log) | Staffed compliance desk, SLA monitoring, complaints office process | Commitments not measurable | S |
| 22 | Testnet assets | Sepolia ETH and Circle test USDC — no value | Ethereum mainnet (and chosen L2s), whitelisted stablecoins with issuer due diligence, chain-specific risk review | — (prototype only) | M |

## What is real today (for contrast)

Safe v1.4.1 2-of-3 accounts and owner rotation on Sepolia, EIP-712 / EIP-1271 signatures, passkeys (WebAuthn) bound to
the transaction hash, the policy engine and independent calldata validation, the on-chain receipt indexer, Shamir
splitting of the recovery key, keystore encryption, signed service sessions and CORS / CSRF defences, real market data,
PDF receipts. See the **Real vs Mock** table in the [README](../README.md).

## Short version shown in the app

The "About this prototype" page (`/about`, linked from the footer and from Wallet → More) shows a condensed version
of this table. The screens themselves carry no extra badges.
