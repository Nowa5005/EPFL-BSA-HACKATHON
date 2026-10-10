# Demo script (≈ 4 minutes)

**Setup (before the jury arrives)**
1. `npm run dev` (3 services + web app). The terminal shows the relayer balance (must be > 0).
2. `npm run reset-demo` for a clean state; `npm run fund-check` (treasury test USDC + a little gas).
3. Chrome: tab A `http://localhost:5173` in DevTools device mode **390×844** (or a real phone on the same Wi-Fi via `vite --host`), tab B `http://localhost:5173/admin`, tab C `http://localhost:5173/attacker`.
4. Safety net: `npm run e2e` (≈ 3.5 min) proves create → sign → recover on Sepolia without the UI.

> Test-USDC budget: the treasury holds ~19 USDC. The amount threshold (≥ 50 USDC) is therefore shown with the policy table; the reinforced level is demonstrated live with a **new recipient** (same checks: email code, cooling-off, four-eyes).

## Phone (390×844)
| # | Show | Say |
|---|---|---|
| 1 | Sign in as **alice** → `/sq/markets`: reconstructed Swissquote app, SMI list moving | "Alice is a Swissquote client. My Wall lives inside the app she already uses." |
| 2 | Pull up the **"Mon wallet"** tab → panel slides up → *Activer My Wall* | "One gesture from her trading app." |
| 3 | Activation: *document de démonstration* → *Envoyer* → passkey (Touch ID) → password: first **too short** (refused, live checklist) then valid → 3 questions (show that a chosen question **disappears** from the other lists) → creation (progress list, Etherscan link) → **recovery kit without QR**: masked code, *Afficher* 30 s, *Imprimer*, cloud backup | "Device key on her phone behind Face ID, Swissquote co-signer, recovery key split in 3. Gas paid by Swissquote." |
| 4 | My Wall home: big balances; scroll → the white sheet slides over, compact bar "My Wall · … CHF" | "Balances first, everything else in the sheet." |
| 5 | *Simuler une réception (démo)* → grey "en attente" (no check) → **orange disc + check** "Réception confirmée — 250 USDC" | "The check only appears once confirmed." |
| 6 | *Voir le justificatif* → then **Swaplet → Documents**: same receipt, PDF download | "Receipts are derived from the transaction — never duplicated, never contain secrets." |
| 7 | *Depuis mon compte* → 5 USDC → pending → confirmed (real Sepolia, Etherscan) | "Wallet pre-verified with an on-chain EIP-1271 proof: no Travel Rule friction." |
| 8 | Informations: 3 categories, unread dots, open one, back (filters kept) | |
| 9 | Sécurité: *Afficher temporairement* the device key (password + Touch ID, 30 s countdown, re-mask) → export encrypted backup → *Vérifier* with a **wrong password** → refused | "Three different secrets, three different exposures. No seed phrase." |
| 10 | *Envoyer* → Bob → 2 USDC: plain-language review, checks, *Confirmer avec Touch ID* → confirmed, zero ETH in the wallet | |
| 11 | *Envoyer* → a **new address** → 1 USDC → reinforced: email code (Inbox) → cooling-off → tab B *Valider* → confirmed | "Four-eyes off-chain: Swissquote still holds a single key." |
| 12 | *Envoyer* → *Adresse sanctionnée (démo)* → refusal explained | "Swissquote can block, never move funds." |
| 13 | Paramètres → *Simuler : j'ai perdu cet appareil* → recovery: liveness ✓, questions, **type the paper code** (show a typo → "Le groupe 5 semble erroné") → new passkey → 2-min delay with cancel (Inbox) | During the delay: step 14 |
| 14 | Tab C attacker: steps 1, 2, 3 — all refused, Alice alerted | "Phone + email are not enough." |
| 15 | Recovery completes → old device revoked on-chain → send 1 USDC from the new device | |
| 16 | Terminal: `npm run escape-hatch -- --device-key <backup.json> --paper "<code>" --cloud <cloud.json> --to 0x…` | "If Swissquote disappears, Alice's two keys still move her funds." |

## Desktop (1440×900)
Same story from the **"Mon wallet" button** next to the account icon: multi-zone grid (balances band with assets side by side, transactions table, account ↔ wallet panel, 3 information panels), Swaplet with the side preview.

## Extra cases to show if asked
Password too short · question unavailable elsewhere · wrong unlock password ("Il vous reste 4 essais", 30 s wait after 5) · reveal expiring · wrong backup password / altered backup file · pending transaction without check.

**Escape-hatch prep**: after step 15, from the current device — Sécurité → *Télécharger une sauvegarde chiffrée*; keep the cloud backup file and the paper code. The device key address needs ~0.001 Sepolia ETH (no sponsoring without Swissquote): `npm run fund-check -- --tip <device key address> 0.002`.

**Fallbacks**: no Touch ID → Chrome DevTools › More tools › WebAuthn › enable virtual authenticator. RPC slow → automatic fallback to a 2nd public RPC. UI issue → run `npm run e2e` live.
