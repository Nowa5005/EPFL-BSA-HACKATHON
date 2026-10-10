# Demo script (≈ 3 minutes)

**Setup (before the jury arrives)**
1. `npm run dev` (starts the 3 services + web app). Check the terminal shows a relayer balance > 0.
2. `npm run reset-demo` for a clean state. `npm run fund-check` (treasury has test USDC + a little gas).
3. Open Chrome: tab A `http://localhost:5173` (DevTools → device toolbar → iPhone 14, optional), tab B `http://localhost:5173/admin`, tab C `http://localhost:5173/attacker`.
4. Safety net: the headless run `npm run e2e` (≈ 4 min) proves create → sign → recover on Sepolia without the UI.

| # | Time | What to show | What to say |
|---|---|---|---|
| 1 | 0:00 | Tab A → sign in as **alice** → *Create my wallet* → Touch ID → password + 3 questions → progress list → **recovery kit** (download kit + save to cloud) | "Alice is already a KYC'd Swissquote client. Her wallet is created in 30 s: device key on her phone behind Face ID, Swissquote co-signer, recovery key split in 3. A Safe 2-of-3, deployed on Ethereum — Swissquote paid the gas." |
| 2 | 0:35 | Wallet → **Swissquote account card** → *Transfer* 10 USDC | "Her wallet was registered as hers with an on-chain EIP-1271 proof: no Travel Rule friction. Real USDC on Sepolia." |
| 3 | 0:55 | *Send* → Bob → 2 USDC → **plain-language review** + checks → *Confirm with Touch ID* → Confirmed + Etherscan | "Plain words, fees offered by Swissquote, her wallet has zero ETH. Touch ID is bound to this exact transaction; Swissquote co-signs after its checks." |
| 4 | 1:20 | *Send* → 1 USDC to a **new address** (paste any 0x… address) → **reinforced** → code from **Inbox** → 30 s cooling-off → tab B **Approve** → executed | "New recipient (or ≥ 50 USDC, or any dApp): email code, cooling-off, four-eyes approval by compliance — off-chain. Swissquote still holds only one key." *(With ≥ 60 USDC in the treasury you can show the amount threshold instead: 60 USDC to Bob.)* |
| 5 | 1:45 | *Send* → **Sanctioned address (demo)** → refused with explanation | "Sanctions screening: Swissquote refuses to co-sign. It can block — it can never move funds." |
| 6 | 1:55 | Settings → *Simulate: I lost this device* → *I lost my device* → liveness ✓, questions, upload the **paper kit PNG** → new passkey → **2-min delay** with cancel button (show Inbox) → completed → *old key revoked on-chain* → send 1 USDC to Bob | "Recovery: independent Swiss trustee releases its share after video-ident; paper kit + partner rebuild the recovery key on the new phone; old phone revoked on-chain." *(While waiting the 2 min, do step 7.)* |
| 7 | 2:15 | Tab C (attacker) → steps 1, 2, 3 | "A thief with her phone AND her email: no Face ID → Swissquote won't co-sign. Recovery: liveness fails, no paper kit, SIM swap → refused, and Alice is alerted in her bank account." |
| 8 | 2:40 | Terminal: `npm run escape-hatch -- --device-key … --paper … --cloud … --to 0x…` | "And if Swissquote disappears? Alice's two keys — device + paper/cloud — move her funds with only a public RPC. Also works in app.safe.global." |
| 9 | 2:55 | Business slide (docs/BUSINESS.md) | "Free + Premium 5 CHF, spreads, retention: assets stay one click from trading. ~3 M CHF/year under conservative assumptions." |

**Escape hatch prep** (after step 6, from the *current* device — the old device key is revoked): Settings → *Export encrypted device key*; keep the downloaded `sq-wallet-paper-kit-*.png` and `sq-wallet-cloud-backup-*.json`. The device key's address needs ~0.001 Sepolia ETH for gas (no Swissquote sponsoring in this scenario): `npm run fund-check -- --tip <device key address> 0.002` simulates "Alice bought a little ETH anywhere".

**Fallbacks**
- Touch ID not available: Chrome DevTools → *More tools → WebAuthn* → *Enable virtual authenticator environment* → add a "internal" authenticator with user verification.
- RPC slow: services automatically fall back to a second public RPC.
- UI problem: run `npm run e2e` live — it prints Etherscan links for every step.
