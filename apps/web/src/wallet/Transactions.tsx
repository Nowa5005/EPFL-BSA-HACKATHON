import { useSearchParams } from 'react-router-dom';
import { useLocal, useWalletTxs } from '../lib/hooks';
import { Card, Pill, useMedia } from '../components/ui';
import { TxListCompact, TxTable } from './TxList';

const STATUS = [
  { id: 'all', label: 'Tout' },
  { id: 'pending', label: 'En attente' },
  { id: 'confirmed', label: 'Confirmées' },
  { id: 'failed', label: 'Échouées' },
];
const KIND = [
  { id: 'all', label: 'Tous types' },
  { id: 'receive', label: 'Réceptions' },
  { id: 'send', label: 'Envois' },
];

export default function Transactions() {
  const { session } = useLocal();
  const { data, loading } = useWalletTxs(4000);
  const [params, setParams] = useSearchParams();
  const isDesktop = useMedia('(min-width: 1024px)');
  const status = params.get('status') ?? 'all';
  const kind = params.get('type') ?? 'all';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };
  const items = (data ?? []).filter((t) => (status === 'all' || (status === 'pending' ? t.status === 'pending' || t.status === 'detected' : t.status === status)) && (kind === 'all' || t.kind === kind));

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">Transactions</h1>
      <p className="mb-4 text-[14px] text-sq-muted">Statuts : détectée → en attente → confirmée (ou échouée). Confirmée = incluse dans un bloc Ethereum.</p>
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {STATUS.map((s) => (
          <Pill key={s.id} active={status === s.id} onClick={() => set('status', s.id)}>
            {s.label}
          </Pill>
        ))}
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {KIND.map((s) => (
          <Pill key={s.id} active={kind === s.id} onClick={() => set('type', s.id)}>
            {s.label}
          </Pill>
        ))}
      </div>
      <Card>{isDesktop ? <TxTable items={items} clientName={session?.profile?.name ?? ''} loading={loading && !data} /> : <TxListCompact items={items} loading={loading && !data} />}</Card>
    </div>
  );
}
