import { useState } from 'react';
import { explorerAddress } from '@sq/shared';
import { cosigner, partner } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { Addr, Button, Card, Checks, cx, mmss, MockBadge, Shell, TxLink, useCountdown } from '../components/ui';
import { ActivityList } from './Activity';

export default function Admin() {
  const { data, reload, error } = usePoll(() => cosigner.get('/admin/overview'), 3000);
  const sessions = usePoll(() => partner.get('/admin/sessions'), 5000);
  const [agent, setAgent] = useState('M. Keller — Compliance');

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    const note = decision === 'rejected' ? prompt('Reason for the client (optional)') ?? undefined : undefined;
    await cosigner.post(`/admin/tx/${id}/decision`, { decision, agent, note });
    void reload();
  };

  const pending = (data?.txRequests ?? []).filter((r: any) => ['awaiting-otp', 'awaiting-approval'].includes(r.status));
  const recent = (data?.txRequests ?? []).filter((r: any) => !['awaiting-otp', 'awaiting-approval'].includes(r.status)).slice(0, 12);

  return (
    <Shell wide>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Swissquote back-office</h1>
        <MockBadge label="Mock admin console" />
        <div className="flex-1" />
        <label className="text-sm text-navy-700/70">
          Signed in as{' '}
          <select className="rounded-lg border border-navy-100 bg-white px-2 py-1" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option>M. Keller — Compliance</option>
            <option>S. Rossi — Compliance</option>
          </select>
        </label>
      </div>
      {error && <p className="mb-4 text-sm text-bad-600">{error}</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Relayer (gas sponsor)" value={data ? `${Number(data.relayer.eth ?? 0).toFixed(4)} ETH` : '—'} sub={<a className="hover:underline" href={explorerAddress(data?.relayer.address ?? '')} target="_blank" rel="noreferrer"><Addr a={data?.relayer.address} /></a>} />
        <Stat label="Wallet clients" value={data?.clients.length ?? '—'} />
        <Stat label="Awaiting four-eyes" value={pending.length} tone={pending.length ? 'warn' : undefined} />
        <Stat label="Recoveries in delay" value={(data?.recoveries ?? []).filter((r: any) => r.status === 'pending-delay').length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <section>
            <h2 className="mb-2 font-semibold">Four-eyes approvals (reinforced transactions)</h2>
            {!pending.length && <Card className="text-sm text-navy-700/60">No transaction waiting for approval.</Card>}
            <div className="space-y-3">
              {pending.map((r: any) => (
                <PendingTx key={r.id} r={r} onDecide={decide} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Recoveries</h2>
            <Card className="divide-y divide-navy-100 p-0">
              {!(data?.recoveries ?? []).length && <div className="p-4 text-sm text-navy-700/60">None.</div>}
              {(data?.recoveries ?? []).slice(0, 8).map((r: any) => (
                <RecoveryRow key={r.id} r={r} />
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Recovery partner decisions <MockBadge label="Partner log" /></h2>
            <Card className="divide-y divide-navy-100 p-0">
              {!(sessions.data ?? []).some((s: any) => s.decision) && <div className="p-4 text-sm text-navy-700/60">None.</div>}
              {(sessions.data ?? []).filter((s: any) => s.decision).slice(0, 8).map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', s.decision === 'released' ? 'bg-ok-50 text-ok-600' : 'bg-bad-50 text-bad-600')}>{s.decision}</span>
                  <span className="flex-1">
                    {s.clientId} · risk {s.riskScore}
                    {s.context?.actor === 'attacker' && <b className="text-bad-600"> · attacker demo</b>}
                    <span className="block text-xs text-navy-700/60">{(s.factors ?? []).filter((f: any) => !f.ok).map((f: any) => f.factor).join(' · ')}</span>
                  </span>
                  <span className="text-xs text-navy-700/60">{new Date(s.createdAt).toLocaleTimeString('de-CH')}</span>
                </div>
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Recent transactions</h2>
            <Card className="divide-y divide-navy-100 p-0">
              {!recent.length && <div className="p-4 text-sm text-navy-700/60">None.</div>}
              {recent.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', r.status === 'executed' ? 'bg-ok-50 text-ok-600' : r.status === 'rejected' || r.status === 'failed' ? 'bg-bad-50 text-bad-600' : 'bg-navy-100 text-navy-800')}>{r.status}</span>
                  <span className="flex-1">
                    {r.summary}
                    <span className="block text-xs text-navy-700/60">
                      {r.clientId} · {r.policy.level}
                      {r.status === 'rejected' && ` · ${r.policy.reasons.join('; ')}`}
                    </span>
                  </span>
                  <TxLink hash={r.txHash}>tx</TxLink>
                </div>
              ))}
            </Card>
          </section>
        </div>

        <div className="space-y-5">
          <section>
            <h2 className="mb-2 font-semibold">Clients</h2>
            <div className="space-y-3">
              {(data?.clients ?? []).filter((c: any) => !c.headless).map((c: any) => (
                <Card key={c.clientId} className="space-y-2 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <b>{c.name}</b>
                    <span className="text-xs text-navy-700/60">{c.clientId}</span>
                  </div>
                  <div className="text-xs text-navy-700/70">
                    Wallet {c.safeAddress ? <a className="hover:underline" href={explorerAddress(c.safeAddress)} target="_blank" rel="noreferrer"><Addr a={c.safeAddress} /></a> : '—'} · devices {c.devices.filter((d: any) => d.status === 'active').length}/2 · privacy: <b>{c.privacy}</b>
                  </div>
                  <div className="text-xs text-navy-700/70">Swissquote holds 1 of 3 keys: it can freeze co-signing, never move funds.</div>
                  <Button
                    variant={c.frozen ? 'primary' : 'secondary'}
                    className="min-h-9 py-1.5 text-sm"
                    onClick={async () => {
                      await cosigner.post(`/admin/clients/${c.clientId}/freeze`, { frozen: !c.frozen });
                      void reload();
                    }}
                  >
                    {c.frozen ? 'Unfreeze co-signing' : 'Freeze co-signing'}
                  </Button>
                </Card>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Audit log (all clients)</h2>
            <div className="max-h-[70vh] overflow-auto rounded-2xl">
              <ActivityList items={(data?.activity ?? []).slice(0, 80)} />
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: any; sub?: any; tone?: 'warn' }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-navy-700/70">{label}</div>
      <div className={cx('num mt-1 text-xl font-semibold', tone === 'warn' && 'text-warn-600')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-navy-700/60">{sub}</div>}
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
          <div className="text-xs text-navy-700/60">
            {r.clientId} · {new Date(r.createdAt).toLocaleTimeString('de-CH')}
          </div>
        </div>
        <span className="rounded-full bg-warn-50 px-2 py-0.5 text-xs font-semibold text-warn-600">{r.status}</span>
      </div>
      {r.warnings?.map((w: string) => (
        <div key={w} className="rounded-lg bg-bad-50 p-2 text-xs text-bad-600">
          ⚠️ {w}
        </div>
      ))}
      <Checks checks={r.policy.checks} />
      <div className="text-xs text-navy-700/70">
        Client email code: {r.otpVerified ? '✓ confirmed' : 'pending'} · Cooling-off: {r.coolingOffUntil ? (left > 0 ? mmss(left) : 'over') : 'starts after code'}
        {r.approval && ` · ${r.approval.decision} by ${r.approval.by}`}
      </div>
      {!r.approval && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="danger" onClick={() => onDecide(r.id, 'rejected')}>
            Reject
          </Button>
          <Button onClick={() => onDecide(r.id, 'approved')}>Approve</Button>
        </div>
      )}
    </Card>
  );
}

function RecoveryRow({ r }: { r: any }) {
  const left = useCountdown(r.executeAfter);
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', r.status === 'completed' ? 'bg-ok-50 text-ok-600' : r.status === 'pending-delay' ? 'bg-warn-50 text-warn-600' : 'bg-navy-100 text-navy-800')}>{r.status}</span>
      <span className="flex-1">
        {r.clientId}: <Addr a={r.oldDevice} /> → <Addr a={r.newDevice} />
        <span className="block text-xs text-navy-700/60">partner risk score {r.riskScore}{r.status === 'pending-delay' && ` · executes in ${mmss(left)}`}</span>
      </span>
      <TxLink hash={r.txHash}>tx</TxLink>
    </div>
  );
}
