// Pure helpers for the receive QR (unit-tested in apps/web/test/receiveQr.test.ts).
// Payload = the plain EIP-55 checksummed Safe address, nothing else (see wallet/ReceiveQr.tsx for why no EIP-681).

import { getAddress } from 'ethers';

export const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 4, width: 512, color: { dark: '#000000', light: '#ffffff' } };

/** Exactly what the QR encodes: the checksummed address (throws on anything that is not an address). */
export const qrPayload = (address: string) => getAddress(address);

/** "0x 1234 5678 9ABC …" groups of 4, for reading and comparing. */
export const groupAddress = (a: string) => `${a.slice(0, 2)} ${a.slice(2).match(/.{1,4}/g)!.join(' ')}`;
