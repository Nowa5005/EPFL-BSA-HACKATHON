// Display preferences (persisted server-side with the client record, like the privacy setting).
// Hiding a wallet is DISPLAY ONLY: keys and assets are untouched. Amounts are shown in clear once the wallet is
// unlocked; leaving the app covers it with the privacy screen (lib/privacy.ts) — there is no manual masking any more.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { cosigner } from './api';
import { fmt } from '../components/ui';
import { useAmountsVisible } from './privacy';
import { tr } from './i18n';

export interface Preferences {
  background: 'default' | 'white' | 'sand' | 'mist';
  accent: 'orange' | 'blue' | 'green' | 'violet';
  highlight: boolean;
  hiddenWallets: string[];
  /** @deprecated Manual masking was removed (N1). Kept in stored preferences for backward compatibility; ignored. */
  hideAmounts?: boolean;
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
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let snap = { prefs };
const update = () => {
  snap = { prefs };
  emit();
};

export function setPrefs(p: Partial<Preferences> | undefined) {
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
/** True when wallet amounts must NOT be rendered: wallet locked in this session, or covered by the privacy screen.
 *  Inside the wallet this is always false (its content is unmounted while locked); it protects components that can
 *  also render elsewhere (e.g. the Swissquote home "My Wall" line). */
export const useMasked = () => !useAmountsVisible();

export async function savePrefs(clientId: string, patch: Partial<Preferences> & { reset?: boolean }) {
  const c = await cosigner.post(`/clients/${clientId}/preferences`, patch);
  setPrefs(c.preferences);
  return c.preferences as Preferences;
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

/** A balance or counter-value; never rendered while the wallet is locked (see useMasked). */
export function Money({ value, decimals = 2, unit, className, unitClassName }: { value: number; decimals?: number; unit?: string; className?: string; unitClassName?: string }): ReactNode {
  const masked = useMasked();
  if (masked)
    return (
      <span className={className} data-testid="wallet-value-locked">
        {tr('Unlock My Wall to see', 'Déverrouillez My Wall pour voir')}
      </span>
    );
  return (
    <span className={className}>
      {fmt(value, decimals)}
      {unit && <span className={unitClassName ?? 'ml-1 text-[0.7em] font-normal'}>{unit}</span>}
    </span>
  );
}
