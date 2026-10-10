// Display preferences (persisted server-side with the client record, like the privacy setting) and amount masking.
// Hiding a wallet or masking amounts is DISPLAY ONLY: keys and assets are untouched.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { cosigner } from './api';
import { fmt } from '../components/ui';

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
  orange: { label: 'Orange Swissquote', main: '#fa5b35', dark: '#e64a25', soft: '#fff1ec' },
  blue: { label: 'Bleu', main: '#2563d9', dark: '#1d4fb0', soft: '#eaf1fd' },
  green: { label: 'Vert', main: '#00875a', dark: '#006b47', soft: '#e6f4ee' },
  violet: { label: 'Violet', main: '#6b46d6', dark: '#5534b5', soft: '#f1edfc' },
};
export const BACKGROUNDS: Record<Preferences['background'], { label: string; color: string }> = {
  default: { label: 'Gris clair (par défaut)', color: '#f0f3fa' },
  white: { label: 'Blanc', color: '#ffffff' },
  sand: { label: 'Sable', color: '#f6f2ec' },
  mist: { label: 'Brume', color: '#eef3f2' },
};
export const WALLET_ITEMS = [
  { id: 'mywall-usdc', label: 'My Wall — USD Coin' },
  { id: 'mywall-eth', label: 'My Wall — Ether' },
  { id: 'swissquote-account', label: 'Compte Swissquote (carte de virement)' },
];

let prefs: Preferences = DEFAULT_PREFS;
let revealed = false; // amounts revealed for this session after user verification (memory only)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let snap = { prefs, revealed };
const update = () => {
  snap = { prefs, revealed };
  emit();
};

export function setPrefs(p: Partial<Preferences> | undefined) {
  prefs = { ...DEFAULT_PREFS, ...p };
  if (!prefs.hideAmounts) revealed = false;
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
export const useMasked = () => {
  const s = usePrefs();
  return s.prefs.hideAmounts && !s.revealed;
};

export async function savePrefs(clientId: string, patch: Partial<Preferences> & { reset?: boolean }) {
  const c = await cosigner.post(`/clients/${clientId}/preferences`, patch);
  setPrefs(c.preferences);
  return c.preferences as Preferences;
}

/** Reveal amounts: requires user verification with the passkey (no silent fallback to the backup code). */
export async function revealAmounts(clientId: string) {
  const options = await cosigner.post('/webauthn/auth/options', { clientId, purpose: 'reveal-amounts' });
  const response = await startAuthentication({ optionsJSON: options });
  await cosigner.post('/webauthn/auth/verify', { clientId, purpose: 'reveal-amounts', response });
  revealed = true;
  update();
}
export function hideAgain() {
  revealed = false;
  update();
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
      <span className={className} aria-label="Montant masqué" title="Montant masqué">
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
