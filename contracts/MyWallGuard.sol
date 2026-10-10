// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  MyWallGuard — Safe v1.4.1 transaction guard for My Wall (Swissquote Wallet Challenge prototype).
//
//  ⚠️  NOT AUDITED. Prototype code for Ethereum Sepolia only. Do not use with real funds before an
//      independent security audit. It is the ONLY custom contract of the project; everything else is
//      official, audited code (Safe v1.4.1, Zodiac Delay Modifier v1.0.1, OpenZeppelin ECDSA).
//
//  Rule enforced on-chain (docs/ONCHAIN_PROTECTION.md):
//    • device key K1 + Swissquote co-signer K2      → executed immediately (DELEGATECALL only to the
//                                                     official MultiSendCallOnly v1.4.1)
//    • any other combination of 2 owners            → may only
//         – queue a transaction in the Delay module D1 (D1.execTransactionFromModule), or
//         – veto pending transactions of D1/D2/D3   (Dx.setTxNonce)
//      everything else reverts. Queued transactions run after D1's cooldown (48 h in production),
//      through Safe.execTransactionFromModule — Safe v1.4.1 does not call the guard for module
//      transactions, which is exactly the intended "slow path".
//
//  K1 is read dynamically: any current owner of the Safe that is neither K2 nor K3 (survives device
//  recovery, i.e. swapOwner of K1). K2, K3 and the Delay modules are stored per Safe in this contract and
//  can only be changed by the Safe itself (so: K1 + K2 directly, or via D1 after the delay).
//  One deployed guard serves every My Wall Safe (configuration keyed by Safe address).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// Safe v1.4.1 `Enum.Operation` (ABI-encoded as uint8).
enum Operation {
    Call,
    DelegateCall
}

/// ERC-165, as in Safe v1.4.1 `interfaces/IERC165.sol`.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// Safe v1.4.1 `Guard` interface (base/GuardManager.sol). Interface id 0xe6d7a83a.
interface IGuard is IERC165 {
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external;

    function checkAfterExecution(bytes32 txHash, bool success) external;
}

/// The few Safe v1.4.1 views the guard needs.
interface ISafeView {
    function nonce() external view returns (uint256);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function approvedHashes(address owner, bytes32 hash) external view returns (uint256);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
}

contract MyWallGuard is IGuard {
    struct Config {
        address k2; // Swissquote co-signer
        address k3; // recovery key
        address d1; // Delay module: any 2 owners queue here (48 h prod)
        address d2; // Delay module: K3 alone queues here (30 days prod); optional (0)
        address d3; // Delay module for heirs (6 months prod); optional (0)
    }

    /// Zodiac Delay `execTransactionFromModule(address,uint256,bytes,uint8)` — queue a transaction.
    bytes4 public constant QUEUE_SELECTOR = bytes4(keccak256("execTransactionFromModule(address,uint256,bytes,uint8)"));
    /// Zodiac Delay `setTxNonce(uint256)` — skip (veto) pending transactions.
    bytes4 public constant VETO_SELECTOR = bytes4(keccak256("setTxNonce(uint256)"));

    /// Official Safe v1.4.1 MultiSendCallOnly (only target allowed for DELEGATECALL).
    address public immutable multiSendCallOnly;

    mapping(address safe => Config) private configs;

    event ConfigSet(address indexed safe, address k2, address k3, address d1, address d2, address d3);

    constructor(address _multiSendCallOnly) {
        require(_multiSendCallOnly != address(0), "MyWallGuard: MultiSendCallOnly required");
        multiSendCallOnly = _multiSendCallOnly;
    }

    // ───────────────────────────── configuration (only the Safe itself) ─────────────────────────────

    /// Called by the Safe (msg.sender) — i.e. with K1 + K2, or through D1 after its delay.
    function setConfig(address k2, address k3, address d1, address d2, address d3) external {
        require(k2 != address(0) && k3 != address(0) && d1 != address(0), "MyWallGuard: K2, K3 and D1 are required");
        require(k2 != k3, "MyWallGuard: K2 and K3 must differ");
        configs[msg.sender] = Config(k2, k3, d1, d2, d3);
        emit ConfigSet(msg.sender, k2, k3, d1, d2, d3);
    }

    function configOf(address safe) external view returns (Config memory) {
        return configs[safe];
    }

    // ───────────────────────────── Safe v1.4.1 Guard ─────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IGuard).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// Called by the Safe inside execTransaction, AFTER the Safe verified the signatures and incremented its nonce.
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external view override {
        Config memory c = configs[msg.sender];
        require(c.k2 != address(0), "MyWallGuard: Safe not configured");
        ISafeView safe = ISafeView(msg.sender);

        // Safe v1.4.1 increments its nonce BEFORE calling the guard: this transaction used nonce() - 1.
        bytes32 txHash = safe.getTransactionHash(
            to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, safe.nonce() - 1
        );
        (bool hasK1, bool hasK2) = _signedBy(safe, c, txHash, signatures, msgSender);

        if (hasK1 && hasK2) {
            // Normal use: immediate. DELEGATECALL is never allowed, except the official batch contract (CALLs only).
            require(
                operation == Operation.Call || to == multiSendCallOnly,
                "MyWallGuard: DELEGATECALL is only allowed to MultiSendCallOnly"
            );
            return;
        }

        // Any other combination: queue in D1 or veto — nothing else, no ETH, no gas refund paid by the wallet.
        require(operation == Operation.Call, "MyWallGuard: without K1+K2, DELEGATECALL is refused");
        require(value == 0, "MyWallGuard: without K1+K2, no ETH can be sent directly");
        require(gasPrice == 0, "MyWallGuard: without K1+K2, no gas refund");
        require(data.length >= 4, "MyWallGuard: without K1+K2, only queueing in D1 or a veto is allowed");
        bytes4 selector = bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
        if (selector == QUEUE_SELECTOR && to == c.d1) return;
        if (
            selector == VETO_SELECTOR &&
            (to == c.d1 || (c.d2 != address(0) && to == c.d2) || (c.d3 != address(0) && to == c.d3))
        ) return;
        revert("MyWallGuard: without K1+K2, only queueing in D1 or a veto is allowed");
    }

    function checkAfterExecution(bytes32, bool) external pure override {}

    // ───────────────────────────── signer identification ─────────────────────────────

    /// Identifies the first `threshold` signers exactly like Safe v1.4.1 checkNSignatures (the Safe has already
    /// verified them). EOA signatures (v = 27/28) and eth_sign (v > 30) are recovered with OpenZeppelin ECDSA;
    /// approved hashes (v = 1) are re-checked; contract signatures (v = 0) never count as K1 or K2
    /// (all My Wall keys are EOAs). A signer counted twice is refused.
    function _signedBy(ISafeView safe, Config memory c, bytes32 txHash, bytes memory signatures, address msgSender)
        internal
        view
        returns (bool hasK1, bool hasK2)
    {
        uint256 n = safe.getThreshold();
        require(signatures.length >= n * 65, "MyWallGuard: signatures too short");
        address[] memory seen = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            (uint8 v, bytes32 r, bytes32 s) = _split(signatures, i);
            address signer;
            if (v == 0) {
                continue; // contract signature: never K1/K2
            } else if (v == 1) {
                signer = address(uint160(uint256(r)));
                if (msgSender != signer && safe.approvedHashes(signer, txHash) == 0) continue;
            } else if (v > 30) {
                (signer,,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(txHash), v - 4, r, s);
            } else {
                (signer,,) = ECDSA.tryRecover(txHash, v, r, s);
            }
            if (signer == address(0)) continue;
            for (uint256 j = 0; j < i; j++) require(seen[j] != signer, "MyWallGuard: duplicate signature");
            seen[i] = signer;
            if (!safe.isOwner(signer)) continue;
            if (signer == c.k2) hasK2 = true;
            else if (signer != c.k3) hasK1 = true; // K1 = any current owner that is neither K2 nor K3
        }
    }

    /// Same layout as Safe v1.4.1 SignatureDecoder.signatureSplit: {bytes32 r}{bytes32 s}{uint8 v}.
    function _split(bytes memory signatures, uint256 pos) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        assembly ("memory-safe") {
            let signaturePos := mul(0x41, pos)
            r := mload(add(signatures, add(signaturePos, 0x20)))
            s := mload(add(signatures, add(signaturePos, 0x40)))
            v := and(mload(add(signatures, add(signaturePos, 0x41))), 0xff)
        }
    }
}
