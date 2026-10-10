// Amount masking state (pure logic, no React — unit-tested in apps/web/test/maskState.test.ts).
//
// Behaviour chosen (spec §8): personal amounts are ALWAYS masked when you enter the wallet. Revealing them needs
// an explicit action + WebAuthn user verification (passkey). The revealed state lives in memory only — never in
// storage or on the server — and is reset:
//   • when the wallet is locked (lock cycle in lib/device.ts) or the page is reloaded (memory is gone),
//   • when you leave the wallet area (any route outside WALLET_PREFIXES): coming back is a new entry.
// The former `hideAmounts` preference is no longer needed (masking is the default for everyone); it is kept in
// the stored preferences only for backward compatibility and has no effect.

export const WALLET_PREFIXES = ['/wallet', '/send', '/asset', '/dapps', '/settings', '/inbox'];

export const isWalletPath = (path: string) => path !== '/wallet/unlock' && WALLET_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));

export function createMaskState() {
  let revealed = false;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    if (revealed === v) return;
    revealed = v;
    listeners.forEach((f) => f());
  };
  return {
    isRevealed: () => revealed,
    isMasked: () => !revealed,
    /** Only call after a successful user verification. */
    reveal: () => set(true),
    hide: () => set(false),
    /** Wallet locked → masked again. */
    onLockChange: (unlocked: boolean) => {
      if (!unlocked) set(false);
    },
    /** Navigation: leaving the wallet area ends the "entry" → masked again on the next entry. */
    onNavigate: (path: string) => {
      if (!isWalletPath(path)) set(false);
    },
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}
