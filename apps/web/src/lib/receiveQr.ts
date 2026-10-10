// Pure helpers for the receive QR (unit-tested in apps/web/test/receiveQr.test.ts).
// #20 — Payload = EIP-681 URI `ethereum:<checksummed Safe address>@11155111` (address + chain id, nothing else):
// a wallet that understands EIP-681 pre-selects Ethereum Sepolia, so the funds cannot silently go to another network.
// Compatibility (see wallet/ReceiveQr.tsx): MetaMask / Rainbow / Trust and most EVM wallets read EIP-681 incl. the
// chain id; a scanner that only accepts a bare address can still use the address shown and copied below the code.

import { getAddress } from 'ethers';
import { CHAIN_ID, eip681Uri } from '@sq/shared';

export const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 4, width: 512, color: { dark: '#000000', light: '#ffffff' } };

/** Exactly what the QR encodes: ethereum:<checksummed address>@<chain id> (throws on anything that is not an address). */
export const qrPayload = (address: string, chainId: number = CHAIN_ID) => eip681Uri(getAddress(address), chainId);

/** The bare checksummed address (copy button, grouped display). */
export const qrAddress = (address: string) => getAddress(address);

/** "0x 1234 5678 9ABC …" groups of 4, for reading and comparing. */
export const groupAddress = (a: string) => `${a.slice(0, 2)} ${a.slice(2).match(/.{1,4}/g)!.join(' ')}`;
