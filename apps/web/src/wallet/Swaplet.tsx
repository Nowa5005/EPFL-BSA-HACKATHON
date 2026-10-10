// Swaplet: My Wall's space for exchanges and receipts. Assumption for the demo (role not yet defined):
// "Documents" is complete; "Échanger" is shown as coming in the next version.

import { useMemo, useState } from 'react';
import { ChevronLeft, Download, Eye, FileText, RefreshCw, Search } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll, type WalletTxView } from '../lib/hooks';
import { buildReceipt, downloadReceiptPdf, ReceiptView } from '../lib/receipt';
import { Button, Card, cx, dateOnly, fmt, inputCls, Notice, Pill, Skeleton, Tabs, useMedia } from '../components/ui';
import { kindLabel } from './TxList';
import Swap from './Swap';

interface Doc {
  docId: string;
  reference: string;
  tx: WalletTxView;
}

const PERIODS = [
  { id: 'all', label: 'Tout' },
  { id: 'month', label: 'Ce mois' },
  { id: '3m', label: '3 mois' },
  { id: 'year', label: 'Année' },
  { id: 'custom', label: 'Personnalisée' },
];

export default function Swaplet() {
  const [tab, setTab] = useState<'docs' | 'swap'>('docs');
  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">Swaplet</h1>
      <p className="mb-3 text-[14px] text-sq-muted">Vos échanges et vos justificatifs de transaction.</p>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'docs', label: 'Documents' },
          {
            id: 'swap',
            label: (
              <span className="inline-flex items-center gap-1.5">
                Échanger <span className="rounded-[4px] bg-sq-chip px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sq-muted">Démo</span>
              </span>
            ),
          },
        ]}
      />
      <div className="mt-4">{tab === 'docs' ? <Documents /> : <Swap />}</div>
    </div>
  );
}

function Documents() {
  const { device, session } = useLocal();
  const isDesktop = useMedia('(min-width: 1024px)');
  const { data, error, loading, reload } = usePoll<Doc[]>(() => cosigner.get(`/clients/${device!.clientId}/documents`), 6000, [device?.clientId]);
  const [q, setQ] = useState('');
  const [asset, setAsset] = useState('all');
  const [type, setType] = useState('all');
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const name = session?.profile?.name ?? '';

  const filtered = useMemo(() => {
    const now = new Date();
    const since =
      period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : period === '3m' ? new Date(now.getTime() - 90 * 864e5) : period === 'year' ? new Date(now.getFullYear(), 0, 1) : null;
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((d) => {
      const t = d.tx;
      const when = new Date(t.confirmedAt ?? t.createdAt);
      if (asset !== 'all' && t.asset !== asset) return false;
      if (type !== 'all' && t.kind !== type) return false;
      if (since && when < since) return false;
      if (period === 'custom' && ((from && when < new Date(from)) || (to && when > new Date(`${to}T23:59:59`)))) return false;
      if (needle && ![d.reference, t.amount, t.from, t.to, t.txHash ?? '', t.counterpartyName ?? ''].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data, q, asset, type, period, from, to]);

  const groups = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of filtered) {
      const when = new Date(d.tx.confirmedAt ?? d.tx.createdAt);
      const key = when.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
      m.set(key, [...(m.get(key) ?? []), d]);
    }
    return [...m.entries()];
  }, [filtered]);

  const current = filtered.find((d) => d.docId === selected) ?? null;
  const download = async (d: Doc) => {
    setDlError(null);
    try {
      await downloadReceiptPdf(buildReceipt(d.tx, name));
    } catch (e: any) {
      setDlError(d.docId);
    }
  };

  if (error && !data)
    return (
      <Notice tone="bad" title="Impossible de charger les documents">
        {error}
        <Button variant="secondary" className="mt-2 w-auto px-4" onClick={reload}>
          <RefreshCw size={16} strokeWidth={1.75} /> Réessayer
        </Button>
      </Notice>
    );

  const filters = (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Rechercher</span>
        <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sq-muted" />
        <input className={cx(inputCls, 'pl-10')} placeholder="Référence, montant, adresse…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', 'USDC', 'ETH'].map((a) => (
          <Pill key={a} active={asset === a} onClick={() => setAsset(a)}>
            {a === 'all' ? 'Tous actifs' : a}
          </Pill>
        ))}
        {[
          ['all', 'Tous types'],
          ['receive', 'Réception'],
          ['send', 'Envoi'],
          ['swap', 'Échange'],
        ].map(([id, l]) => (
          <Pill key={id} active={type === id} onClick={() => setType(id)}>
            {l}
          </Pill>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <Pill key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Pill>
        ))}
      </div>
      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" />
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" />
        </div>
      )}
    </div>
  );

  const list = loading && !data ? (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  ) : !(data ?? []).length ? (
    <p className="py-10 text-center text-[14px] text-sq-muted">Aucun justificatif pour l'instant. Ils apparaîtront ici après votre première transaction.</p>
  ) : !filtered.length ? (
    <p className="py-10 text-center text-[14px] text-sq-muted">Aucun document ne correspond à ces critères.</p>
  ) : (
    <div className="space-y-5">
      {groups.map(([month, docs]) => (
        <section key={month}>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-sq-muted">{month}</h3>
          <ul className="divide-y divide-sq-line">
            {docs.map((d) => (
              <li key={d.docId} className={cx('flex items-center gap-3 py-2.5', selected === d.docId && isDesktop && 'bg-sq-bg/70')}>
                <FileText size={20} strokeWidth={1.75} className="shrink-0 text-sq-ink-2" />
                <button type="button" onClick={() => setSelected(d.docId)} className="min-w-0 flex-1 text-left">
                  <span className="block text-[14px] font-medium">
                    {kindLabel(d.tx.kind)} · {fmt(Number(d.tx.amount), d.tx.asset === 'ETH' ? 5 : 2)} {d.tx.asset}
                    {d.tx.simulated && <span className="ml-1 text-[12px] font-normal text-sq-muted">(simulée)</span>}
                  </span>
                  <span className="block text-[12px] text-sq-muted">
                    {dateOnly(d.tx.confirmedAt ?? d.tx.createdAt)} · <span className="font-mono">{d.reference}</span>
                  </span>
                  {dlError === d.docId && <span className="block text-[12px] text-sq-down">Téléchargement impossible.</span>}
                </button>
                <button type="button" onClick={() => setSelected(d.docId)} aria-label={`Aperçu ${d.reference}`} className="flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60">
                  <Eye size={18} strokeWidth={1.75} />
                </button>
                <button type="button" onClick={() => download(d)} aria-label={dlError === d.docId ? `Réessayer ${d.reference}` : `Télécharger ${d.reference}`} className="flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60">
                  {dlError === d.docId ? <RefreshCw size={18} strokeWidth={1.75} /> : <Download size={18} strokeWidth={1.75} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  if (isDesktop)
    return (
      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-7 space-y-4">
          {filters}
          {list}
        </Card>
        <div className="col-span-5">
          {current ? (
            <div className="sticky top-24 space-y-3">
              <ReceiptView r={buildReceipt(current.tx, name)} />
              <Button onClick={() => download(current)}>
                <Download size={18} strokeWidth={1.75} /> Télécharger le PDF
              </Button>
            </div>
          ) : (
            <Card className="text-[14px] text-sq-muted">Sélectionnez un document pour l'aperçu.</Card>
          )}
        </div>
      </div>
    );

  if (current)
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-sq-ink-2">
          <ChevronLeft size={18} strokeWidth={1.75} /> Documents
        </button>
        <ReceiptView r={buildReceipt(current.tx, name)} />
        <Button onClick={() => download(current)}>
          <Download size={18} strokeWidth={1.75} /> Télécharger
        </Button>
      </div>
    );

  return (
    <Card className="space-y-4">
      {filters}
      {list}
    </Card>
  );
}
