// Display preferences (persisted server-side with the client record, like the privacy setting).
// Hiding a wallet is DISPLAY ONLY: keys and assets are untouched. Amounts are shown in clear once the wallet is
// unlocked; leaving the app covers it with the privacy screen (lib/privacy.ts) — there is no manual masking any more.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { cosigner } from './api';
import { fmt } from '../components/ui';
import { useAmountsVisible } from './privacy';
import { tr } from './i18n';
import type { WidgetLayouts } from '@sq/shared/widgets';

export interface Preferences {
  background: 'default' | 'white' | 'sand' | 'mist';
  accent: 'orange' | 'blue' | 'green' | 'violet';
  highlight: boolean;
  hiddenWallets: string[];
  /** @deprecated Manual masking was removed (N1). Kept in stored preferences for backward compatibility; ignored. */
  hideAmounts?: boolean;
  /** Home widget layouts, phone and desktop (N6; lib/widgets.tsx). */
  widgets?: WidgetLayouts;
}
export const DEFAULT_PREFS: Preferences = { background: 'default', accent: 'orange', highlight: false, hiddenWallets: [], hideAmounts: false };

// White text on every accent meets WCAG AA for large/bold text (buttons are 15 px semibold).
// `dark` = accent text / hover (≥ 4.5:1 on white); `night` = the same roles in the dark theme (lib/theme.ts).
export const ACCENTS: Record<Preferences['accent'], { label: string; main: string; dark: string; soft: string; night: { text: string; soft: string } }> = {
  orange: { label: tr('Swissquote orange', 'Orange Swissquote'), main: '#fa5b35', dark: '#c93d1b', soft: '#fff1ec', night: { text: '#ff7a55', soft: '#3a2119' } },
  blue: { label: tr('Blue', 'Bleu'), main: '#2563d9', dark: '#1d4fb0', soft: '#eaf1fd', night: { text: '#7fa8ff', soft: '#1a2742' } },
  green: { label: tr('Green', 'Vert'), main: '#00875a', dark: '#006b47', soft: '#e6f4ee', night: { text: '#3dcc8e', soft: '#11281e' } },
  violet: { label: 'Violet', main: '#6b46d6', dark: '#5534b5', soft: '#f1edfc', night: { text: '#a98bff', soft: '#2a2142' } },
};
// Background presets, with a designed dark variant each (same mood, dark tone).
export const BACKGROUNDS: Record<Preferences['background'], { label: string; color: string; night: string }> = {
  default: { label: tr('Light grey (default)', 'Gris clair (par défaut)'), color: '#f0f3fa', night: '#111317' },
  white: { label: tr('White', 'Blanc'), color: '#ffffff', night: '#17191e' },
  sand: { label: tr('Sand', 'Sable'), color: '#f6f2ec', night: '#1a1814' },
  mist: { label: tr('Mist', 'Brume'), color: '#eef3f2', night: '#121918' },
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

/** Personalisation (accent + background) as CSS variables, for the resolved theme (light or dark). */
export function themeStyle(p: Preferences, dark = false): CSSProperties {
  const a = ACCENTS[p.accent] ?? ACCENTS.orange;
  const b = BACKGROUNDS[p.background] ?? BACKGROUNDS.default;
  const bg = dark ? b.night : b.color;
  return {
    ['--color-sq-orange' as any]: a.main,
    ['--color-sq-orange-600' as any]: dark ? a.night.text : a.dark,
    ['--color-sq-orange-50' as any]: dark ? a.night.soft : a.soft,
    ['--color-sq-bg' as any]: bg,
    background: bg,
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
