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
import { t } from '@sq/shared/server';
import { db, getClient, HttpError, type Client, type Device } from './db';

export const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
export const ORIGINS = (process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const RP_NAME = 'My Wall (prototype)';
export const HEADLESS_ALLOWED = (process.env.ALLOW_HEADLESS_CLIENTS ?? 'true') === 'true';

const key = (clientId: string, purpose: string) => `${clientId}:${purpose}`;

export async function registrationOptions(client: Client, deviceType: 'mobile' | 'desktop', recovery: boolean) {
  let c = client;
  // Onboarding restarted before the wallet existed: forget the unfinished device binding.
  if (!recovery && !c.safeAddress && c.devices.length) {
    db.update((d) => (d.clients[c.clientId].devices = []));
    c = getClient(c.clientId);
  }
  const active = c.devices.filter((d) => d.status === 'active');
  if (!recovery) {
    if (active.length >= POLICY.maxDevicesPerClient)
      throw new HttpError(
        409,
        t(
          `Limit reached: ${POLICY.maxDevicesPerClient} devices maximum (1 mobile + 1 computer). Use “change device” or recovery.`,
          `Limite atteinte : ${POLICY.maxDevicesPerClient} appareils maximum (1 mobile + 1 ordinateur). Utilisez « changer d'appareil » ou la récupération.`,
        ),
      );
    if (active.some((d) => d.deviceType === deviceType))
      throw new HttpError(
        409,
        t(
          `A ${deviceType === 'mobile' ? 'mobile' : 'computer'} is already registered. Only 1 mobile + 1 computer are allowed.`,
          `Un ${deviceType === 'mobile' ? 'mobile' : 'ordinateur'} est déjà enregistré. Seuls 1 mobile + 1 ordinateur sont autorisés.`,
        ),
      );
  }
  // #11 — hardware binding of the device key: the device adds the WebAuthn PRF extension to these options itself
  // (apps/web/src/lib/device.ts registerPasskey, `prf.eval.first` = per-wallet salt kept on the device). The PRF output
  // is a secret that must never reach this server: the device strips the extension results before /register/verify.
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: c.email,
    userDisplayName: c.name,
    userID: new TextEncoder().encode(c.clientId),
    attestationType: 'none',
    // In recovery the old device is presumed lost: don't exclude its credential (same platform authenticator in the demo).
    excludeCredentials: recovery ? [] : c.devices.filter((d) => d.status !== 'revoked').map((d) => ({ id: d.credentialId, transports: d.transports })),
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
  if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(400, t('The passkey request has expired, please try again.', 'La demande de passkey a expiré, réessayez.'));
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new HttpError(400, t('The passkey could not be verified.', "La passkey n'a pas pu être vérifiée."));
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
    throw new HttpError(401, t('Biometric confirmation (passkey) required.', 'Confirmation biométrique (passkey) requise.'));
  }
  const device = c.devices.find((d) => d.credentialId === response.id && d.status === 'active');
  if (!device) throw new HttpError(401, t('This device is not (or no longer) authorised for this wallet.', "Cet appareil n'est pas (ou plus) autorisé pour ce wallet."));
  let expectedChallenge: string;
  if ('hash' in expected) expectedChallenge = isoBase64URL.fromBuffer(new Uint8Array(getBytes(expected.hash)));
  else {
    const ch = db.data.challenges[key(clientId, expected.purpose)];
    if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(401, t('Confirmation expired, please try again.', 'Confirmation expirée, réessayez.'));
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
  if (!v.verified) throw new HttpError(401, t('Biometric confirmation failed.', 'La confirmation biométrique a échoué.'));
  db.update((d) => {
    const dev = d.clients[clientId].devices.find((x) => x.credentialId === device.credentialId)!;
    dev.counter = v.authenticationInfo.newCounter;
    if ('purpose' in expected) delete d.challenges[key(clientId, expected.purpose)];
  });
  return { device, headless: false };
}
