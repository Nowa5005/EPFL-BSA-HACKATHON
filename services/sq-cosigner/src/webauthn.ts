// Passkeys (WebAuthn) with @simplewebauthn/server. Device binding + per-transaction user verification.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { getBytes } from 'ethers';
import { POLICY } from '@sq/shared';
import { db, getClient, HttpError, type Client, type Device } from './db';

export const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
export const ORIGINS = (process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const RP_NAME = 'SQ Wallet (prototype)';
export const HEADLESS_ALLOWED = (process.env.ALLOW_HEADLESS_CLIENTS ?? 'true') === 'true';

const key = (clientId: string, purpose: string) => `${clientId}:${purpose}`;

export async function registrationOptions(c: Client, deviceType: 'mobile' | 'desktop', recovery: boolean) {
  const active = c.devices.filter((d) => d.status === 'active');
  if (!recovery) {
    if (active.length >= POLICY.maxDevicesPerClient)
      throw new HttpError(409, `Device limit reached: max ${POLICY.maxDevicesPerClient} devices (1 mobile + 1 computer). Use "change device" or recovery.`);
    if (active.some((d) => d.deviceType === deviceType))
      throw new HttpError(409, `A ${deviceType} is already registered. Only 1 mobile + 1 computer are allowed.`);
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: c.email,
    userDisplayName: c.name,
    userID: new TextEncoder().encode(c.clientId),
    attestationType: 'none',
    excludeCredentials: c.devices.filter((d) => d.status !== 'revoked').map((d) => ({ id: d.credentialId, transports: d.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required', authenticatorAttachment: 'platform' },
    preferredAuthenticatorType: 'localDevice',
  });
  db.update((d) => {
    d.challenges[key(c.clientId, 'register')] = { challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), purpose: 'register' };
  });
  return options;
}

export async function verifyRegistration(c: Client, response: RegistrationResponseJSON, deviceType: 'mobile' | 'desktop', label: string, recovery: boolean): Promise<Device> {
  const ch = db.data.challenges[key(c.clientId, 'register')];
  if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(400, 'Registration challenge expired');
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new HttpError(400, 'Passkey registration could not be verified');
  const cred = v.registrationInfo.credential;
  const device: Device = {
    credentialId: cred.id,
    publicKey: isoBase64URL.fromBuffer(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ?? response.response.transports,
    deviceType,
    label,
    status: recovery ? 'pending-recovery' : 'active',
    createdAt: new Date().toISOString(),
  };
  db.update((d) => {
    d.clients[c.clientId].devices.push(device);
    delete d.challenges[key(c.clientId, 'register')];
  });
  return device;
}

/** Authentication options whose challenge is the Safe tx hash → the biometric check is bound to THIS transaction. */
export async function authOptionsForHash(c: Client, hash: string) {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    challenge: new Uint8Array(getBytes(hash)),
    userVerification: 'required',
    allowCredentials: c.devices.filter((d) => d.status === 'active').map((d) => ({ id: d.credentialId, transports: d.transports })),
  });
}

/** Generic action challenge (settings changes, contacts…). */
export async function authOptionsForAction(c: Client, purpose: string) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: c.devices.filter((d) => d.status === 'active').map((d) => ({ id: d.credentialId, transports: d.transports })),
  });
  db.update((d) => {
    d.challenges[key(c.clientId, purpose)] = { challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), purpose };
  });
  return options;
}

export async function verifyAssertion(
  clientId: string,
  response: AuthenticationResponseJSON | undefined,
  expected: { hash: string } | { purpose: string },
): Promise<{ device: Device | null; headless: boolean }> {
  const c = getClient(clientId);
  if (!response) {
    if (c.headless && HEADLESS_ALLOWED) return { device: null, headless: true };
    throw new HttpError(401, 'Biometric confirmation (passkey) is required');
  }
  const device = c.devices.find((d) => d.credentialId === response.id && d.status === 'active');
  if (!device) throw new HttpError(401, 'This device is not (or no longer) authorised for this wallet');
  let expectedChallenge: string;
  if ('hash' in expected) expectedChallenge = isoBase64URL.fromBuffer(new Uint8Array(getBytes(expected.hash)));
  else {
    const ch = db.data.challenges[key(clientId, expected.purpose)];
    if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(401, 'Confirmation expired, please try again');
    expectedChallenge = ch.challenge;
  }
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    credential: { id: device.credentialId, publicKey: isoBase64URL.toBuffer(device.publicKey), counter: device.counter, transports: device.transports },
    requireUserVerification: true,
  });
  if (!v.verified) throw new HttpError(401, 'Biometric confirmation failed');
  db.update((d) => {
    const dev = d.clients[clientId].devices.find((x) => x.credentialId === device.credentialId)!;
    dev.counter = v.authenticationInfo.newCounter;
    if ('purpose' in expected) delete d.challenges[key(clientId, expected.purpose)];
  });
  return { device, headless: false };
}
