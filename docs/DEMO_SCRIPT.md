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
| 3 | Activation: *document de démonstration* → *Envoyer* → passkey (Touch ID) → password: first **too short** (refused, live checklist) then valid → 3 questions (show that a chosen question **disappears** from the other lists) → creation (progress list, Etherscan link) → **recovery kit without QR**: masked code, *Show* 30 s, *Print* (steel-plate advice) → **② Register my security key** (insert the YubiKey and touch it — or the virtual authenticator, see Fallbacks) → *Download an offline copy (encrypted)* | "Device key on her phone behind Face ID, Swissquote co-signer, recovery key split in 3: a paper code, her physical security key, an independent partner. No cloud: Swissquote only stores a ciphertext it cannot open. Gas paid by Swissquote." |
| 4 | My Wall home: big balances; scroll → the white sheet slides over, compact bar "My Wall · … CHF" | "Balances first, everything else in the sheet." |
| 5 | *Simuler une réception (démo)* → grey "en attente" (no check) → **orange disc + check** "Réception confirmée — 250 USDC" | "The check only appears once confirmed." |
| 6 | *Voir le justificatif* → then **Swaplet → Documents**: same receipt, PDF download | "Receipts are derived from the transaction — never duplicated, never contain secrets." |
| 7 | *Depuis mon compte* → 5 USDC → pending → confirmed (real Sepolia, Etherscan) | "Wallet pre-verified with an on-chain EIP-1271 proof: no Travel Rule friction." |
| 8 | Informations: 3 categories, unread dots, open one, back (filters kept) | |
| 9 | Sécurité: *Afficher temporairement* the device key (password + Touch ID, 30 s countdown, re-mask) → export encrypted backup → *Vérifier* with a **wrong password** → refused | "Three different secrets, three different exposures. No seed phrase." |
| 10 | *Envoyer* → Bob → 2 USDC: plain-language review, checks, *Confirmer avec Touch ID* → confirmed, zero ETH in the wallet | |
| 11 | *Envoyer* → a **new address** → 1 USDC → reinforced: email code (Inbox) → cooling-off → tab B *Valider* → confirmed | "Four-eyes off-chain: Swissquote still holds a single key." |
| 12 | *Envoyer* → *Adresse sanctionnée (démo)* → refusal explained | "Swissquote can block, never move funds." |
| 13 | Paramètres → *Simuler : j'ai perdu cet appareil* → recovery: liveness ✓, questions, **type the paper code** (show a typo → checksum error on that group) **+ choose *Security key* and touch it** — paper + key are enough, the partner's part is not even needed (paper + partner and key + partner also work) → new passkey → 2-min delay with cancel (Inbox) | During the delay: step 14 |
| 14 | Tab C attacker: steps 1, 2, 3 — all refused, Alice alerted | "Phone + email are not enough." |
| 15 | Recovery completes → old device revoked on-chain → send 1 USDC from the new device | |
| 16 | Terminal: `npm run escape-hatch -- --device-key <backup.json> --paper "<code>" --offline <my-wall-offline-backup.json> --to 0x…` (or `--security-key <part.json> --prf-output <hex>` read with a FIDO2 tool) | "If Swissquote disappears, Alice's two keys still move her funds." |
| 17 | *Security → Recovery kit → Replace my recovery kit* (on an old wallet: **Replace cloud backup**): wallet password → new paper code → touch the security key → *Confirm the replacement (Touch ID)* → Etherscan | "A new recovery key replaces the old one on the blockchain: the old paper code and any old backup file now open nothing." |

## New features (≈ 3 extra minutes, after step 10)
| # | Show | Say |
|---|---|---|
| N1 | *Envoyer* → Compte Swissquote → 0.1 USDC → **Vérifier**: debited / received (estimate) / network fee (offered) / service commission 0 / **balances before → after** / "Aperçu valable encore 60 s" | "A simulation, shown as an estimate — never a guarantee." |
| N2 | Open *Démonstration : variation des frais* (MOCK) → *Frais simulés : 2 CHF* → *Faire passer les frais à 8 CHF* → confirm → **"Les frais estimés sont passés de 2.00 à 8.00 CHF"** → new preview → *Revenir aux frais réels* | "The confirmation is tied to the exact transaction and its conditions." |
| N3 | In *Envoyer*, paste Bob's address with one character changed in the middle → red **look-alike** warning with the differing character highlighted | "Address poisoning: a resemblance is never a match." |
| N4 | *dApps* → Uniswap → *Autoriser sans limite* → red alert "Cette application demande une autorisation de dépense illimitée sur vos USDC" → **Limiter le plafond à 2** → preview recalculated → reinforced checks (code + admin) → confirmed | |
| N5 | *Plus › Applications autorisées* → Uniswap · 2 USDC · date → **Retirer l'accès** → confirmed on-chain → list empty | "Revocation counts only once confirmed on Ethereum." |
| N6 | *Envoyer* → *Planifier* (date + time, Europe/Zurich) → *Plus › Dépenses planifiées*: edit / delete; at the due time the item becomes **À confirmer** + notification — nothing was sent | |
| N7 | Orange **Abonnements** link → 3 offers, 3 payment modes (Plus 11 × 5.83 € + 5.87 €), comparator (Plus from 1 750 €, Pro from 4 000 €), subscribe Plus in **demo payment mode** | "Our commission only, never on transfers, no hidden spread." |
| N8 | *Swaplet › Échanger* (DEMO): 500 USDC → minimum received, slippage, commission 0.40 % (Plus), ETH balance for fees, quote expiry → confirm → "aucune transaction n'a été exécutée" | |
| N9 | *Sécurité* → **Geler la co-signature** (passkey) → try a send → refused → unfreeze | "The client can lock Swissquote out; the K1 + K3 exit stays open." |
| N10 | *Sécurité* → **Code de secours** (12 characters, shown once, retyped, activated with the passkey) → lock → unlock page → "La biométrie n'est pas disponible ?" → unlock with the code | "Not a recovery phrase; it can't freeze, reveal amounts or secrets." |
| N11 | Amounts in clear after unlock → switch to another tab and back → **“My Wall is locked”** (no figure) → *Unlock with my passkey* (or *Use my wallet password instead*) · *Settings › Appearance*: System / Light / Dark (System follows the OS live) · *Settings › Personalisation*: accent, background, highlight, hidden wallets, reset | "Leaving the app always hides your balances; only you can show them again." |
| N12 | *Inbox* → *Nouveau message* → type a private key → blocked; write a normal message → draft saved → *Ouvrir dans ma messagerie* opens your own email client (nothing is sent by My Wall) | |

## Desktop (1440×900)
Same story from the **"Mon wallet" button** next to the account icon: multi-zone grid (balances band with assets side by side, transactions table, account ↔ wallet panel, 3 information panels), Swaplet with the side preview.

## Extra cases to show if asked
Password too short · question unavailable elsewhere · wrong unlock password ("Il vous reste 4 essais", 30 s wait after 5) · reveal expiring · wrong backup password / altered backup file · pending transaction without check.

**Escape-hatch prep**: after step 15, from the current device — Security → *Download an encrypted backup* (device key); keep the paper code and part ② (an offline file made with the *I don't have a security key* option is the easiest in a terminal; a security-key part needs its PRF output from a FIDO2 tool — the script prints the salt). The device key address needs ~0.001 Sepolia ETH (no sponsoring without Swissquote): `npm run fund-check -- --tip <device key address> 0.002`.

**Fallbacks**: no Touch ID → Chrome DevTools › More tools › WebAuthn › enable virtual authenticator. No YubiKey → add a second virtual authenticator: protocol *ctap2*, transport *usb*, **Supports PRF** + *Supports user verification* checked; or use the *I don't have a security key* offline file. RPC slow → automatic fallback to a 2nd public RPC. UI issue → run `npm run e2e` live.
