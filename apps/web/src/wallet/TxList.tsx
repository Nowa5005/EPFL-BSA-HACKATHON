import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Download, Repeat } from 'lucide-react';
import { buildReceipt, downloadReceiptPdf } from '../lib/receipt';
import type { WalletTxView } from '../lib/hooks';
import { cx, dateTime, fmt, Skeleton, StatusPill } from '../components/ui';
import { useMasked } from '../lib/prefs';
import { tr } from '../lib/i18n';
import { useReveal } from './Reveal';

export const kindLabel = (k: WalletTxView['kind']) => (k === 'receive' ? tr('Received', 'Réception') : k === 'send' ? tr('Sent', 'Envoi') : tr('Swap', 'Échange'));
export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export function counterparty(t: WalletTxView) {
  if (t.simulated) return tr('Simulation (demo)', 'Simulation (démo)');
  if (t.counterpartyName) return t.counterpartyName;
  return short(t.kind === 'receive' ? t.from : t.to) || '—';
}

export function KindIcon({ kind }: { kind: WalletTxView['kind'] }) {
  const Icon = kind === 'receive' ? ArrowDownLeft : kind === 'send' ? ArrowUpRight : Repeat;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sq-bg text-sq-ink">
      <Icon size={20} strokeWidth={1.75} />
    </span>
  );
}

export function SignedAmount({ t, className }: { t: WalletTxView; className?: string }) {
  const masked = useMasked();
  const sign = t.kind === 'receive' ? '+' : '−';
  if (masked)
    return (
      <span className={cx('num whitespace-nowrap font-semibold text-sq-ink', className)} aria-label={tr('Amount hidden', 'Montant masqué')}>
        •••••• <span className="text-[0.8em] font-normal">{t.asset}</span>
      </span>
    );
  return (
    <span className={cx('num whitespace-nowrap font-semibold', t.kind === 'receive' && t.status === 'confirmed' ? 'text-sq-up' : 'text-sq-ink', className)}>
      {t.amount === '?' ? '…' : `${sign}${fmt(Number(t.amount), t.asset === 'ETH' ? 5 : 2)}`} <span className="text-[0.8em] font-normal">{t.asset}</span>
    </span>
  );
}

export function TxListCompact({ items, loading }: { items: WalletTxView[]; loading?: boolean }) {
  if (loading)
    return (
      <div className="space-y-3 py-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  if (!items.length) return <p className="py-6 text-center text-[14px] text-sq-muted">{tr('No transactions yet.', "Aucune transaction pour l'instant.")}</p>;
  return (
    <ul className="divide-y divide-sq-line">
      {items.map((t) => (
        <li key={t.id}>
          <Link to={`/wallet/tx/${t.id}`} className="flex min-h-[64px] items-center gap-3 py-2.5 hover:bg-sq-bg/50">
            <KindIcon kind={t.kind} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{kindLabel(t.kind)}</span>
              <span className="mt-0.5 block truncate text-[12px] text-sq-muted">
                {counterparty(t)} · {dateTime(t.createdAt)}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <SignedAmount t={t} className="text-[15px]" />
              <StatusPill status={t.status} />
            </span>
            <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-sq-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TxTable({ items, clientName, loading }: { items: WalletTxView[]; clientName: string; loading?: boolean }) {
  const reveal = useReveal();
  // The PDF contains the amounts: downloading it while they are hidden requires revealing them first.
  const download = async (t: WalletTxView) => {
    if (await reveal.ensureRevealed()) await downloadReceiptPdf(buildReceipt(t, clientName));
  };
  if (loading) return <Skeleton className="h-40" />;
  if (!items.length) return <p className="py-8 text-center text-[14px] text-sq-muted">{tr('No transactions yet.', "Aucune transaction pour l'instant.")}</p>;
  return (
    <>
    {reveal.error && <p className="mb-2 text-[12px] text-sq-down" role="alert">{reveal.error}</p>}
    <table className="w-full text-left text-[14px]">
      <thead>
        <tr className="border-b border-sq-line text-[12px] uppercase tracking-wide text-sq-muted">
          <th className="py-2 font-medium">Date</th>
          <th className="py-2 font-medium">Type</th>
          <th className="py-2 text-right font-medium">{tr('Amount', 'Montant')}</th>
          <th className="py-2 pl-4 font-medium">{tr('Status', 'Statut')}</th>
          <th className="py-2 text-right font-medium">{tr('Receipt', 'Justificatif')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-sq-line">
        {items.map((t) => (
          <tr key={t.id} className="hover:bg-sq-bg/50">
            <td className="num whitespace-nowrap py-3 text-sq-ink-2">{dateTime(t.createdAt)}</td>
            <td className="py-3">
              <Link to={`/wallet/tx/${t.id}`} className="font-medium hover:underline">
                {kindLabel(t.kind)}
              </Link>
              <span className="block text-[12px] text-sq-muted">{counterparty(t)}</span>
            </td>
            <td className="py-3 text-right">
              <SignedAmount t={t} />
            </td>
            <td className="py-3 pl-4">
              <StatusPill status={t.status} />
            </td>
            <td className="py-3 text-right">
              {t.status === 'confirmed' ? (
                <button type="button" onClick={() => void download(t)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60" aria-label={reveal.masked ? tr(`Download receipt ${t.reference} (shows amounts: passkey verification first)`, `Télécharger le justificatif ${t.reference} (affiche les montants : vérification par passkey d’abord)`) : tr(`Download receipt ${t.reference}`, `Télécharger le justificatif ${t.reference}`)}>
                  <Download size={18} strokeWidth={1.75} />
                </button>
              ) : (
                <span className="text-[12px] text-sq-muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
