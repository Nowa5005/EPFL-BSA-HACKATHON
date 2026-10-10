// Confirmation feedback: an orange disc whose white check is drawn — ONLY once a transaction is confirmed.
// Pending transactions get a discreet grey indicator, never a check.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, X } from 'lucide-react';
import { buildReceipt, downloadReceiptPdf } from '../lib/receipt';
import { useLocal, useWalletTxs, type WalletTxView } from '../lib/hooks';
import { cx, fmt, Spinner } from './ui';
import { useMasked } from '../lib/prefs';

export function CheckDisc({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="mw-check-disc shrink-0" aria-hidden>
      <circle cx="32" cy="32" r="32" fill="#fa5b35" />
      <path className="mw-check-path" d="M20 33 l8 8 l16 -18" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PendingIndicator({ text = 'En attente de confirmation sur Ethereum…' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[14px] text-sq-muted" aria-live="polite">
      <Spinner className="text-sq-muted" />
      {text}
    </span>
  );
}

/** Counts from `from` to `to` (light animated counter; instant with reduced motion). */
export function useCountUp(to: number, from: number, ms = 600) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(to);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, from, ms]);
  return v;
}

export function ConfirmedCard({ tx, clientName, onClose, title }: { tx: WalletTxView; clientName: string; onClose?: () => void; title?: string }) {
  const masked = useMasked();
  const label = title ?? `${tx.kind === 'receive' ? 'Réception confirmée' : 'Envoi confirmé'} — ${masked ? '••••••' : fmt(Number(tx.amount), tx.asset === 'ETH' ? 5 : 2)} ${tx.asset}`;
  return (
    <div className="flex items-start gap-4">
      <CheckDisc />
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold" role="status">
          {label}
          {tx.simulated && <span className="ml-1 text-[13px] font-normal text-sq-muted">(simulée)</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link to={`/wallet/tx/${tx.id}`} onClick={onClose} className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-4">
            <FileText size={16} strokeWidth={1.75} /> Voir le justificatif
          </Link>
          <button type="button" onClick={() => downloadReceiptPdf(buildReceipt(tx, clientName))} className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-4">
            <Download size={16} strokeWidth={1.75} /> Télécharger
          </button>
        </div>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Fermer" className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-full text-sq-muted hover:bg-sq-chip/60">
          <X size={18} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/**
 * Light, non-blocking layer at the top of My Wall: shows incoming payments as they go from
 * "en attente" (grey, no check) to "confirmée" (orange disc + check). Closes itself after 8 s.
 */
export function ConfirmationLayer() {
  const { session } = useLocal();
  const { data } = useWalletTxs(2500);
  const seen = useRef<Map<string, string> | null>(null);
  const [shown, setShown] = useState<WalletTxView | null>(null);

  useEffect(() => {
    if (!data) return;
    const recv = data.filter((t) => t.kind === 'receive');
    if (!seen.current) {
      seen.current = new Map(recv.map((t) => [t.id, t.status]));
      return;
    }
    for (const t of recv) {
      const before = seen.current.get(t.id);
      if (t.status === 'confirmed' && before !== 'confirmed') setShown(t);
      seen.current.set(t.id, t.status);
    }
  }, [data]);

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), 8000);
    return () => clearTimeout(id);
  }, [shown]);

  const pending = (data ?? []).filter((t) => t.kind === 'receive' && (t.status === 'pending' || t.status === 'detected'));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(8px,env(safe-area-inset-top))] z-40 flex flex-col items-center gap-2 px-4">
      {pending.length > 0 && !shown && (
        <div className="mw-toast pointer-events-auto rounded-full border border-sq-line bg-white px-4 py-2 shadow-sm">
          <PendingIndicator text="Réception en attente de confirmation…" />
        </div>
      )}
      {shown && (
        <div className={cx('mw-toast pointer-events-auto w-full max-w-md rounded-[12px] border border-sq-line bg-white p-4 shadow-lg')}>
          <ConfirmedCard tx={shown} clientName={session?.profile?.name ?? ''} onClose={() => setShown(null)} />
        </div>
      )}
    </div>
  );
}
