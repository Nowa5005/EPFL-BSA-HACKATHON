# Co-signer commitments — what Swissquote promises when it co-signs (or refuses)

My Wall is a Safe 2-of-3 wallet. Swissquote holds **one** key (K2, the co-signer). It can **refuse** to co-sign, but it
can never move funds on its own, and a refusal never locks the client in. This page states the service commitments that
make "Swissquote can refuse" acceptable for a self-custody product (problem #4).

> Prototype. The figures below are the **target production commitments** proposed to Swissquote; the demo implements the
> mechanics (motivated refusals, decision log, protected exit) but not a staffed review desk or an SLA monitor.

## 1. Response-time commitments

| Situation | Commitment (production) | Demo |
|---|---|---|
| Compliant payment (all rules pass, standard level) | Co-signed and submitted **in under 60 s** | Immediate (a few seconds incl. Sepolia inclusion) |
| Enhanced checks (≥ threshold, new recipient, dApp, contract recipient…) | Email OTP + cooling-off **24 h**, then human four-eyes review | Cooling-off 30 s, review in `/admin` |
| Human review (four-eyes, compliance) | Decision **within 24 h** (business days: within 1 business day) | Manual in `/admin` |
| Contest of a refusal | Acknowledged **within 24 h**, reasoned answer **within 5 business days** | Documented only |
| Service outage | Status page + "Emergency mode" in the app; no deadline can block the protected exit | Banner + Emergency mode page |

A request that is not decided within the commitment is escalated (compliance lead) and the client is told so; it is
**never** silently left pending.

## 2. Every refusal is motivated

When the co-signer refuses, the app shows (implemented: `apps/web/src/components/Refusal.tsx`, `TxFlow.tsx`):

1. **the precise reason** (e.g. "0x7f36…e1be is on a sanctions list (OFAC SDN)", "This would destroy the funds…");
2. **the rule** that applied (e.g. "Sanctions screening", "Daily limit (1000 USDC)", "Recognised tokens only");
3. **how to fix it** (lower the amount, pick the contact, wait for tomorrow's limit, contact the advisor…);
4. the guarantee: *"Your funds are never locked: you can always move them with your recovery key (protected exit, see Security)."*

Rules and their source: `services/sq-cosigner/src/policy.ts` (operation type, wallet configuration, sanctions,
unrecognised tokens, look-alike addresses, token contract, contract recipient, funds, approved dApps, amount threshold,
known recipient, daily limit, sponsored-fee quota), `validate.ts` (only understood operations are co-signed),
`travelRule.ts` (beneficiary information), plus the on-chain simulation.

## 3. Client-visible decision log

Security → **Co-signer decisions** lists every request received from the wallet with its decision (co-signed, refused by
the rules, refused after human review, cancelled, in progress), its date, its reference and the reason of a refusal.
It is built from the co-signer's stored transaction requests (`GET /clients/:id/tx-requests`, the client's own records
only). The same events are in the shared audit log seen by compliance (`/admin`).

Production: the log is append-only, retained for the legal retention period (10 years, Swiss CO art. 958f) and
exportable (PDF / CSV) for a dispute.

## 4. Contest procedure

1. The client opens the refused request in Security → Co-signer decisions and notes its reference.
2. The client contacts their advisor (in-app message or phone) with the reference and, if useful, documents
   (e.g. proof that a sanctions match is a homonym, invoice for a large payment).
3. A compliance officer **who did not take the first decision** reviews it (four-eyes) within the commitments above.
4. The answer is reasoned and logged. If the refusal is upheld, the reason and the legal basis are given when the law
   allows it (tipping-off rules may forbid detail in AML cases — the client is then told that the decision is final
   without further detail).
5. Escalation: Swissquote's complaints office, then the banking ombudsman.

## 5. Why a refusal can never lock the client in

- **Self-custody:** the client holds K1 (device) and K3 (recovery key, split 2-of-3). K1 + K3 is a valid 2-of-3
  signature without Swissquote ("protected exit", Security; script `npm run escape-hatch`).
- **Bounded block:** in the on-chain design (Phase B: Guard + Zodiac Delay module D1), an exit without Swissquote is
  queued on-chain and executes after **48 h** (demo 2 min). Swissquote can therefore *delay* an exit by at most 48 h,
  never prevent it.
- **Swissquote gone or unreachable:** the app's Emergency mode reads balances directly from the blockchain (public RPC)
  and guides the exit; long-term recovery with K3 alone goes through D2 (30 days).

## 6. Freeze

The client can freeze co-signing at any time (Security). Compliance can also freeze (e.g. suspected fraud or a legal
order — out of scope of this prototype). A freeze stops **co-signatures** only; it never changes the wallet's owners,
so the protected exit stays available.
