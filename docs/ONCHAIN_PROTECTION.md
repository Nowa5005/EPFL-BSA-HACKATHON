# On-chain protection — MyWallGuard + Zodiac Delay modules

> ⚠️ **`contracts/MyWallGuard.sol` is NOT AUDITED.** It is prototype code for Ethereum **Sepolia** only. It is the
> only custom contract of the project; everything else is official code: Safe v1.4.1, Zodiac Delay Modifier v1.0.1,
> Zodiac ModuleProxyFactory v1.2.0, OpenZeppelin ECDSA 5.4.

## 1. Principle

Before this layer, every delay and every compliance rule was enforced **off-chain by K2** (Swissquote's co-signer).
Now one rule is written **in the contract** and holds even if Swissquote, the recovery partner or a thief holds two keys:

| Signature combination | On-chain effect |
|---|---|
| **K1 + K2** (device + Swissquote, normal use) | **Immediate.** K2 still applies its off-chain policy (limits, Travel Rule, sanctions, passkey). DELEGATECALL only to the official MultiSendCallOnly v1.4.1 |
| **Cancel a pending operation** (`setTxNonce` on a Delay module), by any 2 owners | **Immediate** — this is the **veto** |
| **Any other combination** (K2 + K3 recovery, K1 + K3 exit without Swissquote, any configuration change without K1 + K2) | **Refused directly.** Must be **queued in Delay module D1**, executable only after **48 h** (demo: 2 min), vetoable |
| **K3 alone** | Queued in **Delay module D2**, executable after **30 days** (demo: 4 min), vetoable |
| *(Phase C)* designated heir | Queued in **D3**, ~6 months (demo: 5 min), vetoable |

Consequences: an exit without Swissquote is **guaranteed** but with 48 h notice (#4, #5); the recovery delay is
on-chain (#6); two stolen keys or Swissquote + partner collusion get nothing immediate, and the real client is alerted and
can veto with K1 + any other key (#7, #8); device lost **and** Swissquote gone → K3 alone after 30 days (#13).

| Delay | Who queues | Cooldown (prod / demo) | Expiration (prod / demo) |
|---|---|---|---|
| D1 | the Safe itself (= any 2 owners through a Safe transaction) | 48 h / 120 s | 7 days / 7 days |
| D2 | K3's address | 30 days / 240 s | 30 days / 30 days |
| D3 (later, Phase C) | the heir's address | ~6 months / 300 s | 30 days / 30 days |

Demo values come from the co-signer env: `PROTECTION_D1_COOLDOWN_SEC`, `PROTECTION_D1_EXPIRATION_SEC`, `PROTECTION_D2_*`,
`PROTECTION_D3_*` (defaults in `packages/shared/src/protection.ts`, production values in `PROTECTION_PROD_DELAYS`).
They are fixed per wallet at activation time (stored in its own Delay modules).

## 2. How the guard decides (`checkTransaction`)

1. Loads the Safe's configuration (`k2`, `k3`, `d1`, `d2`, `d3`) — stored in the guard under the Safe's address,
   writable **only by the Safe itself** (`msg.sender`), i.e. by K1 + K2, or by D1 after its delay. An unconfigured Safe is refused (fail closed).
2. Recomputes the Safe transaction hash with the Safe's own `getTransactionHash(..., nonce() - 1)`
   (Safe v1.4.1 increments its nonce **before** calling the guard — checked in `Safe.sol` 1.4.1).
3. Identifies the **first `threshold` signers** exactly as Safe's `checkNSignatures` does: EIP-712 ECDSA (v = 27/28) and
   `eth_sign` (v > 30) via OpenZeppelin `ECDSA.tryRecover`; approved hashes (v = 1) re-checked
   (`msg.sender` or `approvedHashes`); contract signatures (v = 0) never count. A signer seen twice is refused.
4. **K1** = any current owner that is neither K2 nor K3 → survives a device recovery (`swapOwner` of K1) without reconfiguration.
5. K1 + K2 → allowed (DELEGATECALL only to MultiSendCallOnly). Otherwise only: a CALL with no ETH and no gas refund to
   `D1.execTransactionFromModule` (queue) or to `setTxNonce` on D1/D2/D3 (veto). Everything else reverts with an explicit
   `MyWallGuard: …` message.

Queued transactions are executed by anyone with `Dx.executeNextTx(...)` once the cooldown has elapsed; the Delay module
then calls `Safe.execTransactionFromModule`, which Safe v1.4.1 does **not** pass through the guard — that is the intended
slow path. Admin changes (remove the guard, change a cooldown, add/remove a module or an owner…) therefore need K1 + K2,
or 48 h in D1 with a veto window.

## 3. Wallet setup (one K1 + K2 batch)

`planProtectionSetup()` (shared, browser-safe) builds one `MultiSendCallOnly` batch executed by the Safe:
deploy D1 and D2 (ModuleProxyFactory, deterministic salt per Safe; skipped if a third party already deployed the identical
proxy) → `D1.enableModule(Safe)`, `D2.enableModule(K3)` → `Safe.enableModule(D1)`, `Safe.enableModule(D2)` →
`guard.setConfig(K2, K3, D1, D2, 0)` → `Safe.setGuard(guard)`. The Safe's initializer is unchanged (same address on any chain).

- **New wallets**: right after deployment, onboarding signs the batch with the brand-new K1 (no extra Touch ID: the batch only
  adds protection and the co-signer accepts it without passkey only within 15 min of deployment); progress line
  "Activating on-chain protection".
- **Existing wallets**: banner **Upgrade wallet security** (Home) and card in **Security** → unlock + passkey + K1 + K2.
- The co-signer rebuilds the batch itself and accepts **only** that exact batch (`validateProtectionBatch`); the everyday
  route still refuses any call to the Safe, the guard or a Delay module.
- Gas: ~3.3 M gas on Sepolia today (two proxies + storage); sponsoring cap `PROTECTION_SETUP_MAX_GAS` (8 M).

## 4. Emergency gas reserve (#21)

At activation the relayer deposits **0.002 ETH** (demo, `PROTECTION_GAS_RESERVE_ETH`) on **K3's address**, not in the Safe:
- without K2, a Safe transaction cannot pay its own gas safely: the guard forbids gas refunds for any pair other than K1 + K2
  (a refund would let two stolen keys drain the wallet through `gasPrice`/`refundReceiver`);
- every path without Swissquote uses K3: K1 + K3 exit (K3 submits), K3 alone in D2, `executeNextTx`;
- Swissquote never holds K3, so it **cannot** spend the reserve; it only exists once K3 is rebuilt (recovery / emergency).
- After a recovery-kit rotation (K3 → K3′) the reserve is deposited again on K3′; the old one stays on the retired address.

## 5. Flows (co-signer endpoints, all under the client's session)

| Endpoint | Purpose |
|---|---|
| `GET /clients/:id/protection` | guard, modules, config, D1/D2 queues (pending items with `executableAt`, decoded calls), reserve |
| `POST /clients/:id/protection/setup/prepare` · `/setup/submit` | activation / Upgrade wallet security (K1 + K2) |
| `POST /clients/:id/protection/veto/prepare` · `/veto/submit` | veto (`setTxNonce`, K1 + K2 + passkey), `module: D1|D2|D3`, optional `upTo` |
| `POST /clients/:id/protection/execute` | relayer executes the next ready queued operation (anyone could) |
| `GET /admin/protection/pending` | compliance console: pending operations of every protected wallet |
| `POST /recovery/request` (protected wallet) | "I lost my device": `swapOwner` queued in D1 (K3 + K2) — the countdown is the on-chain one; executed by the relayer (`executeNextTx`) after both the on-chain cooldown and the server delay |

Browser helpers: `apps/web/src/lib/protection.ts` (`getProtection`, `activateProtection`, `vetoPending`),
`ProtectionCard` / `UpgradeSecurityBanner`. Shared builders: `queueInD1SafeTx`, `vetoSafeTx`, `recoveryQueueSafeTx`,
`queueDirect` (K3 → D2), `executeNext`, `readDelayQueue`, `readProtection`, `planHeirModule` (D3).

Indexer (`services/sq-cosigner/src/indexer.ts` hooks): Delay `TransactionAdded(uint256 indexed queueNonce, bytes32 indexed txHash, address to, uint256 value, bytes data, uint8 operation)`
→ alert to the client (email + app: "A protected operation is pending on your wallet") + activity "compliance review";
Safe `ExecutionFromModuleSuccess(address indexed module)` → "executed without co-signature — compliance review".

**Off-chain cancel vs veto.** Cancelling a queued recovery from the inbox stops Swissquote from executing it, but
`executeNextTx` is permissionless: the binding cancel is the on-chain **veto** (K1 + K2). `npm run escape-hatch` queues
through D1 on a protected wallet and waits (or `--execute` later).

## 6. Addresses (Sepolia)

| Contract | Address |
|---|---|
| MyWallGuard (singleton for all Safes) | [`0xDb2eD8936CdE1844602dd5791E7E091aaE2dEc5e`](https://sepolia.etherscan.io/address/0xDb2eD8936CdE1844602dd5791E7E091aaE2dEc5e) — deploy tx [`0xe7a2f66b…`](https://sepolia.etherscan.io/tx/0xe7a2f66b5d56823ca449af78480dd4e4240fe20b186f5f9493a40f86b8deb4ff), source verified on [Sourcify](https://repo.sourcify.dev/11155111/0xDb2eD8936CdE1844602dd5791E7E091aaE2dEc5e) (exact match) |
| Zodiac Delay v1.0.1 mastercopy | `0xd54895B1121A2eE3f37b502F507631FA1331BED6` |
| Zodiac ModuleProxyFactory v1.2.0 | `0x000000000000aDdB49795b0f9bA5BC298cDda236` |
| Safe MultiSendCallOnly v1.4.1 | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |

Zodiac addresses from `@gnosis-guild/zodiac` 5.0.1 `CanonicalAddresses`; Delay **v1.0.1** chosen over 1.1.x because it
has no signature-based module authorisation path (smaller surface; 1.1.0 is flagged faulty upstream).
`npm run deploy:guard` checks the codehash of every official contract on Sepolia against `contracts/test/fixtures/official-code.json`
(the Safe ones equal `@safe-global/safe-deployments` codehashes) before deploying, and checks the deployed runtime code
against `contracts/artifacts/MyWallGuard.json`.

## 7. Verifying on Etherscan

1. Open the wallet (Safe) → *Read as Proxy*: `getModulesPaginated(0x…01, 10)` lists D1 and D2;
   `getStorageAt(0x4a204f62…c34c8, 1)` (guard slot) returns MyWallGuard.
2. MyWallGuard → `configOf(<Safe>)` → K2, K3, D1, D2.
3. D1 → `txCooldown`, `txExpiration`, `txNonce`, `queueNonce`, `txCreatedAt(i)`; events `TransactionAdded`.
4. A refused attempt shows a failed transaction with the `MyWallGuard: …` revert reason.

## 8. Tests

- `npm run test:contracts` (also part of `npm test`, ~2 s): Hardhat in-process network with the **exact Sepolia bytecode**
  of the official contracts installed at their canonical addresses (`hardhat_setCode`), the guard from the committed artifact
  (checked against a fresh `solc` 0.8.30 compile). 24 tests: every row of the table above (K1 + K2 immediate incl. eth_sign
  and approved-hash forms; K2 + K3 and K1 + K3 refused; 12 configuration changes refused for both pairs; D1 queue + time
  travel + execution; veto by two different pairs; K1 + K3 exit; K3 alone via D2; expiry), bypass attempts (removing the
  guard, changing the cooldown, DELEGATECALL, gas refund, ETH on the queue call, duplicate signatures, extra signatures,
  configuration by a non-Safe, unconfigured Safe), front-run proxy deployment.
- `services/sq-cosigner/test/protection.test.ts`: the co-signer accepts exactly the canonical batch / veto / recovery queue.
- `npm run e2e` → `scripts/e2e-protection.ts` on Sepolia (see README "Proof on Sepolia").

## 9. Limits (honest list)

- Not audited; a formal review of the guard and of the Safe/Zodiac interaction is required before mainnet.
- Delay queues are FIFO: a queued operation that fails blocks the queue until vetoed (`setTxNonce`) or expired (`skipExpired`).
- A veto needs 2 owners: an attacker holding K2 + K3 could also veto the client's own protected exit (blocking, never stealing);
  K3 needs two of the client's three parts, so Swissquote + partner alone cannot do it.
- After the D1 delay any 2 owners can do anything (including removing the guard) — by design, with notice and veto.
- The setup costs ~3.3 M gas on Sepolia; on mainnet an ERC-4337 paymaster / batched deployment would be needed.
- If the wallet is frozen (K2 withheld), the veto must be signed K1 + K3 instead (Emergency mode, next UI wave).
