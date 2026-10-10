// Display preferences (persisted server-side with the client record, like the privacy setting) and amount masking.
// Hiding a wallet or masking amounts is DISPLAY ONLY: keys and assets are untouched.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { startAuthentication } from './passkeyGuard'; // guarded for the native app
import { cosigner } from './api';
import { fmt } from '../components/ui';
import { isUnlocked, subscribe as subscribeDevice } from './device';
import { createMaskState } from './maskState';
import { tr } from './i18n';

export interface Preferences {
  background: 'default' | 'white' | 'sand' | 'mist';
  accent: 'orange' | 'blue' | 'green' | 'violet';
  highlight: boolean;
  hiddenWallets: string[];
  hideAmounts: boolean;
}
export const DEFAULT_PREFS: Preferences = { background: 'default', accent: 'orange', highlight: false, hiddenWallets: [], hideAmounts: false };

// White text on every accent meets WCAG AA for large/bold text (buttons are 15 px semibold).
export const ACCENTS: Record<Preferences['accent'], { label: string; main: string; dark: string; soft: string }> = {
  orange: { label: tr('Swissquote orange', 'Orange Swissquote'), main: '#fa5b35', dark: '#e64a25', soft: '#fff1ec' },
  blue: { label: tr('Blue', 'Bleu'), main: '#2563d9', dark: '#1d4fb0', soft: '#eaf1fd' },
  green: { label: tr('Green', 'Vert'), main: '#00875a', dark: '#006b47', soft: '#e6f4ee' },
  violet: { label: 'Violet', main: '#6b46d6', dark: '#5534b5', soft: '#f1edfc' },
};
export const BACKGROUNDS: Record<Preferences['background'], { label: string; color: string }> = {
  default: { label: tr('Light grey (default)', 'Gris clair (par défaut)'), color: '#f0f3fa' },
  white: { label: tr('White', 'Blanc'), color: '#ffffff' },
  sand: { label: tr('Sand', 'Sable'), color: '#f6f2ec' },
  mist: { label: tr('Mist', 'Brume'), color: '#eef3f2' },
};
export const WALLET_ITEMS = [
  { id: 'mywall-usdc', label: 'My Wall — USD Coin' },
  { id: 'mywall-eth', label: 'My Wall — Ether' },
  { id: 'swissquote-account', label: tr('Swissquote account (transfer card)', 'Compte Swissquote (carte de virement)') },
];

let prefs: Preferences = DEFAULT_PREFS;
// Amounts are masked by default on every wallet entry; "revealed" is memory-only (see lib/maskState.ts).
export const mask = createMaskState();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let snap = { prefs, revealed: mask.isRevealed() };
const update = () => {
  snap = { prefs, revealed: mask.isRevealed() };
  emit();
};
mask.subscribe(update);
subscribeDevice(() => mask.onLockChange(isUnlocked())); // lock cycle → masked again

export function setPrefs(p: Partial<Preferences> | undefined) {
  // `hideAmounts` is kept for backward compatibility only: masking is now always the default.
  prefs = { ...DEFAULT_PREFS, ...p };
  update();
}
export function usePrefs() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => snap,
  );
}
export const useMasked = () => !usePrefs().revealed;

export async function savePrefs(clientId: string, patch: Partial<Preferences> & { reset?: boolean }) {
  const c = await cosigner.post(`/clients/${clientId}/preferences`, patch);
  setPrefs(c.preferences);
  return c.preferences as Preferences;
}

export class NoPasskeyError extends Error {}

/** Reveal amounts: requires WebAuthn user verification with the passkey (no silent fallback to the backup code).
 *  We do not claim biometrics: the device decides (Touch ID / Face ID / device PIN). */
export async function revealAmounts(clientId: string) {
  if (typeof window === 'undefined' || !window.PublicKeyCredential)
    throw new NoPasskeyError(tr('This browser cannot use passkeys: amounts stay hidden. Use a browser/device with a passkey (Settings → Devices).', 'Ce navigateur ne gère pas les passkeys : les montants restent masqués. Utilisez un navigateur/appareil avec une passkey (Paramètres → Appareils).'));
  const options = await cosigner.post('/webauthn/auth/options', { clientId, purpose: 'reveal-amounts' });
  const response = await startAuthentication({ optionsJSON: options });
  await cosigner.post('/webauthn/auth/verify', { clientId, purpose: 'reveal-amounts', response });
  mask.reveal();
}
export function hideAgain() {
  mask.hide();
}

/** User-facing message for a failed reveal (amounts stay masked in every case). */
export function revealErrorMessage(e: any) {
  if (e instanceof NoPasskeyError) return e.message;
  if (e?.name === 'NotAllowedError') return tr('Verification cancelled: amounts stay hidden.', 'Vérification annulée : les montants restent masqués.');
  return tr(
    `Amounts stay hidden: ${e?.message ?? 'verification failed'}. Set up a passkey for this device in Settings → Devices.`,
    `Les montants restent masqués : ${e?.message ?? 'vérification impossible'}. Configurez une passkey pour cet appareil dans Paramètres → Appareils.`,
  );
}

export function themeStyle(p: Preferences): CSSProperties {
  const a = ACCENTS[p.accent] ?? ACCENTS.orange;
  return {
    ['--color-sq-orange' as any]: a.main,
    ['--color-sq-orange-600' as any]: a.dark,
    ['--color-sq-orange-50' as any]: a.soft,
    ['--color-sq-bg' as any]: (BACKGROUNDS[p.background] ?? BACKGROUNDS.default).color,
    background: (BACKGROUNDS[p.background] ?? BACKGROUNDS.default).color,
  };
}

/** A balance or counter-value that respects the "hide amounts" preference everywhere (text + accessible label). */
export function Money({ value, decimals = 2, unit, className, unitClassName }: { value: number; decimals?: number; unit?: string; className?: string; unitClassName?: string }): ReactNode {
  const masked = useMasked();
  if (masked)
    return (
      <span className={className} aria-label={tr('Amount hidden', 'Montant masqué')} title={tr('Amount hidden', 'Montant masqué')}>
        ••••••{unit && <span className={unitClassName ?? 'ml-1 text-[0.7em] font-normal'}>{unit}</span>}
      </span>
    );
  return (
    <span className={className}>
      {fmt(value, decimals)}
      {unit && <span className={unitClassName ?? 'ml-1 text-[0.7em] font-normal'}>{unit}</span>}
    </span>
  );
}
