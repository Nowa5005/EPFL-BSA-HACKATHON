import { useState } from 'react';
import { explorerAddress } from '@sq/shared';
import { cosigner, partner } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { Addr, Button, Card, Checks, cx, mmss, TxLink, useCountdown } from '../components/ui';
import { ActivityList } from '../components/ActivityList';
import { InternalShell } from '../components/InternalShell';

const TX_STATUS: Record<string, string> = {
  'awaiting-otp': 'Code client attendu',
  'awaiting-approval': 'Validation attendue',
  executing: 'Exécution',
  executed: 'Exécutée',
  rejected: 'Refusée',
  failed: 'Échouée',
  cancelled: 'Annulée',
};
const REC_STATUS: Record<string, string> = { 'pending-delay': 'Délai en cours', executing: 'Exécution', completed: 'Terminée', cancelled: 'Annulée', failed: 'Échouée' };

export default function Admin() {
  const { data, reload, error } = usePoll(() => cosigner.get('/admin/overview'), 3000);
  const sessions = usePoll(() => partner.get('/admin/sessions'), 5000);
  const [agent, setAgent] = useState('M. Keller — Conformité');

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    const note = decision === 'rejected' ? prompt('Motif communiqué au client (facultatif)') ?? undefined : undefined;
    await cosigner.post(`/admin/tx/${id}/decision`, { decision, agent, note });
    void reload();
  };

  const pending = (data?.txRequests ?? []).filter((r: any) => ['awaiting-otp', 'awaiting-approval'].includes(r.status));
  const recent = (data?.txRequests ?? []).filter((r: any) => !['awaiting-otp', 'awaiting-approval'].includes(r.status)).slice(0, 12);

  return (
    <InternalShell title="Console Swissquote" banner="Console interne Swissquote — simulation">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Back-office My Wall</h1>
        <div className="flex-1" />
        <label className="text-[14px] text-sq-muted">
          Connecté en tant que{' '}
          <select className="min-h-11 rounded-[10px] border border-sq-line bg-white px-2" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option>M. Keller — Conformité</option>
            <option>S. Rossi — Conformité</option>
          </select>
        </label>
      </div>
      {error && <p className="mb-4 text-[14px] text-sq-down">{error}</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Relais de frais (relayer)"
          value={data ? `${Number(data.relayer.eth ?? 0).toFixed(4)} ETH` : '—'}
          sub={
            <a className="hover:underline" href={explorerAddress(data?.relayer.address ?? '')} target="_blank" rel="noreferrer">
              <Addr a={data?.relayer.address} />
            </a>
          }
        />
        <Stat label="Clients My Wall" value={data?.clients.filter((c: any) => !c.headless).length ?? '—'} />
        <Stat label="Validations à quatre yeux" value={pending.length} warn={pending.length > 0} />
        <Stat label="Récupérations en délai" value={(data?.recoveries ?? []).filter((r: any) => r.status === 'pending-delay').length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-5">
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Validations à quatre yeux (opérations renforcées)</h2>
            {!pending.length && <Card className="text-[14px] text-sq-muted">Aucune opération en attente.</Card>}
            <div className="space-y-3">
              {pending.map((r: any) => (
                <PendingTx key={r.id} r={r} onDecide={decide} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Récupérations</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!(data?.recoveries ?? []).length && <div className="p-4 text-[14px] text-sq-muted">Aucune.</div>}
              {(data?.recoveries ?? []).slice(0, 8).map((r: any) => (
                <RecoveryRow key={r.id} r={r} />
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Décisions du partenaire de récupération</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!(sessions.data ?? []).some((s: any) => s.decision) && <div className="p-4 text-[14px] text-sq-muted">Aucune.</div>}
              {(sessions.data ?? [])
                .filter((s: any) => s.decision)
                .slice(0, 8)
                .map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                    <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', s.decision === 'released' ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-bad-50 text-sq-down')}>{s.decision === 'released' ? 'Libérée' : 'Refusée'}</span>
                    <span className="min-w-0 flex-1">
                      {s.clientId} · risque {s.riskScore}
                      {s.context?.actor === 'attacker' && <b className="text-sq-down"> · démo attaquant</b>}
                      <span className="block text-[12px] text-sq-muted">
                        {(s.factors ?? [])
                          .filter((f: any) => !f.ok)
                          .map((f: any) => f.factor)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="text-[12px] text-sq-muted">{new Date(s.createdAt).toLocaleTimeString('fr-CH')}</span>
                  </div>
                ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Opérations récentes</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!recent.length && <div className="p-4 text-[14px] text-sq-muted">Aucune.</div>}
              {recent.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                  <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', r.status === 'executed' ? 'bg-sq-ok-50 text-sq-up' : ['rejected', 'failed'].includes(r.status) ? 'bg-sq-bad-50 text-sq-down' : 'bg-sq-chip text-sq-ink-2')}>{TX_STATUS[r.status] ?? r.status}</span>
                  <span className="min-w-0 flex-1">
                    {r.summary}
                    <span className="block text-[12px] text-sq-muted">
                      {r.clientId} · niveau {r.policy.level === 'step-up' ? 'renforcé' : 'standard'}
                      {r.status === 'rejected' && ` · ${r.policy.reasons.join(' ; ')}`}
                    </span>
                  </span>
                  <TxLink hash={r.txHash}>tx</TxLink>
                </div>
              ))}
            </Card>
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Clients</h2>
            <div className="space-y-3">
              {(data?.clients ?? [])
                .filter((c: any) => !c.headless)
                .map((c: any) => (
                  <Card key={c.clientId} className="space-y-2 p-4 text-[14px]">
                    <div className="flex items-center justify-between">
                      <b>{c.name}</b>
                      <span className="text-[12px] text-sq-muted">{c.clientId}</span>
                    </div>
                    <div className="text-[12px] text-sq-muted">
                      Wallet{' '}
                      {c.safeAddress ? (
                        <a className="hover:underline" href={explorerAddress(c.safeAddress)} target="_blank" rel="noreferrer">
                          <Addr a={c.safeAddress} />
                        </a>
                      ) : (
                        '—'
                      )}{' '}
                      · appareils {c.devices.filter((d: any) => d.status === 'active').length}/2 · vue consolidée : <b>{{ full: 'complète', 'balance-only': 'solde', none: 'aucune' }[c.privacy as string]}</b>
                    </div>
                    <div className="text-[12px] text-sq-muted">Swissquote détient 1 clé sur 3 : il peut suspendre la co-signature, jamais déplacer les fonds.</div>
                    <Button
                      variant={c.frozen ? 'primary' : 'secondary'}
                      className="min-h-11 text-[14px]"
                      onClick={async () => {
                        await cosigner.post(`/admin/clients/${c.clientId}/freeze`, { frozen: !c.frozen });
                        void reload();
                      }}
                    >
                      {c.frozen ? 'Rétablir la co-signature' : 'Suspendre la co-signature'}
                    </Button>
                  </Card>
                ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">Journal d’audit (tous clients)</h2>
            <div className="max-h-[70vh] overflow-auto rounded-[12px]">
              <ActivityList items={(data?.activity ?? []).slice(0, 80)} showClient />
            </div>
          </section>
        </div>
      </div>
    </InternalShell>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: any; sub?: any; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[12px] text-sq-muted">{label}</div>
      <div className={cx('num mt-1 text-[20px] font-semibold', warn && 'text-sq-warn')}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-sq-muted">{sub}</div>}
    </Card>
  );
}

function PendingTx({ r, onDecide }: { r: any; onDecide: (id: string, d: 'approved' | 'rejected') => void }) {
  const left = useCountdown(r.coolingOffUntil);
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{r.summary}</div>
          <div className="text-[12px] text-sq-muted">
            {r.clientId} · {new Date(r.createdAt).toLocaleTimeString('fr-CH')}
          </div>
        </div>
        <span className="rounded-[4px] bg-sq-warn-50 px-1.5 py-0.5 text-[12px] font-semibold text-sq-warn">{TX_STATUS[r.status]}</span>
      </div>
      {r.warnings?.map((w: string) => (
        <div key={w} className="rounded-[8px] bg-sq-bad-50 p-2 text-[12px] text-sq-down">
          {w}
        </div>
      ))}
      <Checks checks={r.policy.checks} />
      <div className="text-[12px] text-sq-muted">
        Code email du client : {r.otpVerified ? 'confirmé' : 'en attente'} · Délai de réflexion : {r.coolingOffUntil ? (left > 0 ? mmss(left) : 'écoulé') : 'commence après le code'}
        {r.approval && ` · ${r.approval.decision === 'approved' ? 'validé' : 'refusé'} par ${r.approval.by}`}
      </div>
      {!r.approval && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="danger" onClick={() => onDecide(r.id, 'rejected')}>
            Refuser
          </Button>
          <Button onClick={() => onDecide(r.id, 'approved')}>Valider</Button>
        </div>
      )}
    </Card>
  );
}

function RecoveryRow({ r }: { r: any }) {
  const left = useCountdown(r.executeAfter);
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-[14px]">
      <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', r.status === 'completed' ? 'bg-sq-ok-50 text-sq-up' : r.status === 'pending-delay' ? 'bg-sq-warn-50 text-sq-warn' : 'bg-sq-chip text-sq-ink-2')}>{REC_STATUS[r.status] ?? r.status}</span>
      <span className="min-w-0 flex-1">
        {r.clientId} : <Addr a={r.oldDevice} /> → <Addr a={r.newDevice} />
        <span className="block text-[12px] text-sq-muted">
          score de risque partenaire {r.riskScore}
          {r.status === 'pending-delay' && ` · exécution dans ${mmss(left)}`}
        </span>
      </span>
      <TxLink hash={r.txHash}>tx</TxLink>
    </div>
  );
}
