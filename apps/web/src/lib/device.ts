// Everything that lives ON THIS DEVICE: the encrypted device key K1 (ethers keystore / scrypt),
// the passkey credential id, and the Swissquote session. K1 is only decrypted in memory.

import { Wallet, encryptKeystoreJson, type HDNodeWallet } from 'ethers';
import { bindKeystoreWithPrf, newPrfSalt, openWithPassword, parsePrfBoundKeystore, unbindKeystoreWithPrf, type PasswordSealed, type PrfBoundKeystore } from '@sq/shared';
import { bufferToBase64URLString } from '@simplewebauthn/browser';
import { getBytes } from 'ethers';
import { startAuthentication, startRegistration } from './passkeyGuard'; // guarded for the native app
import { cosigner } from './api';
import { tr } from './i18n';
import { decoyActive, decoyDevice, decoyKey, decoySession, duressProof, endDecoy, isDecoyCode } from './decoy';

export interface DeviceRecord {
  clientId: string;
  safeAddress?: string;
  deviceAddress: string;
  keystore: string; // encrypted K1 (password) — '' when the device is hardware-bound: see hwKeystore
  /** #11 — K1 bound to this device's passkey: AES-GCM(PRF-derived key, password keystore). Both are needed. */
  hwKeystore?: PrfBoundKeystore;
  /** #11 — the browser / authenticator could not provide the PRF extension when the passkey was created. */
  hwBindingUnavailable?: boolean;
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
  openedKeystore = null;
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

// ── #11 hardware binding (WebAuthn PRF) ──
// The outer layer is removed with the passkey ONCE per session (at unlock); the password-encrypted keystore is then
// kept IN MEMORY ONLY (never stored in clear) until lock(), so password re-checks during the session (privacy-lock
// fallback, re-authentication before showing a secret, duress-code setup…) need no extra passkey prompt. A copy of
// the browser storage contains only the outer ciphertext.
let openedKeystore: string | null = null;

export class HardwareBindingError extends Error {
  constructor(
    message: string,
    public cancelled = false,
  ) {
    super(message);
  }
}

export const isHardwareBound = (d: DeviceRecord | null | undefined) => !!parsePrfBoundKeystore(d?.hwKeystore);
export type HardwareBindingStatus = 'active' | 'unavailable' | 'not-set';
export const hardwareBindingStatus = (d: DeviceRecord | null | undefined): HardwareBindingStatus => (isHardwareBound(d) ? 'active' : d?.hwBindingUnavailable ? 'unavailable' : 'not-set');

const prfExtension = (prfSaltHex: string) => ({ prf: { eval: { first: getBytes(prfSaltHex) } } });
const prfFirst = (ext: any): Uint8Array | null => {
  const first = ext?.prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? new Uint8Array(first) : new Uint8Array(first as ArrayBuffer);
};
/** The PRF output never leaves the device: it is removed before a WebAuthn response is sent to the co-signer. */
const withoutExtensionResults = <T extends { clientExtensionResults?: unknown }>(r: T): T => ({ ...r, clientExtensionResults: {} });

/** Evaluates the PRF of this device's passkey for a salt (local ceremony — Touch ID / Face ID / device PIN). */
export async function evalDevicePrf(p: { credentialId: string; rpId: string; prfSalt: string }): Promise<Uint8Array | null> {
  const res = await startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(32)).buffer),
      rpId: p.rpId,
      allowCredentials: [{ id: p.credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 120_000,
      extensions: prfExtension(p.prfSalt) as any,
    },
  });
  return prfFirst(res.clientExtensionResults);
}

async function openWithPrf(hw: PrfBoundKeystore, prf: Uint8Array) {
  try {
    openedKeystore = await unbindKeystoreWithPrf(hw, prf);
  } catch {
    throw new HardwareBindingError(tr('This passkey cannot open the device key of this wallet (wrong passkey or altered data).', 'Cette passkey ne peut pas ouvrir la clé d’appareil de ce wallet (mauvaise passkey ou données modifiées).'));
  } finally {
    prf.fill(0);
  }
}

/** The password-encrypted keystore: directly (no binding) or after removing the passkey layer (one prompt per session). */
async function keystoreForPassword(d: DeviceRecord): Promise<string> {
  const hw = parsePrfBoundKeystore(d.hwKeystore);
  if (!hw) return d.keystore;
  if (openedKeystore) return openedKeystore;
  let prf: Uint8Array | null;
  try {
    prf = await evalDevicePrf(hw);
  } catch (e: any) {
    throw new HardwareBindingError(
      e?.name === 'NotAllowedError' ? tr('The passkey of this device was not used (cancelled or timed out).', 'La passkey de cet appareil n’a pas été utilisée (annulé ou délai dépassé).') : tr('This device’s passkey is required to open its key.', 'La passkey de cet appareil est nécessaire pour ouvrir sa clé.'),
      e?.name === 'NotAllowedError',
    );
  }
  if (!prf) throw new HardwareBindingError(tr('This passkey did not return its hardware secret (PRF).', 'Cette passkey n’a pas renvoyé son secret matériel (PRF).'));
  await openWithPrf(hw, prf);
  return openedKeystore!;
}

/**
 * Unlock passkey ceremony (server challenge, purpose 'unlock') that ALSO evaluates the PRF on a hardware-bound
 * device: one Touch ID both proves presence to the co-signer and opens the outer layer of K1. Returns the
 * response to send to the co-signer (without the PRF output).
 */
export async function unlockPasskeyWithBinding(optionsJSON: any) {
  const d = getDevice();
  const hw = parsePrfBoundKeystore(d?.hwKeystore);
  if (!hw) return startAuthentication({ optionsJSON });
  const res = await startAuthentication({
    optionsJSON: { ...optionsJSON, allowCredentials: [{ id: hw.credentialId, type: 'public-key' }], extensions: { ...(optionsJSON.extensions ?? {}), ...prfExtension(hw.prfSalt) } },
  });
  const prf = prfFirst(res.clientExtensionResults);
  if (!prf) throw new HardwareBindingError(tr('This passkey did not return its hardware secret (PRF).', 'Cette passkey n’a pas renvoyé son secret matériel (PRF).'));
  await openWithPrf(hw, prf);
  return withoutExtensionResults(res);
}

/** What the passkey registration yields for the binding (PRF output kept in memory only until the key is sealed). */
export interface PasskeyBinding {
  credentialId: string;
  rpId: string;
  prfSalt: string;
  prfOutput: Uint8Array | null;
}

/**
 * Encrypts a NEW device key: password keystore, then — when the passkey supports PRF — the hardware layer.
 * Returns the fields to store in the DeviceRecord.
 */
export async function sealDeviceKey(w: Wallet | HDNodeWallet, password: string, binding: PasskeyBinding | null | undefined, onProgress?: (p: number) => void): Promise<Pick<DeviceRecord, 'keystore' | 'hwKeystore' | 'hwBindingUnavailable'>> {
  const keystore = await encryptKey(w, password, onProgress);
  if (!binding?.prfOutput) return { keystore, hwBindingUnavailable: true };
  const hwKeystore = await bindKeystoreWithPrf({ keystore, prfOutput: binding.prfOutput, credentialId: binding.credentialId, rpId: binding.rpId, prfSalt: binding.prfSalt });
  binding.prfOutput.fill(0);
  binding.prfOutput = null;
  openedKeystore = keystore; // this session is being unlocked with the new key
  return { keystore: '', hwKeystore };
}

/** Existing device (created before #11): adds the passkey layer now (one Touch ID; the password is not needed). */
export async function bindExistingDevice(): Promise<HardwareBindingStatus> {
  const d = getDevice();
  if (!d || isHardwareBound(d)) return hardwareBindingStatus(d);
  if (!d.credentialId || !d.keystore) throw new Error(tr('No passkey is registered on this device.', 'Aucune passkey n’est enregistrée sur cet appareil.'));
  const prfSalt = newPrfSalt();
  const rpId = window.location.hostname;
  const prf = await evalDevicePrf({ credentialId: d.credentialId, rpId, prfSalt });
  if (!prf) {
    saveDevice({ ...d, hwBindingUnavailable: true });
    return 'unavailable';
  }
  const hwKeystore = await bindKeystoreWithPrf({ keystore: d.keystore, prfOutput: prf, credentialId: d.credentialId, rpId, prfSalt });
  prf.fill(0);
  // Check before dropping the plain keystore: the passkey must open what was just written.
  const again = await evalDevicePrf({ credentialId: d.credentialId, rpId, prfSalt });
  if (!again) throw new HardwareBindingError(tr('This passkey did not return its hardware secret (PRF).', 'Cette passkey n’a pas renvoyé son secret matériel (PRF).'));
  await openWithPrf(hwKeystore, again);
  saveDevice({ ...d, keystore: '', hwKeystore, hwBindingUnavailable: undefined });
  return 'active';
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
  return Wallet.fromEncryptedJson(await keystoreForPassword(d), password, onProgress);
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
    if (e instanceof NoWalletError || e instanceof HardwareBindingError) throw e;
    if (!unlocked) openedKeystore = null; // a wrong password before unlock: the next try needs the passkey again
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
    if (e instanceof NoWalletError || e instanceof HardwareBindingError) throw e;
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
  if (!unlocked) openedKeystore = null; // a wrong password before unlock: the next try needs the passkey again
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
  } catch (e) {
    if (e instanceof HardwareBindingError) throw e;
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

/**
 * Creates the passkey (Touch ID / Face ID) — device binding. With `hardwareBinding` (#11: onboarding and recovery
 * create the device key right after), the PRF extension is requested with a fresh per-wallet salt; the PRF output is
 * returned in memory (`binding`) to seal K1, and stripped from what is sent to the co-signer. `binding.prfOutput`
 * is null when the browser / authenticator has no PRF (fallback: password-only keystore, shown in Security).
 */
export async function registerPasskey(clientId: string, deviceType: 'mobile' | 'desktop', recoveryAttestationId?: string, opts: { hardwareBinding?: boolean } = {}) {
  // The session may outlive a demo reset of the services: make sure the co-signer knows the client (idempotent).
  const profile = getSession()?.profile;
  if (profile) await cosigner.post('/clients', { clientId, name: profile.name ?? clientId, email: profile.email ?? `${clientId}@example.ch` });
  const options = await cosigner.post('/webauthn/register/options', { clientId, deviceType, recoveryAttestationId });
  const prfSalt = opts.hardwareBinding ? newPrfSalt() : null;
  const response = await startRegistration({ optionsJSON: prfSalt ? { ...options, extensions: { ...(options.extensions ?? {}), ...prfExtension(prfSalt) } } : options });
  const r = await cosigner.post<{ credentialId: string; status: string }>('/webauthn/register/verify', {
    clientId,
    response: withoutExtensionResults(response),
    deviceType,
    label: deviceLabel(),
    recoveryAttestationId,
  });
  let binding: PasskeyBinding | null = null;
  if (prfSalt) {
    const ext: any = response.clientExtensionResults;
    const rpId = options.rp?.id ?? window.location.hostname;
    let out = ext?.prf?.enabled === false ? null : prfFirst(ext);
    // Most authenticators only return the PRF output on an assertion: one more Touch ID right away.
    if (!out && ext?.prf?.enabled === true) out = await evalDevicePrf({ credentialId: response.id, rpId, prfSalt }).catch(() => null);
    binding = { credentialId: response.id, rpId, prfSalt, prfOutput: out };
  }
  return { ...r, binding };
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
