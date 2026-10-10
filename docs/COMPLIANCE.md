# Compliance features — Travel Rule, external wallet verification, annual statement & CSV

> **Not legal advice. To be validated by compliance.** This prototype runs on the Ethereum **Sepolia test network**.
> Sources were fetched on **2026-10-10**; only what they actually say is quoted below. Where we made a product
> decision that the sources do not dictate, it is labelled as such.

## 1. Sources consulted (fetched 2026-10-10)

| Source | What we rely on |
|---|---|
| FINMA press release, 26 Aug 2019, "FINMA guidance: stringent approach to combating money laundering on the blockchain" — https://www.finma.ch/en/news/2019/08/20190826-mm-kryptogwg/ | Information about the client and the beneficiary must be transmitted with token transfers; supervised institutions "are only permitted to send cryptocurrencies or other tokens to external wallets belonging to their own customers" and "are only allowed to receive cryptocurrencies or tokens from such customers". |
| FINMA Guidance 02/2019 "Payments on the blockchain" (PDF) — https://www.finma.ch/en/~/media/finma/dokumente/dokumentencenter/myfinma/4dokumentation/finma-aufsichtsmitteilungen/20190826-finma-aufsichtsmitteilung-02-2019.pdf | See quotes below. |
| FINMA press release, 2 Nov 2022, "FINMA publishes partially revised FINMA Anti-Money Laundering Ordinance" — https://www.finma.ch/en/news/2022/11/20221102-mm-gwv-finma/ | Technical measures "to prevent the threshold of CHF 1000 from being exceeded for linked transactions within thirty days (and not just per day)"; "this duty only applies to exchange transactions of virtual currencies for cash or other anonymous means of payment"; "The ordinance and regulations will come into force on 1 January 2023." |
| AMLO-FINMA (SR 955.033.0) on Fedlex — https://www.fedlex.admin.ch/eli/cc/2015/390/en | **Not readable by our tools** (JavaScript-only site). Art. 10 is therefore cited only through FINMA Guidance 02/2019 below — to be checked against the official text. |
| ESTV, "Kryptowährungen — Besteuerung" — https://www.estv.admin.ch/de/kryptowaehrungen-besteuerung | "Die ESTV publiziert die Steuerwerte der verbreitetsten Kryptowährungen in der Kursliste"; for coins without an ESTV value, the market value of one of the leading trading platforms may be used; if no value can be determined, the purchase price in CHF. Declared "am Ende der Steuerperiode zum Verkehrswert". |
| ICTax (ESTV Kursliste) — https://www.ictax.admin.ch/extern/en.html | The official rate list. It is a JavaScript application; we could **not** query ETH/USDC values reliably, so **no official value is configured** (see §4). |
| Canton of Aargau, "Kryptowährungen" — https://www.ag.ch/de/verwaltung/dfr/steuern/natuerliche-personen/steuererklaerung-easytax/kryptowaehrungen | Secondary source: the ESTV sets an "official" rate as an average of several trading platforms (example given: Bitcoin, 31.12.2024, CHF 85'926.49). |

Quotes from **FINMA Guidance 02/2019** (pages 2–3):

- "Article 10 AMLO-FINMA requires that information about the client and the beneficiary be transmitted with payment orders."
- "It is not necessary for the information to be transmitted on the blockchain. Transmission can take place via other communication channels."
- "Unlike the FATF standards, Article 10 AMLO-FINMA does not provide for any exception for payments involving unregulated wallet providers."
- "As long as an institution supervised by FINMA is not able to send and receive the information required in payment transactions, such transactions are only permitted from and to external wallets if these belong to one of the institution's own customers. Their ownership of the external wallet must be proven using suitable technical means. Transactions between customers of the same institution are permissible. A transfer from or to an external wallet belonging to a third party is only possible if, as for a client relationship, the supervised institution has first verified the identity of the third party, established the identity of the beneficial owner and proven the third party's ownership of the external wallet using suitable technical means."

What the sources do **not** say (in the documents we could read): a de-minimis amount below which the transmission
obligation would not apply. Neither FINMA document states a threshold for the Art. 10 transmission; we therefore apply
**none** to transmission. The **CHF 1'000** figure of the 2023 revision concerns *exchange transactions of virtual
currencies for cash or other anonymous means of payment*, not transfers between wallets.

## 2. Third-party transfers & Travel Rule (spec §15)

### What the product does
- **Send flow** (`apps/web/src/pages/Send.tsx`): explicit choice **"My own wallet"** vs **"Someone else's wallet"**.
  - *My own wallet*: only wallets verified for this client are offered — the Swissquote account (treasury) and external
    wallets proven with SIWE (§3). Any other address is refused by the server.
  - *Someone else's wallet*: **full name always required** (two words: first + last name, or company name), plus
    "exchange/bank account (hosted) or personal wallet (unhosted)?" and the institution name when hosted. From the
    configurable threshold (**default CHF 1'000, inclusive: ≥ 1'000 triggers**), alone or with linked transfers, the
    *enhanced* fields are required: street, (postcode), city, country, relationship, purpose, and a confirmation that
    the information is accurate. The UI states that collecting a name does not by itself make a transfer compliant.
- **Server policy** (`services/sq-cosigner/src/travelRule.ts`, wiring in `travelRuleGlue.ts`) — evaluated at
  **`/tx/prepare` and again at `/tx/submit`** before co-signing. At submit, the declaration is the one bound to the
  preview (the request body cannot change it) and the rate, counter-value, linked operations and own-wallet registry are
  recomputed.
  - CHF counter-value from a real, timestamped rate (`fetchWalletRates()` → market-data/CoinGecko). Missing rate, rate
    flagged stale, or older than `rateMaxAgeSec` (15 min) → **treated as ≥ threshold** (never assumed below).
  - **Linked operations** (product decision): the client's submitted third-party transfers (not failed / cancelled /
    rejected) to the **same beneficiary** — same normalised name *or* same address — within a rolling **30 days** are
    summed with the current one; any linked transfer that could not be valued makes the aggregate unknown (→ enhanced).
  - **Transmission**: no Travel Rule network is connected (no TRP / OpenVASP / Notabene…). Per Guidance 02/2019 a
    transfer to a third party then requires prior identification of the third party and proof of its wallet ownership,
    which we cannot do either. Therefore **every real third-party transfer is BLOCKED** unless the demo mode is on.
  - **Demo mode** (`TRAVEL_RULE_DEMO_MODE`; default **ON only when `NODE_ENV !== 'production'`**, OFF in production):
    the transfer proceeds and every screen/check is labelled **"Demo — Travel Rule data collected but not transmitted;
    not compliant"**.
  - Transfers to the client's own verified wallets need no beneficiary data. A transfer with no declaration is accepted
    only if the recipient is one of those wallets.
  - Out of scope / not modelled: transfers to another Swissquote client ("permissible" per the guidance) are treated as
    third-party; receiving-side checks (incoming transfers from third parties) are not implemented.

### Configuration (auditable)
`packages/shared/src/travelRule.ts` (`TRAVEL_RULE`, version `TR-2026-10-10.1`) + env overrides read by the co-signer:
`TRAVEL_RULE_THRESHOLD_CHF` (1000), `TRAVEL_RULE_RATE_MAX_AGE_SEC` (900), `TRAVEL_RULE_LINKED_WINDOW_DAYS` (30),
`TRAVEL_RULE_DEMO_MODE` (`1`/`0`). Effective values: `GET /clients/:id/travel-rule/config`.

### Personal data & audit
- Beneficiary data is stored **only in the client record** of the co-signer (`client.travelRule.records`), returned
  to that client (`GET /clients/:id/travel-rule/records`) and to the compliance role (`GET /admin/travel-rule`, shown in
  the console `/admin`). It is **never** written in activity texts, notifications, console logs or on the blockchain.
  Only whitelisted fields are kept (`sanitizeDeclaration`).
- Records of previews that never led to a submission are pruned after 24 h. Submitted records carry
  `retainUntil` = creation + **10 years** (configured value — matching the 10-year record-keeping period commonly
  cited for Swiss AML law, art. 7 AMLA; *not fetched in this iteration — to be validated*). No automatic deletion job yet.
- **Audit trail** (`db.travelRuleAudit`): rule version, threshold, rate + asOf + provider (or the rate issue), CHF
  value, aggregate, linked count, enhanced yes/no, missing field ids, wallet type, transmission status, demo flag,
  decision, stage (prepare/submit), pseudonymous client id — **no name, no address, no purpose**.

## 3. External wallet verification — SIWE (spec §16)

- Server: `services/sq-bank/src/siwe.ts` (sq-bank is the KYC / verified-wallet registry). Own EIP-4361 text
  builder/parser (format only); signatures verified with **ethers**: EOA via `verifyMessage` (EIP-191
  `personal_sign`), contract accounts via **EIP-1271** `isValidSignature(hashMessage(message), sig)` on Sepolia.
- Challenge: domain + URI from the browser's `Origin` (must be on the allow-list), checksummed address, chain id
  (Sepolia only), 128-bit random nonce, `Issued At`, `Expiration Time` = +5 min, statement: proof of control, free, no
  transaction, no approval, never a seed phrase or private key.
- Verify: the nonce is **consumed atomically before any await** (single use; a replay → 409), then fields are compared
  with the stored challenge (domain, URI, address, chain, nonce), the message must be byte-identical (tampering → refused),
  expiry checked, then the signature. Result stored in `verifiedWallets` with `{address, label, method, verifiedAt,
  chainId, kind:'external'}`. Revocation: `POST /clients/:id/external-wallets/:address/revoke`.
- UI: Settings → "Your external wallets" (`apps/web/src/components/ExternalWallets.tsx`): EIP-1193 injected wallet
  (ethers `BrowserProvider`), network switch to Sepolia, the exact message is shown before signing, refusal (4001),
  account/network change (flow restarted), "No wallet extension detected" when there is none. Wording: *proof that you
  controlled this address at <time> — not a proof of identity nor a compliance attestation.*
- Endpoints: `GET /clients/:id/external-wallets`, `POST …/external-wallets/challenge`, `POST …/external-wallets/verify`,
  `POST …/external-wallets/:address/revoke` (all behind the session middleware: own client only).
- Env: `SIWE_ALLOWED_ORIGINS` (default: the services' CORS allow-list, http(s) only).

## 4. Annual statement & CSV export (spec §17)

Server: `services/sq-cosigner/src/statements.ts`; UI: Swaplet → Documents → "Annual statement & export"
(`apps/web/src/components/AnnualDocuments.tsx`). The wallet (and so this screen) is only rendered once unlocked
(password + passkey) and is unmounted behind the privacy screen when the user leaves; the server requires an authenticated session of that client.

**Statement** (`GET /clients/:id/statements/:year`, years from `GET /clients/:id/statements/years`)
- Cut-off: **31 December 23:59:59 Europe/Zurich** → UTC computed with `Intl` (DST-aware; 31.12 is CET, so
  `22:59:59Z`). Current year (not closed): **provisional statement as of now**, explicitly labelled.
- Quantities: chain state at the **last block with timestamp ≤ cut-off** (binary search on block timestamps), via
  `eth_getBalance` / USDC `balanceOf` with a historical `blockTag`. On 2026-10-10, `ethereum-sepolia-rpc.publicnode.com`
  returned *"pruned history unavailable"* while `sepolia.drpc.org` served historical state; the archive list is
  `SEPOLIA_ARCHIVE_RPC_URLS` (default drpc, then the normal RPCs). If none can serve it, the balance is **reconstructed
  from the wallet records** and flagged **INCOMPLETE** (they miss incoming transfers that My Wall did not track).
- Wallet created after the cut-off → "wallet created on <date>, not held at that date" (a real zero, explained).
- Valuation: official ESTV value from `OFFICIAL_YEAR_END_RATES` when configured (**empty**: we could not verify any
  ETH/USDC value on ICTax). Otherwise **CoinGecko CHF daily price of 01.01 (year+1) 00:00 UTC** (= 01:00 Zurich, one
  hour after the cut-off) via market-data `/price-on`, flagged **"estimated — not the official ESTV rate"**; provisional
  years use the current indicative market price. Missing price → value "unavailable", total marked incomplete.
- **Sepolia test tokens have no market value**: CHF figures are illustrative only (stated on screen and in the PDF).
- Contents: account (client id, name), year, cut-off + time zone, block/method/RPC, per-asset quantity, rate, source,
  rate date, value, total, wallets covered (only the My Wall Safe), exclusions, warnings, disclaimer (help for the tax
  return, **not an official Swissquote tax certificate**). PDF generated in the browser with jsPDF; on-screen view is
  printable.

**CSV** (`GET /clients/:id/exports/transactions/:year` → `{filename, csv}`; `?format=csv` returns `text/csv`)
- Period: the Zurich calendar year. Source: all wallet transaction records (`walletTx`, no pagination), plus executed
  Safe transactions that moved no asset (approvals, key rotation) and the wallet deployment.
- UTF-8 **with BOM**, CRLF, stable columns: `date_iso_utc, date_local (Europe/Zurich with offset), type, network,
  asset, quantity (unsigned, full token precision), direction, fee_amount, fee_currency (sponsored → 0 / "sponsored"),
  from_address, to_address, tx_hash, status, chf_value, chf_method`.
- RFC 4180 quoting; cells starting with `= + - @ TAB CR` are prefixed with `'` (quantities are unsigned, so numbers are
  not altered). No secrets, no beneficiary personal data.
- CHF value: CoinGecko CHF daily price (00:00 UTC of the transaction date), "estimate; testnet asset, no real market
  value"; at most 120 price lookups per export, beyond that "unavailable".
- **Coverage limits**: the records are exhaustive for transfers made through My Wall (co-signed sends), receptions from
  the Swissquote account and tracked receptions, and simulated demo receptions (marked "simulated demo", network
  "none"). They are **not** exhaustive for tokens sent directly to the Safe from another wallet without being tracked —
  the statement (chain state) is authoritative for holdings; the CSV is not a full chain indexer.

## 5. Tests
`services/sq-cosigner/test/travelRule.test.ts`, `services/sq-cosigner/test/statements.test.ts`,
`services/sq-bank/test/siwe.test.ts` (run by `npm test`). `scripts/e2e-demo.ts` sends a 0 ETH ping to a third party
("Bob Example", unhosted) with the beneficiary data; it relies on the demo mode being on (default outside production).
