# My Wall — Terms of Use

**Version 1.0 — 10.10.2026**

> **Prototype — not legal advice, to be reviewed by Swissquote Legal.** These terms were written for the Swissquote Wallet Challenge (EPFL hackathon) to show how the real service would be described to a client. They describe the product as built in this prototype. They have not been reviewed by a lawyer and are not offered to anyone. A French translation is available in annex (`TERMS_v1.0.fr.md`); if the two versions differ, the English version prevails.

## In short (5 points)

1. **You stay in control of your funds.** Your wallet needs 2 keys out of 3. Swissquote holds only one: it can never move your funds on its own.
2. **You look after your secrets.** Your device and password, your paper recovery code and your physical security key are yours to keep safe. Swissquote cannot read them or reset them.
3. **Swissquote co-signs by published rules.** Every refusal is explained. If Swissquote refuses or is unavailable, the protected exit lets you move your funds after a 48-hour on-chain delay.
4. **Clear fees.** The commission is charged only on exchanges (0.80 % on the Free plan, less with Plus or Pro). Network fees are paid by Swissquote within a daily quota.
5. **Crypto-assets carry risk.** Prices move, and a confirmed transaction cannot be reversed. This prototype runs on the Ethereum Sepolia test network: nothing has real value.

---

## 1. The parties and the service

1.1 These Terms of Use ("Terms") govern the use of **My Wall**, the self-custody crypto wallet offered by Swissquote Bank Ltd ("Swissquote", "we") to its existing clients ("you").

1.2 My Wall is **software plus a co-signing security service**. Your wallet is a **Safe smart account** (an audited, open-source smart contract on the Ethereum blockchain) with three owner keys and a threshold of two. Swissquote provides the app, holds one of the three keys, checks every transaction against the rules in section 4, and pays the network fees within the limits of section 10.

1.3 My Wall is available only to clients whose identity Swissquote has already verified (KYC). It is linked to your Swissquote client relationship; the general terms and conditions of that relationship also apply. If they conflict with these Terms on a matter specific to My Wall, these Terms prevail.

## 2. Non-custodial nature: who holds which key

2.1 Your wallet is controlled by three keys:

| Key | Who holds it | What it is used for |
|---|---|---|
| **K1 — device key** | You | Created on your device, encrypted with your wallet password and usable only after your passkey (Touch ID / Face ID). Used for everyday signing. |
| **K2 — co-signer key** | Swissquote | Kept by Swissquote (in a hardware security module in production). Signs only after the checks of section 4. |
| **K3 — recovery key** | You | Never stored in one piece. It is split into parts: your **paper recovery code**, a part protected by your **physical security key**, and a part held by an independent **recovery partner** (and, if you choose, a **trusted contact** — section 5.6). Two parts are needed to rebuild it. |

2.2 **Swissquote cannot move your funds on its own.** It holds one key out of three; the blockchain requires two. Swissquote together with the recovery partner cannot rebuild K3 either.

2.3 **Your crypto-assets are not deposits** and do not appear on Swissquote's balance sheet. They are not covered by the Swiss depositor protection scheme. Because you can always move them without Swissquote (section 6), Swissquote does not hold them in custody. *(Note for Swissquote Legal: this qualification under FINMA practice must be confirmed — see `docs/LEGAL.md`.)*

2.4 There is **no 12- or 24-word secret phrase** in My Wall. Security rests on the three keys, two of which are always required.

2.5 **On-chain safety rules.** In addition to the 2-of-3 rule, your wallet has a **guard** and **delay modules** written into the blockchain:

| Signatures | Effect |
|---|---|
| Your device key **and** Swissquote (K1 + K2) — normal use | Executed immediately, after Swissquote's checks |
| Any other combination of two keys (for example recovery key + Swissquote, or device key + recovery key without Swissquote) | Never immediate: queued for **48 hours** (delay **D1**), during which you can veto it |
| Recovery key alone (K3) | Queued for **30 days** (delay **D2**), with veto possible |
| A designated heir (section 7) | Queued for **6 months** (delay **D3**), with veto possible |
| Cancelling a pending operation (veto) | Immediate, with any two keys |

The guard contract is specific to My Wall and has not yet been independently audited (see `docs/PRODUCTION_READINESS.md`). The delay modules are the open-source Zodiac Delay Modifier.

## 3. Your responsibilities

3.1 You must keep safe and never share:
- your **device** and its screen lock, and your **passkey**;
- your **wallet password** (it encrypts your device key on your device; Swissquote never receives it);
- your **paper recovery code** (keep it offline, ideally in two places, never photographed or stored in the cloud);
- your **physical security key** (for example a FIDO2 key), which protects one part of your recovery key;
- any **duress code** you set up (section 5.7).

3.2 Swissquote **cannot recover or reset** your password, your paper code or your physical security key. If you lose your device, your paper code and your physical security key at the same time and have not chosen a trusted contact, the long-term recovery path (delay D2, section 5.4) may be your only option, and in some cases your funds may become inaccessible.

3.3 You check every transaction before you confirm it: the recipient address, the network (Ethereum), the asset and the amount. My Wall shows a plain-language summary of each transaction; a transaction you confirm and that is executed **cannot be reversed**.

3.4 You keep your contact details up to date, so that we can warn you of a pending operation on your wallet, and you read these warnings promptly. Your veto (section 5.2) only protects you if you act within the delay.

3.5 You complete the **recovery health check** when the app reminds you (every 6 months), so that your recovery means still work.

3.6 You do not use My Wall for unlawful purposes, to circumvent sanctions, or on behalf of a third party.

## 4. The Swissquote co-signer

4.1 **Role.** Swissquote's co-signer checks each transaction you sign and adds the second signature when the rules are met. The rules are published in the app and include: confirmation by your passkey bound to the exact transaction, sanctions screening of the recipient (section 8), Travel Rule data when required (section 8), daily limits, reinforced checks above a threshold (email code, cooling-off period, four-eyes approval by a compliance officer), a list of allowed applications (dApps), and refusal to interact with unknown or look-alike tokens and addresses.

4.2 **Reasoned refusals.** If the co-signer refuses a transaction, the app shows you the precise reason, the rule concerned and how to resolve it. Refusals are recorded in a log that you can consult. Swissquote refuses to co-sign only for legal or regulatory reasons, to protect you against a likely fraud, or because a rule you accepted is not met.

4.3 **Response times.** A compliant transaction is co-signed in less than 60 seconds. A transaction that needs a human review is decided within 24 hours (business days; target values, see `docs/COSIGNER_COMMITMENTS.md`). You can contest a refusal through the procedure described in that document.

4.4 **Suspension.** Swissquote may suspend co-signing for your wallet (for example on a legal order, a sanctions match or a suspected compromise). A suspension is visible in the app. It never prevents the protected exit of section 6, which only adds the 48-hour delay.

4.5 **Key rotation.** Swissquote may replace its key (K2) for security reasons. You will then be asked to confirm a "Security update" in the app; the old Swissquote key is refused after the announced deadline. Your funds and your wallet address do not change.

## 5. Security delays, veto and recovery

5.1 **Why delays.** Except for normal use (K1 + K2), no operation on your wallet is immediate. This means that even someone who obtains two keys, or Swissquote and the recovery partner acting together, cannot move your funds without you being warned and able to react.

5.2 **Veto.** As soon as an operation is queued in a delay module, My Wall notifies you (in-app notification, email and a red banner "A protected operation is pending on your wallet"). You can cancel it with one action ("Cancel it"), which uses your device key and one other key.

5.3 **Lost device (recovery).** If you lose your device, you can recover your wallet with Swissquote's help: identity checks (including a liveness check against your KYC photo), your recovery code, then a replacement of your device key that is queued for **48 hours** (D1) before it is executed. You are warned through your Swissquote account during this delay.

5.4 **Long-term recovery.** If neither your device nor Swissquote is available, your recovery key alone can move your funds after **30 days** (D2).

5.5 **Delay values.** The delays above are the production values. The prototype uses short demonstration values (minutes instead of days). Lowering a protection is immediate; raising a limit you have set (for example your daily ceiling) takes effect after 24 hours.

5.6 **Trusted contact (optional).** You may name a person you trust. Your recovery key is then split into four parts (paper code, physical security key, recovery partner, trusted contact), any two of which are enough. Your trusted contact alone cannot rebuild the key or move your funds, and any recovery still goes through the delays above.

5.7 **Duress code (optional).** You may set a duress code. Entered instead of your password, it opens a decoy view and silently suspends co-signing and alerts Swissquote. Use it only when you are under threat. Swissquote will then contact you through your verified channels before restoring co-signing.

## 6. Protected exit and "Take full control"

6.1 **Protected exit.** You can always move your funds **without Swissquote**: with your device key and your rebuilt recovery key (paper code plus physical security key), you queue a transfer to the address of your choice. It is executed after **48 hours** (D1). This works even if Swissquote's services are unavailable ("Emergency mode", which reads the blockchain directly). A small **emergency gas reserve** left in your wallet at creation is used only for this purpose.

6.2 **Take full control.** You can end the co-signing service at any time from Security → "Take full control of my wallet". Swissquote's key is then replaced by a key that you control (a new key saved in an encrypted file, or an external wallet whose ownership you prove by signature), and the guard and delay modules are removed or kept, as you choose. If Swissquote cooperates, this is immediate; otherwise it goes through the 48-hour delay.

6.3 After you take full control, your wallet is a standard Safe that you can use with other software (for example app.safe.global). Swissquote's co-signing, compliance checks, sponsored fees, recovery assistance and support end for this wallet, and the protections of sections 4 and 5 no longer apply.

## 7. Succession

7.1 You may designate one or more **heirs** in Security → "Legacy / beneficiaries", with a wallet address whose ownership they prove by signature.

7.2 A designated heir can queue a transfer of your funds to their own address. It is executed after **6 months** (D3). While you are alive, you can cancel it with a simple veto, and you are strongly notified.

7.3 In parallel, Swissquote handles the off-chain file (death certificate, certificate of inheritance) under its usual succession procedures. Swissquote does not block the on-chain execution, but may, together with the executor of the estate, contest it through the veto mechanism. The designation of an heir in My Wall does not replace a will and does not decide questions of Swiss inheritance law (reserved shares, community of heirs); these points are to be reviewed by Swissquote Legal.

## 8. Compliance

8.1 **Sanctions screening.** Every recipient and every application your wallet interacts with is screened against sanctions lists (SECO, OFAC, EU) and blockchain-analytics risk data. Swissquote refuses to co-sign a transaction to a sanctioned address and may report it to the competent authorities as required by law. *(Prototype: a demonstration list containing real public OFAC addresses.)*

8.2 **Travel Rule.** Swiss anti-money-laundering rules (AMLO-FINMA Art. 10, FINMA Guidance 02/2019) require information on the originator and the beneficiary to accompany transfers. When you send to **someone else's wallet**, My Wall asks for the beneficiary's name and, above certain amounts, additional details. This information is transmitted in the **IVMS101** format to the beneficiary's service provider (VASP) before co-signing, or, for a self-hosted wallet, the beneficiary's ownership is proven by signature. Transfers to your **own verified wallets** do not require third-party data.

8.3 **Wallet verification.** Before you can send to or receive from another wallet of yours, you prove that you control it by signing a standard message ("Sign-In with Ethereum", EIP-4361) or, for smart-account wallets, an EIP-1271 signature. The signature is not a transaction and costs nothing. Your My Wall wallet is verified automatically at creation.

8.4 We may ask you for additional information about a transaction or the origin of funds. If you do not provide it, Swissquote may refuse to co-sign.

## 9. Fees, plans and subscriptions

9.1 **Commission.** A service commission applies **only to eligible exchanges (swaps)** between crypto-assets in My Wall. It is never charged on incoming or outgoing transfers, approvals or revocations.

| Plan | Price | Commission on eligible exchanges |
|---|---|---|
| Free | 0 € | 0.80 % |
| Plus | 7 € / month, or 70 € / year (paid once or in 12 monthly instalments with a 12-month commitment) | 0.40 % |
| Pro | 15 € / month, or 150 € / year (paid once or in 12 monthly instalments with a 12-month commitment) | 0.20 % |

9.2 Plan discounts apply only to Swissquote's commission, not to network fees or partner (liquidity) fees, which are passed through at cost. The total cost is shown before you confirm an exchange. There is no hidden margin in the exchange rate.

9.3 **Subscriptions.** A monthly subscription can be cancelled at any time and ends at the next due date. An annual subscription paid once runs for 12 months. An annual subscription paid in instalments commits you for 12 months. Prices include VAT where applicable. *(Prototype: no payment is taken; subscribing runs in demonstration mode. Exchanges are quoted but not executed.)*

9.4 Swissquote may change its prices under section 15. A price increase is a substantive change.

## 10. Sponsored network fees and quotas

10.1 Every Ethereum transaction costs a network fee ("gas"). In normal use, **Swissquote pays these fees for you**: you do not need to hold ETH.

10.2 Sponsoring is limited to **20 transactions per day** per client and to a maximum amount of gas per transaction, to prevent abuse. Above the quota, the co-signer refuses to sponsor the transaction and tells you why; you can try again the next day.

10.3 The **emergency gas reserve** (section 6.1) cannot be spent in normal use.

10.4 Swissquote may change the quota under section 15. Network fees for operations outside normal use (protected exit, long-term recovery, operations after "Take full control") are paid from your wallet.

## 11. Privacy and data

11.1 Swissquote processes your personal data under the Swiss Federal Act on Data Protection (nFADP) and its privacy notice. For My Wall, this includes: your wallet address and transactions, your device and passkey identifiers, the Travel Rule data you provide, the records of your consent to these Terms (version, date and device), and logs of co-signing decisions.

11.2 **What Swissquote never receives:** your wallet password, your device key, your paper recovery code, or your full recovery key.

11.3 **A public blockchain stays public.** Your wallet's transactions are visible to anyone on Ethereum. Your privacy setting ("full consolidated view", "balance only" or "none") controls how Swissquote displays and uses wallet data in your Swissquote account; it does not change what is visible on the blockchain. Compliance checks always apply.

11.4 Travel Rule data is kept for 10 years as required by anti-money-laundering law and is never written to the blockchain, to notifications or to logs.

11.5 The recovery partner and the beneficiary's service provider (Travel Rule) receive only the data they need for their role.

## 12. Risks of crypto-assets

12.1 The value of crypto-assets can change sharply and may fall to zero. Stablecoins (such as USDC) depend on their issuer and may lose their peg. CHF values shown in My Wall are **indicative**.

12.2 Blockchain transactions are **irreversible**. A transfer sent to a wrong address, to the address of a token contract, or on the wrong network may be lost. My Wall runs checks before sending but cannot guarantee that every error is caught.

12.3 Smart contracts and blockchains may contain undiscovered flaws. Networks may be congested, forked or attacked. Unknown tokens sent to your wallet are often scams: My Wall hides them and does not let you interact with them.

12.4 Nothing in My Wall is investment advice. Market information and educational content are provided for information only.

## 13. Test network (this prototype)

13.1 This prototype runs on **Ethereum Sepolia**, a public test network. Test tokens (test ETH, test USDC) have **no monetary value** and cannot be exchanged for money.

13.2 Some components are simulated (for example identity verification, the recovery partner, the counterparty service provider for the Travel Rule, payments and emails). The page "About this prototype" lists what is real and what is simulated.

## 14. Availability

14.1 Swissquote aims to keep My Wall available at all times but does not guarantee uninterrupted service. If Swissquote's services are unreachable, the app tells you and offers **Emergency mode**: your balances are read directly from the blockchain and the protected exit (section 6.1) remains available.

## 15. Changes to these Terms

15.1 Swissquote may change these Terms. Every version has a number and a date, and the changes are summarised in plain language in Information → "My Wall updates".

15.2 A **substantive change** (one that affects your rights, your obligations, fees, quotas, delays or how your data is used) requires your **new acceptance** the next time you open My Wall. Until you accept it, you cannot use the wallet screens, but the protected exit and Take full control remain available to you.

15.3 A **non-substantive change** (wording, clarifications, corrections) is announced for information only and does not require a new acceptance.

15.4 You can see the version you accepted, its date, and download it as a PDF at any time (Settings, and Swaplet → Documents → Legal).

## 16. Liability

16.1 Swissquote is liable for damage caused by its intentional or grossly negligent breach of these Terms. To the extent permitted by law, Swissquote is not liable for losses resulting from: transactions you confirmed, the loss or disclosure of your secrets (section 3), the behaviour of blockchains, smart contracts or third-party applications, market movements, or refusals to co-sign made in accordance with section 4.

16.2 Nothing in these Terms limits liability that cannot be limited under Swiss law. *(To be reviewed by Swissquote Legal, in particular Art. 100 CO.)*

## 17. Termination

17.1 You may stop using My Wall at any time, in particular through "Take full control" (section 6.2). Your funds remain yours.

17.2 Swissquote may end the co-signing service with two months' notice, or immediately for serious reasons (for example a legal obligation). In every case, you keep the protected exit and Take full control, and Swissquote will help you move your funds.

## 18. Applicable law and jurisdiction

18.1 These Terms are governed by **Swiss law**. The place of jurisdiction is that stated in the general terms and conditions of your Swissquote client relationship, subject to mandatory consumer jurisdiction rules. *(To be confirmed by Swissquote Legal.)*

## 19. Contact

Questions, complaints or contesting a refusal: through the secure messaging of your Swissquote account. *(Prototype: no real contact channel.)*

---

*My Wall — Terms of Use, version 1.0 of 10.10.2026. Prototype — Swissquote Wallet Challenge (EPFL). Not legal advice, to be reviewed by Swissquote Legal.*
