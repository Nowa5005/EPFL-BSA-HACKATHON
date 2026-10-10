# Business case — SQ Wallet

> All figures are **illustrative assumptions**, not Swissquote data.

## Problem today
- Every withdrawal to an external wallet = assets **leaving the Swissquote ecosystem** (and future trading revenue with them).
- Each external wallet requires **manual Travel Rule verification** (support tickets, screenshots, Satoshi tests).
- Crypto-native clients want **self-custody**; they go to Ledger/MetaMask + an exchange, not to a bank.

## Solution
A self-custody wallet **one click away from the Swissquote account**: the client holds the keys, Swissquote provides bank-grade security (passkeys, co-signing checks, guided recovery), Swiss compliance and a gas-free experience.

## Revenue
| Stream | Description |
|---|---|
| **Free tier** | Wallet, recovery kit, standard limits, 20 sponsored transactions/day |
| **Plus / Pro** (7 € or 15 € per month, 70 € / 150 € per year, or 12 instalments) | Service commission on eligible exchanges cut by 50 % / 75 % (0.40 % / 0.20 % instead of 0.80 %); premium services (priority human-assisted recovery, inheritance) can be bundled. Details and benchmark: [PRICING.md](PRICING.md) |
| **Service commission on eligible exchanges** | 0.80 % (Free) / 0.40 % (Plus) / 0.20 % (Pro) on swaps only — never on transfers in or out, no hidden spread on top of the partner rate |
| **Curated dApp access** | Distribution fees from whitelisted dApps (staking, tokenised assets) |

## Retention & acquisition
- **Retention**: assets stay one click from the trading account → clients come back to trade at Swissquote instead of leaving to an exchange.
- **Acquisition**: crypto-native clients who want self-custody **and** a Swiss bank's security — a differentiator vs. neobanks and exchanges.

## Cost savings
- Travel Rule verification of the client's own wallet becomes **automatic and cryptographic** (EIP-1271), no manual checks.
- Fewer support tickets: guided recovery instead of "I lost my seed phrase".
- **No capital to immobilise for custody** (non-custodial).

## Cost of gas sponsoring (who pays?)
Swissquote pays network fees as an **acquisition / retention cost**. On Ethereum L1 a sponsored transfer costs ~0.10–2 CHF depending on congestion; on an L2 (Base, Arbitrum…) < 0.01 CHF. Abuse is bounded: KYC-linked wallets only, 20 sponsored tx/day/client, gas cap per tx, sponsorship only when the policy engine approves.

## Illustrative calculation
See **[PRICING.md §4](PRICING.md)** for the assumptions (30 000 active users, 85 / 12 / 3 % plan mix, monthly swap volumes per tier, payment, gas, support and VAT). Under those assumptions: ≈ 35.8 k € subscriptions + ≈ 111.6 k € commissions − ≈ 22.9 k € variable costs ≈ **124.5 k € / month contribution before fixed costs (≈ 1.5 M € / year)** — very sensitive to the swap-volume assumptions, and not a net-profit figure.

## Roadmap
1. Pilot on an L2 (Base / Arbitrum) to make gas sponsoring near-free; ERC-4337 paymaster or EIP-7702.
2. Real HSM for K2, certified video-ident provider, real recovery partner (Swiss trustee / notary).
3. Inheritance flow, multi-asset (MPC/TSS for Bitcoin).
