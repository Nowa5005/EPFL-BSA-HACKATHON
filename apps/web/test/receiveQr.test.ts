import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { parseEip681 } from '@sq/shared';
import { groupAddress, QR_OPTIONS, qrAddress, qrPayload } from '../src/lib/receiveQr';

const SAFE = '0x993f4eeb9b6529aec723de2453362e565274881e';

test('#20 the receive QR decodes to the EIP-681 URI ethereum:<checksummed address>@11155111, nothing else', async () => {
  const payload = qrPayload(SAFE);
  assert.equal(payload, 'ethereum:0x993F4EeB9B6529aEc723dE2453362e565274881E@11155111');
  const png = PNG.sync.read(await QRCode.toBuffer(payload, { ...QR_OPTIONS, type: 'png' }));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded, 'QR must decode');
  assert.equal(decoded!.data, payload); // no amount, no function call, no secret
  assert.doesNotMatch(decoded!.data, /[?/]/);
  assert.deepEqual(parseEip681(decoded!.data), { address: '0x993F4EeB9B6529aEc723dE2453362e565274881E', chainId: 11155111 });
});

test('payload rejects anything that is not an address', () => {
  assert.throws(() => qrPayload('0x1234'));
  assert.throws(() => qrPayload('ethereum:0x993f4eeb9b6529aec723de2453362e565274881e'));
});

test('grouped address is readable and lossless', () => {
  const g = groupAddress(qrAddress(SAFE));
  assert.equal(g.replace(/ /g, ''), qrAddress(SAFE));
  assert.match(g, /^0x [0-9A-Fa-f]{4} /);
});
