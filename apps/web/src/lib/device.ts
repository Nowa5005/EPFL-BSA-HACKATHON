// Everything that lives ON THIS DEVICE: the encrypted device key K1 (ethers keystore / scrypt),
// the passkey credential id, and the Swissquote session. K1 is only decrypted in memory.

import { Wallet, encryptKeystoreJson, type HDNodeWallet } from 'ethers';
import { openWithPassword, type PasswordSealed } from '@sq/shared';
import { startAuthentication, startRegistration } from './passkeyGuard'; // guarded for the native app
import { cosigner } from './api';
import { tr } from './i18n';
import { decoyActive, decoyDevice, decoyKey, decoySession, duressProof, endDecoy, isDecoyCode } from './decoy';

export interface DeviceRecord {
  clientId: string;
  safeAddress?: string;
  deviceAddress: string;
  keystore: string; // encrypted K1
  credentialId?: string;
  deviceType: 'mobile' | 'desktop';
  createdAt: string;
  /** Recovery code (share ①) kept on this device ENCRYPTED with the wallet password, so it can be shown again
   *  after re-authentication. Trade-off documented in THREAT_MODEL.md; the client can delete it. */
  paperShareEnc?: PasswordSealed;
}

export interface BankSession {
  token: string;
  clientId: string;
  profile: any;
}

const DEVICE_KEY = 'mw:device';
const SESSION_KEY = 'mw:session';
const FAILS_KEY = 'mw:unlock-fails';
export const MAX_UNLOCK_ATTEMPTS = 5;
export const UNLOCK_LOCKOUT_SEC = 30;

const safeGet = (k: string, s: Storage = localStorage) => {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string | null, s: Storage = localStorage) => {
  try {
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

// #16 — while a duress-code session is open (lib/decoy.ts) the app sees a fictitious device and profile, and nothing
// it does can change the real records stored on this device.
export const getDevice = (): DeviceRecord | null => (decoyActive() ? decoyDevice() : JSON.parse(safeGet(DEVICE_KEY) ?? 'null'));
export const saveDevice = (d: DeviceRecord | null) => {
  if (decoyActive()) return emit();
  safeSet(DEVICE_KEY, d ? JSON.stringify(d) : null);
  emit();
};

export const getSession = (): BankSession | null => (decoyActive() ? decoySession() : JSON.parse(safeGet(SESSION_KEY) ?? 'null'));
export const saveSession = (s: BankSession | null) => {
  if (decoyActive()) {
    if (s !== null) return emit();
    endDecoy(); // signing out ends the session for real
  }
  safeSet(SESSION_KEY, s ? JSON.stringify(s) : null);
  emit();
};

/** Back-office (compliance console) session — kept apart from the client session. DEMO user "compliance". */
export interface ComplianceSession {
  token: string;
  name: string;
}
const COMPLIANCE_KEY = 'mw:compliance-session';
export const getComplianceSession = (): ComplianceSession | null => JSON.parse(safeGet(COMPLIANCE_KEY) ?? 'null');
export const saveComplianceSession = (s: ComplianceSession | null) => {
  safeSet(COMPLIANCE_KEY, s ? JSON.stringify(s) : null);
  emit();
};

// ── in-memory unlocked device key ──
let unlocked: Wallet | HDNodeWallet | null = null;
export const isUnlocked = () => !!unlocked;
export const lock = () => {
  unlocked = null;
  endDecoy();
  emit();
};
export function unlockedKey() {
  if (!unlocked) throw new Error('Wallet locked');
  return unlocked;
}
export function setUnlocked(w: Wallet | HDNodeWallet) {
  unlocked = w;
  emit();
}

// ── unlock attempts (demo: 5 attempts, then 30 s wait) ──
export function unlockState(): { fails: number; lockedUntil: number } {
  try {
    return JSON.parse(localStorage.getItem(FAILS_KEY) ?? '') ?? { fails: 0, lockedUntil: 0 };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}
const setUnlockState = (s: { fails: number; lockedUntil: number }) => safeSet(FAILS_KEY, JSON.stringify(s));

/** No wallet saved on this device (distinct from a wrong password). */
export class NoWalletError extends Error {
  constructor() {
    super(tr('No wallet on this device', 'Aucun wallet sur cet appareil'));
  }
}

export class UnlockError extends Error {
  constructor(
    message: string,
    public remaining: number,
    public lockedUntil = 0,
  ) {
    super(message);
  }
}

/** Decrypts the device key with the password (never sent anywhere). */
export async function decryptDeviceKey(password: string, onProgress?: (p: number) => void) {
  if (decoyActive()) {
    // Same code again → same (fictitious) session; anything else is refused after comparable work.
    await duressProof(decoyDevice()!.clientId, password);
    onProgress?.(1);
    if (isDecoyCode(password)) return decoyKey()!;
    throw new Error('invalid password');
  }
  const d = getDevice();
  if (!d) throw new NoWalletError();
  return Wallet.fromEncryptedJson(d.keystore, password, onProgress);
}

/** Checks the password (with attempt limiting). With `commit: false` the key is returned but the session
 *  stays locked — the caller commits with setUnlocked() once the passkey has also been verified. */
export async function unlock(password: string, onProgress?: (p: number) => void, opts: { commit?: boolean } = {}) {
  const st = unlockState();
  if (st.lockedUntil > Date.now()) throw new UnlockError(tr('Too many attempts. Please wait before trying again.', 'Trop de tentatives. Patientez avant de réessayer.'), 0, st.lockedUntil);
  let key: Wallet | HDNodeWallet;
  try {
    key = await decryptDeviceKey(password, onProgress);
  } catch (e) {
    if (e instanceof NoWalletError) throw e;
    const fails = st.fails + 1;
    if (fails >= MAX_UNLOCK_ATTEMPTS) {
      const lockedUntil = Date.now() + UNLOCK_LOCKOUT_SEC * 1000;
      setUnlockState({ fails: 0, lockedUntil });
      throw new UnlockError(
        tr(`Incorrect password. Too many attempts: please wait ${UNLOCK_LOCKOUT_SEC} seconds.`, `Mot de passe incorrect. Trop de tentatives : patientez ${UNLOCK_LOCKOUT_SEC} secondes.`),
        0,
        lockedUntil,
      );
    }
    setUnlockState({ fails, lockedUntil: 0 });
    const remaining = MAX_UNLOCK_ATTEMPTS - fails;
    throw new UnlockError(
      tr(
        `Incorrect password. ${remaining} attempt${remaining > 1 ? 's' : ''} left.`,
        `Mot de passe incorrect. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`,
      ),
      remaining,
    );
  }
  setUnlockState({ fails: 0, lockedUntil: 0 });
  if (opts.commit !== false) {
    unlocked = key;
    emit();
  }
  return key;
}

/**
 * #16 — Unlock with the duress check. The device key is decrypted with what was typed; in EVERY case the device
 * derives the duress proof of the typed text and asks the server (`check`) — with a random value when the password
 * was right — so the work, the requests and the latency are the same whichever code was typed. A wrong password
 * that is the duress code returns { decoy: true } (no real key: a throwaway one) and counts as a success.
 */
export async function unlockWithDuressCheck(password: string, clientId: string, check: (proof: string) => Promise<boolean>, onProgress?: (p: number) => void): Promise<{ key: Wallet | HDNodeWallet; decoy: boolean }> {
  const st = unlockState();
  if (st.lockedUntil > Date.now()) throw new UnlockError(tr('Too many attempts. Please wait before trying again.', 'Trop de tentatives. Patientez avant de réessayer.'), 0, st.lockedUntil);
  let key: Wallet | HDNodeWallet | null = null;
  try {
    key = await decryptDeviceKey(password, onProgress);
  } catch (e) {
    if (e instanceof NoWalletError) throw e;
  }
  const proof = await duressProof(clientId, password);
  const random = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const isDuress = await check(key ? random : proof).catch(() => false);
  if (key) {
    setUnlockState({ fails: 0, lockedUntil: 0 });
    return { key, decoy: false };
  }
  if (isDuress) {
    setUnlockState({ fails: 0, lockedUntil: 0 });
    return { key: Wallet.createRandom(), decoy: true };
  }
  const fails = st.fails + 1;
  if (fails >= MAX_UNLOCK_ATTEMPTS) {
    const lockedUntil = Date.now() + UNLOCK_LOCKOUT_SEC * 1000;
    setUnlockState({ fails: 0, lockedUntil });
    throw new UnlockError(tr(`Incorrect password. Too many attempts: please wait ${UNLOCK_LOCKOUT_SEC} seconds.`, `Mot de passe incorrect. Trop de tentatives : patientez ${UNLOCK_LOCKOUT_SEC} secondes.`), 0, lockedUntil);
  }
  setUnlockState({ fails, lockedUntil: 0 });
  const remaining = MAX_UNLOCK_ATTEMPTS - fails;
  throw new UnlockError(tr(`Incorrect password. ${remaining} attempt${remaining > 1 ? 's' : ''} left.`, `Mot de passe incorrect. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`), remaining);
}

/** Re-authentication before showing a secret: wallet password + passkey. Returns the decrypted key. */
export async function reauthenticate(password: string, clientId: string, onProgress?: (p: number) => void) {
  let w: Wallet | HDNodeWallet;
  try {
    w = await decryptDeviceKey(password, onProgress);
  } catch {
    throw new Error(tr('Incorrect password.', 'Mot de passe incorrect.'));
  }
  const { cosigner } = await import('./api');
  const options = await cosigner.post('/webauthn/auth/options', { clientId, purpose: 'reveal-secret' });
  const response = await startAuthentication({ optionsJSON: options });
  await cosigner.post('/webauthn/auth/verify', { clientId, purpose: 'reveal-secret', response });
  return w;
}

export async function revealPaperCode(password: string): Promise<string | null> {
  const d = getDevice();
  if (!d?.paperShareEnc) return null;
  return openWithPassword(d.paperShareEnc, password);
}

export async function encryptKey(w: Wallet | HDNodeWallet, password: string, onProgress?: (p: number) => void) {
  // scrypt N=2^16: strong enough for a demo while staying fast on a phone (prod: 2^17+ and Secure Enclave wrapping)
  return encryptKeystoreJson({ address: w.address, privateKey: w.privateKey }, password, { scrypt: { N: 1 << 16 }, progressCallback: onProgress });
}

export const guessDeviceType = (): 'mobile' | 'desktop' => (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop');
export const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? tr('Windows PC', 'PC Windows') : tr('device', 'appareil');
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : tr('Browser', 'Navigateur');
  return tr(`${br} on ${os}`, `${br} sur ${os}`);
};

/** Creates the passkey (Touch ID / Face ID) — device binding. */
export async function registerPasskey(clientId: string, deviceType: 'mobile' | 'desktop', recoveryAttestationId?: string) {
  // The session may outlive a demo reset of the services: make sure the co-signer knows the client (idempotent).
  const profile = getSession()?.profile;
  if (profile) await cosigner.post('/clients', { clientId, name: profile.name ?? clientId, email: profile.email ?? `${clientId}@example.ch` });
  const options = await cosigner.post('/webauthn/register/options', { clientId, deviceType, recoveryAttestationId });
  const response = await startRegistration({ optionsJSON: options });
  return cosigner.post<{ credentialId: string; status: string }>('/webauthn/register/verify', {
    clientId,
    response,
    deviceType,
    label: deviceLabel(),
    recoveryAttestationId,
  });
}

/** Biometric confirmation bound to a challenge chosen by the co-signer (e.g. the Safe tx hash). */
export async function passkeyAssertion(optionsJSON: any) {
  return startAuthentication({ optionsJSON });
}

// ── tiny pub/sub so React re-renders when device/session changes ──
const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function emit() {
  listeners.forEach((f) => f());
}
