// Privacy lock state machine (pure logic, no React, no DOM — unit-tested in apps/web/test/privacyLock.test.ts).
//
// Behaviour (SECURITY_GAPS_FIX N1): once the wallet is unlocked (password + passkey), amounts are shown in clear.
// As soon as the user LEAVES, the whole wallet is covered by a privacy screen and its content is unmounted:
//   • the page/app is hidden (document visibilitychange → hidden, pagehide, app sent to background),
//   • the device went to sleep (the 1 s ticker sees a gap much larger than its period),
//   • no user activity for `idleMs` (demo: 60 s; production value: see PRIVACY_IDLE_PROD_MS).
// Showing the wallet again needs the passkey (WebAuthn user verification, purpose 'resume-session') or, if the
// passkey fails or is unavailable, the wallet password (checked locally by decrypting the keystore).
// This is a DISPLAY lock: the initial unlock rule (password + passkey) and the signing rules are unchanged.
// It only engages while the wallet is unlocked; a fresh unlock always starts "open".

/** Demo inactivity delay. */
export const PRIVACY_IDLE_DEMO_MS = 60_000;
/** Production inactivity delay (documented value, typical for banking apps). */
export const PRIVACY_IDLE_PROD_MS = 5 * 60_000;
/** A tick arriving this much later than expected means the device slept (timers are frozen during sleep). */
export const SLEEP_GAP_MS = 10_000;

export type LockReason = 'hidden' | 'background' | 'idle' | 'sleep' | 'manual';

export interface PrivacyLockOptions {
  idleMs?: number;
  now?: () => number;
}

export function createPrivacyLock(opts: PrivacyLockOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  let idleMs = opts.idleMs ?? PRIVACY_IDLE_DEMO_MS;
  let active = false; // wallet unlocked (key in memory)?
  let locked = false;
  let reason: LockReason | null = null;
  let lastActivity = now();
  let lastTick = now();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());

  const lockNow = (r: LockReason) => {
    if (!active || locked) return;
    locked = true;
    reason = r;
    emit();
  };

  return {
    isLocked: () => active && locked,
    /** Amounts may be rendered: wallet unlocked AND privacy screen not shown. */
    isVisible: () => active && !locked,
    reason: () => (active && locked ? reason : null),
    idleMs: () => idleMs,
    setIdleMs: (ms: number) => {
      idleMs = ms;
    },
    /** Wallet key unlocked / locked (lib/device.ts). A fresh unlock starts open; a lock resets everything. */
    setWalletUnlocked: (unlocked: boolean) => {
      if (unlocked === active) return;
      active = unlocked;
      locked = false;
      reason = null;
      lastActivity = lastTick = now();
      emit();
    },
    /** Page hidden, pagehide, app in background. */
    leave: (r: LockReason = 'hidden') => lockNow(r),
    /** User interaction (pointer, key, scroll, touch). Ignored while locked. */
    activity: () => {
      if (!locked) lastActivity = now();
    },
    /** Called about every second while the page is visible. */
    tick: () => {
      const t = now();
      const gap = t - lastTick;
      lastTick = t;
      if (gap > SLEEP_GAP_MS) return lockNow('sleep');
      if (t - lastActivity >= idleMs) lockNow('idle');
    },
    /** Only after a successful passkey or password verification. */
    resume: () => {
      if (!locked) return;
      locked = false;
      reason = null;
      lastActivity = lastTick = now();
      emit();
    },
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

export type PrivacyLock = ReturnType<typeof createPrivacyLock>;
