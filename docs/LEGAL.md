# Legal feasibility — SQ Wallet (Switzerland)

> **Not legal advice.** Hackathon analysis to frame questions for Swissquote's legal & compliance teams. References must be re-verified by a qualified lawyer.

## 1. Custody: is Swissquote a custodian?

**The test.** Under the Swiss approach (FINMA practice; Banking Act / Banking Ordinance provisions on crypto-based assets, DLT Act 2021 and the bankruptcy segregation rules for crypto-assets — e.g. Art. 242a SchKG/LP — *to verify*), the decisive question is **who has the power of disposal**: who can move the assets, alone or jointly with others?

**Our design.** The wallet is a Safe 2-of-3 on Ethereum. Swissquote holds **one key (K2)**. The client holds the device key (K1) and controls the recovery key (K3), split in 3 Shamir shares of which the client holds two (paper + encrypted cloud) and an **independent Swiss recovery partner** holds one.

- Swissquote **cannot move funds alone** (1 of 3 keys).
- Swissquote **+ the partner cannot either**: the partner holds 1 of 3 Shamir shares — K3 cannot be rebuilt (closes the "grey zone" raised in the brief).
- The client **can move funds without Swissquote** (K1 + K3: escape hatch, demonstrated on-chain).

**Our position.** SQ Wallet is a **non-custodial wallet: software + a co-signing (security) service**. Crypto-assets do not appear on Swissquote's balance sheet, are not deposits, and do not trigger the capital and segregation requirements of crypto custody.

**The honest grey zone.** Swissquote can **block** (refuse to co-sign), e.g. for sanctions — it cannot **move**. Mitigations:
1. the escape hatch K1 + K3 (no Swissquote needed) — documented, scripted, and possible via the public Safe UI;
2. contractual commitment: Swissquote will not refuse co-signature except for legal reasons, and informs the client;
3. a freeze is visible to the client in the app.

**Residual risks to flag.** A court or authority compelling **both** the recovery partner **and** the client's cloud provider (share ②) — mitigated because share ② is encrypted with the client's password. A Swissquote co-signature without the client is impossible by construction.

**Why not "two Swissquote signatures above a threshold"?** An early idea was to have a second Swissquote employee sign on-chain for large amounts. If Swissquote held 2 of 3 keys, it could move funds alone → **custody**. We kept the idea **off-chain**: above the threshold, K2 co-signs only after a **four-eyes approval** by a compliance officer (admin console). Swissquote keeps a single key on-chain.

## 2. Travel Rule & self-hosted wallets

FINMA requires institutions to identify the **owner of an external (self-hosted) wallet** before sending to or receiving from it (FINMA Guidance **02/2019** "Payments on the blockchain"; AMLO-FINMA Art. 10 — *to verify*). Today this is often done manually (screenshots, "Satoshi test").

**In SQ Wallet:**
- The Safe is created **by Swissquote for an already-KYC'd client**. At creation, the client's device key and Swissquote's co-signer sign an **EIP-1271** proof-of-ownership statement; `sq-bank` verifies it **on-chain** (`Safe.isValidSignature` returns `0x1626ba7e`) and registers the Safe as a **verified wallet of the client**. → Transfers account ↔ wallet need **no manual verification**.
- For the client's **other** wallets: ownership proof by message signature in the address book (planned, M8).

**Payments from the wallet to third parties.** Swissquote does not execute orders on behalf of the client; it only co-signs technically and cannot act alone → one can argue Swissquote is **not the ordering institution** for Travel Rule purposes.
*Counter-position (to present honestly):* Swissquote co-signs and screens, so it could be seen as an intermediary. **Prudent product option built in:** collect beneficiary information for large amounts (reinforced level), which the policy engine already gates.

## 3. AML / sanctions (AMLA / LBA)

The co-signer applies a **risk-based approach**:
- sanctions screening of every counterparty (mock list containing real OFAC SDN addresses + a SECO demo entry; production: Chainalysis/Elliptic + SECO/OFAC/EU feeds);
- thresholds and daily limits, reinforced checks (email OTP + cooling-off + **four-eyes**) above 50 USDC (demo; ~1'000 CHF in production) or for new recipients and dApps;
- dApp whitelist; plain-language simulation; full audit log shared with the client.

## 4. Data protection (nFADP)

Blockchains are public. The client's **privacy setting** ("full consolidated view" / "balance only" / "none") controls Swissquote's **consolidated display and data use**, not on-chain visibility — stated explicitly in the app.

## 5. Open questions for a lawyer

1. Does a 1-of-3 co-signing key combined with a **blocking** capability qualify as "power of disposal" under FINMA practice?
2. Is Swissquote the "ordering institution" under the Travel Rule when it only co-signs a client-initiated transfer?
3. Is the recovery partner a regulated activity (financial intermediary / custodian) if it holds 1 of 3 Shamir shares only?
4. Contractual framework: liability when Swissquote refuses to co-sign; obligations if Swissquote ceases operations (wind-down plan pointing to the escape hatch).
5. Can EIP-1271 on-chain proof of ownership be accepted as the self-hosted wallet verification method by FINMA?
6. Sponsoring gas fees: any consumer-credit or inducement implications? (We believe not — it is a service cost.)
7. Cross-border clients (EU MiCA for non-custodial wallet providers, which are in principle out of MiCA scope).
