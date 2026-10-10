// Explicit "show / hide amounts" controls. Showing needs WebAuthn user verification with the passkey (purpose
// 'reveal-amounts'); hiding is instant. The revealed state is memory-only and reset on every new wallet entry
// (see lib/maskState.ts). We never claim biometrics: the device decides (Touch ID / Face ID / device PIN).

import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { hideAgain, revealAmounts, revealErrorMessage, useMasked } from '../lib/prefs';
import { useLocal } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { cx, Spinner } from '../components/ui';

export const VERIFY_HINT = () => tr('Verify with your passkey (Touch ID / Face ID / device PIN depending on your device).', 'Vérifiez avec votre passkey (Touch ID / Face ID / code de l’appareil selon votre appareil).');

export function useReveal() {
  const { device } = useLocal();
  const masked = useMasked();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Resolves true when amounts are visible (already, or after a successful verification). */
  const ensureRevealed = async () => {
    if (!masked) return true;
    setError('');
    setBusy(true);
    try {
      await revealAmounts(device!.clientId);
      return true;
    } catch (e) {
      setError(revealErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (!masked) {
      setError('');
      hideAgain();
    } else await ensureRevealed();
  };
  return { masked, busy, error, toggle, ensureRevealed };
}

/** Round eye button (Home hero). */
export function RevealButton({ r }: { r: ReturnType<typeof useReveal> }) {
  return (
    <button
      type="button"
      onClick={() => void r.toggle()}
      disabled={r.busy}
      className="ml-1 flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60"
      aria-label={r.masked ? tr('Show amounts (passkey verification)', 'Afficher les montants (vérification par passkey)') : tr('Hide amounts', 'Masquer les montants')}
      title={r.masked ? `${tr('Show amounts', 'Afficher les montants')} — ${VERIFY_HINT()}` : tr('Hide amounts', 'Masquer les montants')}
      data-testid="reveal-toggle"
    >
      {r.busy ? <Spinner /> : r.masked ? <Eye size={18} strokeWidth={1.75} /> : <EyeOff size={18} strokeWidth={1.75} />}
    </button>
  );
}

/** Thin bar for secondary wallet screens: tells that amounts are hidden and offers to show / hide them. */
export function MaskBar({ className }: { className?: string }) {
  const r = useReveal();
  return (
    <div className={cx('mb-3 rounded-[10px] border border-sq-line bg-white px-3 py-2 text-[13px]', className)}>
      <div className="flex items-center gap-2">
        {r.masked ? <Lock size={16} strokeWidth={1.75} className="shrink-0 text-sq-muted" /> : <Eye size={16} strokeWidth={1.75} className="shrink-0 text-sq-muted" />}
        <span className="min-w-0 flex-1 text-sq-ink-2">{r.masked ? tr('Amounts are hidden.', 'Les montants sont masqués.') : tr('Amounts are visible until you leave the wallet.', 'Montants visibles jusqu’à ce que vous quittiez le wallet.')}</span>
        <button type="button" onClick={() => void r.toggle()} disabled={r.busy} className="inline-flex min-h-10 shrink-0 items-center gap-1 font-semibold text-sq-ink underline underline-offset-2" data-testid="maskbar-toggle">
          {r.busy ? <Spinner /> : r.masked ? tr('Show amounts', 'Afficher les montants') : tr('Hide', 'Masquer')}
        </button>
      </div>
      {r.masked && <p className="mt-0.5 text-[12px] text-sq-muted">{VERIFY_HINT()}</p>}
      {r.error && <p className="mt-1 text-[12px] text-sq-down" role="alert">{r.error}</p>}
    </div>
  );
}
