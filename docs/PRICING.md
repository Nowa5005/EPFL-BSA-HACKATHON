# Pricing — My Wall (prototype)

> Product hypotheses, not validated market data nor financial advice. Benchmark checked on **10 October 2026**; competitor prices change often — re-check before any decision.

## 1. Offers implemented

| Offer | Monthly (cancel for next due date) | Annual, paid once | Annual, 12 instalments (12-month commitment) | Service commission on eligible exchanges |
|---|---:|---:|---:|---:|
| Free (Gratuit) | 0 € | — | — | **0.80 %** |
| Plus | 7 € / month | 70 € / year | 70 € = 11 × 5.83 € + 1 × 5.87 € | **0.40 %** (−50 %) |
| Pro | 15 € / month | 150 € / year | 150 € = 12 × 12.50 € | **0.20 %** (−75 %) |

- The commission applies **only to eligible exchanges (swaps)**. It is **never** taken on incoming or outgoing transfers, approvals or revocations.
- Plan discounts apply to **our commission only** — not to network fees nor partner (DEX / liquidity) fees. No hidden mark-up in the quoted rate to compensate; the total is shown before confirmation.
- No cap on the number of discounted operations.
- Implementation: `packages/shared/src/pricing.ts` (integer cents, basis points, bigint token units, half-up rounding), entitlements and commission computed **server-side** in `sq-cosigner` (`effectiveTier`, `/swap/quote`). Unit tests: `services/sq-cosigner/test/features.test.ts`.
- **Payment**: no payment provider is configured in this repo → subscribing runs in an explicit **demo mode** (`payment: 'demo'`), nothing is charged. Prices are in **EUR** as specified; the rest of the app displays CHF.
- **Swaps are a demo**: the quote (commission, slippage, minimum received, expiry) is computed for real by the server, but no swap is executed on Sepolia.

### Cost comparator (monthly billing, same volume, identical third-party fees excluded)
- Free: `volume × 0.008` · Plus: `7 + volume × 0.004` · Pro: `15 + volume × 0.002`
- Plus beats Free above **1 750 €** of monthly exchanged volume; Pro beats Plus above **4 000 €**. Volume = total exchanged in the month, not the balance held.

## 2. Benchmark (official sources first)

Checked 2026-10-10, from Switzerland. "Service fee" = the provider's own fee, excluding network gas and price impact.

### a) In-wallet token exchanges (swaps) — comparable to our 0.80 %
| Provider | Service fee | Source | Restrictions / notes |
|---|---|---|---|
| MetaMask (Swaps) | 0.875 % | Official support: [MetaMask — user guide swaps](https://support.metamask.io/manage-crypto/move-crypto/swap/user-guide-swaps) | Plus network fee; gasless swaps only on some networks. |
| Coinbase Wallet / Base app | up to 1 % | Official help: [Coinbase — DEX swap](https://help.coinbase.com/en-au/wallet/getting-started/dex-swap) | "Up to 1 %", taken from the output amount; aggregators may add their own fee. Page could not be re-fetched today (HTTP 403), wording from the indexed version. |
| Phantom | 0.85 % (most swaps) | Secondary: [ethereum.org wallet listing](https://ethereum.org/wallets/find-wallet/phantom/) (updated 30.10.2024), [Finder review](https://www.finder.com.au/cryptocurrency/wallets/phantom-wallet-review) | Official help page did not show the figure — **to verify**. |
| Rabby | 0.25 % | [ethereum.org wallet listing](https://ethereum.org/wallets/find-wallet/rabby-wallet/) (updated 24.07.2024), [Rabby announcement coverage](https://crypto-economy.com/rabby-wallet-unveils-new-features-with-iota-evm-integration-and-0-25-swap-fee/) | Built-in swap and bridge. Not from Rabby's own site — **to verify**. |
| Uniswap Labs interface | 0 % since 27.12.2025 | Official support: [What are Uniswap Labs' fees?](https://support.uniswap.org/hc/en-us/articles/20131678274957-What-are-Uniswap-Labs-fees) | Liquidity-provider pool fees (e.g. 0.05–1 %) still apply and are not a wallet fee. |
| Ledger Live | Ledger fee + partner fee, variable | Official developer docs: [Ledger — quote display](https://developers.ledger.com/docs/ledger-live/exchange/swap/flow/quote) | No public flat rate; fixed-rate quotes cost more than floating. Not averaged. |

**Average (comparable offers only)** — wallet-integrated swap service fees with a published rate: MetaMask 0.875 %, Coinbase 1 % (maximum), Phantom 0.85 %, Rabby 0.25 % → **≈ 0.74 %**. Uniswap's 0 % interface fee is a different product (no wallet service, LP fees still apply) and is excluded; including it would give ≈ 0.60 %. Two of the four rates come from secondary sources.
→ Our **0.80 %** Free rate sits in the upper half of this range; it is a **product hypothesis**, justified by bank-grade co-signing, compliance checks and sponsored gas — not a market average.

### b) Buying / selling crypto against fiat (broker trading) — NOT comparable to swaps
| Provider | Fee | Source |
|---|---|---|
| Swissquote (CH) | 1 % (Standard I) down to 0.18 % taker / 0.08 % maker (PRO II), by 30-day volume | Official: [Swissquote — cryptocurrency fees](https://swissquote.com/en-ch/private/trade/pricing/cryptocurrencies) |

### c) Transfers in / out of a provider
| Provider | Fee | Source |
|---|---|---|
| Swissquote | Deposits ≥ USD 500 free, otherwise USD 10; withdrawals USD 10 (BTC, ETH…) or USD 15 (USDC, USDT, ERC-20…) | Official: same Swissquote page |
| Self-custody wallets above | No provider fee to send/receive; network fee only | Wallet docs above |

### d) Spreads, partner fees, network fees
- Spreads are embedded in quoted rates and vary by venue and size — not comparable to explicit commissions; we commit to no hidden spread on top of the partner rate.
- Partner / liquidity fees (DEX pool fees, aggregator fees) are passed through and not reduced by our plans.
- Network fees depend on the chain and congestion; on Ethereum L1 they can exceed the commission on small swaps, on L2s they are typically a few cents.

**Do not mix categories**: an average of swap commissions is not an average of wallet entry/exit fees.

## 3. Transfer pricing — proposal only, DISABLED
Today: incoming and outgoing transfers carry **no** service commission (network fee sponsored within the daily quota). A possible future rule, kept **disabled** until explicitly defined: no commission on transfers between the client's own verified wallets and Swissquote account; for outgoing transfers to third parties beyond the free sponsored quota, pass through the network fee at cost (no margin). Technically feasible via the co-signer policy engine, but not implemented as a charge.

## 4. Illustrative contribution-margin estimate (assumptions — not a profit forecast)

| Assumption | Value |
|---|---|
| Active My Wall users | 30 000 (5 % of ~600 000 clients) |
| Plan mix | 85 % Free, 12 % Plus, 3 % Pro |
| Billing | 60 % monthly, 40 % annual (prices treated as VAT-inclusive; Swiss VAT 8.1 % deducted) |
| Eligible swap volume per user / month | Free 300 €, Plus 2 500 €, Pro 8 000 € |
| Payment processing | 1.5 % + 0.25 € per charge (monthly charges), 1.5 % + 0.25 € once (annual) |
| Gas sponsoring (on an L2) | 0.01 € × 15 sponsored tx / user / month |
| Liquidity / partner fees | passed through, 0 margin |
| Support | 0.40 € / Free user / month, 1.50 € / paying user / month |
| Fixed costs (team, HSM, infra, compliance tooling) | not included |

Monthly figures (≈):
- Subscriptions: Plus 3 600 × 7 € + Pro 900 × 15 € = 38 700 € gross → ≈ 35 800 € after VAT.
- Commissions: Free 25 500 × 300 € × 0.80 % = 61 200 €; Plus 3 600 × 2 500 € × 0.40 % = 36 000 €; Pro 900 × 8 000 € × 0.20 % = 14 400 € → ≈ 111 600 €.
- Variable costs: payment ≈ 1 400 €; gas ≈ 4 500 €; support ≈ 10 200 € + 6 750 € ≈ 16 950 € → ≈ 22 850 €.
- **Contribution before fixed costs ≈ 124 500 € / month (≈ 1.5 M € / year)** — highly sensitive to the swap-volume assumptions (halve the volumes → commissions ≈ 55 800 €).

This is **revenue minus selected variable costs**, not net profit: fixed costs, regulatory costs, partner revenue sharing, marketing, fraud losses and taxes on profit are excluded, and profitability is not guaranteed.
