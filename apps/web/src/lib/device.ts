// Everything that lives ON THIS DEVICE: the encrypted device key K1 (ethers keystore / scrypt),
// the passkey credential id, and the Swissquote session. K1 is only decrypted in memory.

import { Wallet, type HDNodeWallet } from 'ethers';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { cosigner } from './api';

export interface DeviceRecord {
  clientId: string;
  safeAddress?: string;
  deviceAddress: string;
  keystore: string; // encrypted K1
  credentialId?: string;
  deviceType: 'mobile' | 'desktop';
  createdAt: string;
}

export interface BankSession {
  token: string;
  clientId: string;
  profile: any;
}

const DEVICE_KEY = 'sqw:device';
const SESSION_KEY = 'sqw:session';

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

export const getDevice = (): DeviceRecord | null => JSON.parse(safeGet(DEVICE_KEY) ?? 'null');
export const saveDevice = (d: DeviceRecord | null) => {
  safeSet(DEVICE_KEY, d ? JSON.stringify(d) : null);
  emit();
};

export const getSession = (): BankSession | null => JSON.parse(safeGet(SESSION_KEY) ?? 'null');
export const saveSession = (s: BankSession | null) => {
  safeSet(SESSION_KEY, s ? JSON.stringify(s) : null);
  emit();
};

// ── in-memory unlocked device key ──
let unlocked: Wallet | HDNodeWallet | null = null;
export const isUnlocked = () => !!unlocked;
export const lock = () => {
  unlocked = null;
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

export async function unlock(password: string, onProgress?: (p: number) => void) {
  const d = getDevice();
  if (!d) throw new Error('No wallet on this device');
  try {
    unlocked = await Wallet.fromEncryptedJson(d.keystore, password, onProgress);
  } catch {
    throw new Error('Wrong password');
  }
  emit();
  return unlocked;
}

export async function encryptKey(w: Wallet | HDNodeWallet, password: string, onProgress?: (p: number) => void) {
  // scrypt N=2^16: strong enough for a demo while staying fast on a phone (prod: 2^17+ and Secure Enclave wrapping)
  return w.encrypt(password, { scrypt: { N: 1 << 16 }, progressCallback: onProgress } as any);
}

export const guessDeviceType = (): 'mobile' | 'desktop' => (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop');
export const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return `${br} on ${os}`;
};

/** Creates the passkey (Touch ID / Face ID) — device binding. */
export async function registerPasskey(clientId: string, deviceType: 'mobile' | 'desktop', recoveryAttestationId?: string) {
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
