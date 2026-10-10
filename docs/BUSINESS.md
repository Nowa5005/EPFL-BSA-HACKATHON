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
| **Premium ~5 CHF/month** | Higher limits, unlimited gas sponsoring, priority **human-assisted recovery**, **inheritance** (designate heirs through the recovery procedure) |
| **Spread on transfers & swaps** | Account ↔ wallet conversions (CHF ↔ USDC), in-wallet swaps |
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
| Assumption | Value |
|---|---|
| Swissquote clients | ~600'000 |
| Adoption of the wallet | 10 % → 60'000 wallets |
| Premium conversion | 5 % of clients → 30'000 × 5 CHF × 12 = **1.8 M CHF/year** |
| Transfers & swaps | 60'000 × 4'000 CHF/year volume × 0.5 % spread = **1.2 M CHF/year** |
| Gas sponsoring cost (L2) | 60'000 × 100 tx × 0.01 CHF = **–0.06 M CHF/year** (L1: ×50–100) |
| Avoided outflows | if 10 % of crypto withdrawals stay in the ecosystem → retained trading revenue (not quantified) |

**→ ~3 M CHF/year direct revenue** under these assumptions, plus retention, plus lower compliance & support costs.

## Roadmap
1. Pilot on an L2 (Base / Arbitrum) to make gas sponsoring near-free; ERC-4337 paymaster or EIP-7702.
2. Real HSM for K2, certified video-ident provider, real recovery partner (Swiss trustee / notary).
3. Inheritance flow, multi-asset (MPC/TSS for Bitcoin).
