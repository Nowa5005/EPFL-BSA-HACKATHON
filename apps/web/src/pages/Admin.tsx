import { useState, useSyncExternalStore } from 'react';
import { explorerAddress } from '@sq/shared';
import { bank, cosigner, partner } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { getComplianceSession, saveComplianceSession, subscribe } from '../lib/device';
import { locale, tr } from '../lib/i18n';
import { Addr, Button, Card, Checks, cx, Field, inputCls, MockBadge, mmss, SecretInput, Spinner, TxLink, useCountdown } from '../components/ui';
import { ActivityList } from '../components/ActivityList';
import { InternalShell } from '../components/InternalShell';
import { TermsAdminSection } from '../components/Terms';

const TX_STATUS: Record<string, string> = {
  'awaiting-otp': tr('Awaiting client code', 'Code client attendu'),
  'awaiting-approval': tr('Awaiting approval', 'Validation attendue'),
  executing: tr('Executing', 'Exécution'),
  executed: tr('Executed', 'Exécutée'),
  rejected: tr('Rejected', 'Refusée'),
  failed: tr('Failed', 'Échouée'),
  cancelled: tr('Cancelled', 'Annulée'),
};
const REC_STATUS: Record<string, string> = {
  'pending-delay': tr('Delay running', 'Délai en cours'),
  executing: tr('Executing', 'Exécution'),
  completed: tr('Completed', 'Terminée'),
  cancelled: tr('Cancelled', 'Annulée'),
  failed: tr('Failed', 'Échouée'),
};
const AGENTS = [tr('M. Keller — Compliance', 'M. Keller — Conformité'), tr('S. Rossi — Compliance', 'S. Rossi — Conformité')];

/** The console needs a back-office session (role "compliance", DEMO user `compliance`); client sessions are refused. */
export default function Admin() {
  const session = useSyncExternalStore(subscribe, () => getComplianceSession()?.token ?? null);
  if (!session) return <ComplianceLogin />;
  return <Console />;
}

function ComplianceLogin() {
  const [username, setUsername] = useState('compliance');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await bank.post('/login', { username, password });
      if (r.role !== 'compliance') throw new Error(tr('This account has no access to the compliance console.', 'Ce compte n’a pas accès à la console de conformité.'));
      saveComplianceSession({ token: r.token, name: r.profile?.name ?? 'Compliance' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <InternalShell title={tr('Swissquote console', 'Console Swissquote')} banner={tr('Swissquote internal console — simulation', 'Console interne Swissquote — simulation')}>
      <Card className="mx-auto max-w-[420px]">
        <h1 className="text-[20px] font-semibold">{tr('Compliance sign-in', 'Connexion conformité')}</h1>
        <p className="mt-1 text-[14px] text-sq-muted">
          {tr('Back-office staff only.', 'Réservé au personnel du back-office.')} <MockBadge label="DEMO" />
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={tr('Username', 'Identifiant')} hint={tr('Demo compliance user: compliance', 'Utilisateur conformité de démo : compliance')}>
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          <Field label={tr('Password', 'Mot de passe')} hint={tr('Any password in this prototype', 'N’importe quel mot de passe dans ce prototype')} error={err || undefined}>
            <SecretInput value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
          <Button type="submit" disabled={busy || !password}>
            {busy ? <Spinner /> : tr('Sign in', 'Se connecter')}
          </Button>
        </form>
      </Card>
    </InternalShell>
  );
}

function Console() {
  const { data, reload, error } = usePoll(() => cosigner.get('/admin/overview'), 3000);
  const sessions = usePoll(() => partner.get('/admin/sessions'), 5000);
  const [agent, setAgent] = useState(AGENTS[0]);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    const note = decision === 'rejected' ? prompt(tr('Reason shared with the client (optional)', 'Motif communiqué au client (facultatif)')) ?? undefined : undefined;
    await cosigner.post(`/admin/tx/${id}/decision`, { decision, agent, note });
    void reload();
  };

  const pending = (data?.txRequests ?? []).filter((r: any) => ['awaiting-otp', 'awaiting-approval'].includes(r.status));
  const recent = (data?.txRequests ?? []).filter((r: any) => !['awaiting-otp', 'awaiting-approval'].includes(r.status)).slice(0, 12);

  return (
    <InternalShell title={tr('Swissquote console', 'Console Swissquote')} banner={tr('Swissquote internal console — simulation', 'Console interne Swissquote — simulation')}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Back-office My Wall</h1>
        <div className="flex-1" />
        <label className="text-[14px] text-sq-muted">
          {tr('Signed in as', 'Connecté en tant que')}{' '}
          <select className="min-h-11 rounded-[10px] border border-sq-line bg-sq-surface px-2" value={agent} onChange={(e) => setAgent(e.target.value)}>
            {AGENTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <Button variant="ghost" className="w-auto" onClick={() => saveComplianceSession(null)}>
          {tr('Sign out', 'Se déconnecter')}
        </Button>
      </div>
      {error && <p className="mb-4 text-[14px] text-sq-down">{error}</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={tr('Fee relayer', 'Relais de frais (relayer)')}
          value={data ? `${Number(data.relayer.eth ?? 0).toFixed(4)} ETH` : '—'}
          sub={
            <a className="hover:underline" href={explorerAddress(data?.relayer.address ?? '')} target="_blank" rel="noreferrer">
              <Addr a={data?.relayer.address} />
            </a>
          }
        />
        <Stat label={tr('My Wall clients', 'Clients My Wall')} value={data?.clients.filter((c: any) => !c.headless).length ?? '—'} />
        <Stat label={tr('Four-eyes approvals', 'Validations à quatre yeux')} value={pending.length} warn={pending.length > 0} />
        <Stat label={tr('Recoveries in delay', 'Récupérations en délai')} value={(data?.recoveries ?? []).filter((r: any) => r.status === 'pending-delay').length} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-5">
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Four-eyes approvals (enhanced operations)', 'Validations à quatre yeux (opérations renforcées)')}</h2>
            {!pending.length && <Card className="text-[14px] text-sq-muted">{tr('No pending operations.', 'Aucune opération en attente.')}</Card>}
            <div className="space-y-3">
              {pending.map((r: any) => (
                <PendingTx key={r.id} r={r} onDecide={decide} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Recoveries', 'Récupérations')}</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!(data?.recoveries ?? []).length && <div className="p-4 text-[14px] text-sq-muted">{tr('None.', 'Aucune.')}</div>}
              {(data?.recoveries ?? []).slice(0, 8).map((r: any) => (
                <RecoveryRow key={r.id} r={r} />
              ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Recovery partner decisions', 'Décisions du partenaire de récupération')}</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!(sessions.data ?? []).some((s: any) => s.decision) && <div className="p-4 text-[14px] text-sq-muted">{tr('None.', 'Aucune.')}</div>}
              {(sessions.data ?? [])
                .filter((s: any) => s.decision)
                .slice(0, 8)
                .map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                    <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', s.decision === 'released' ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-bad-50 text-sq-down')}>{s.decision === 'released' ? tr('Released', 'Libérée') : tr('Refused', 'Refusée')}</span>
                    <span className="min-w-0 flex-1">
                      {s.clientId} · {tr('risk', 'risque')} {s.riskScore}
                      {s.context?.actor === 'attacker' && <b className="text-sq-down"> · {tr('attacker demo', 'démo attaquant')}</b>}
                      <span className="block text-[12px] text-sq-muted">
                        {(s.factors ?? [])
                          .filter((f: any) => !f.ok)
                          .map((f: any) => f.factor)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="text-[12px] text-sq-muted">{new Date(s.createdAt).toLocaleTimeString(locale(), { timeZone: 'Europe/Zurich' })}</span>
                  </div>
                ))}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Recent operations', 'Opérations récentes')}</h2>
            <Card className="divide-y divide-sq-line p-0">
              {!recent.length && <div className="p-4 text-[14px] text-sq-muted">{tr('None.', 'Aucune.')}</div>}
              {recent.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                  <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', r.status === 'executed' ? 'bg-sq-ok-50 text-sq-up' : ['rejected', 'failed'].includes(r.status) ? 'bg-sq-bad-50 text-sq-down' : 'bg-sq-chip text-sq-ink-2')}>{TX_STATUS[r.status] ?? r.status}</span>
                  <span className="min-w-0 flex-1">
                    {r.summary}
                    <span className="block text-[12px] text-sq-muted">
                      {r.clientId} · {tr('level', 'niveau')} {r.policy.level === 'step-up' ? tr('enhanced', 'renforcé') : tr('standard', 'standard')}
                      {r.status === 'rejected' && ` · ${r.policy.reasons.join(' ; ')}`}
                    </span>
                  </span>
                  <TxLink hash={r.txHash}>tx</TxLink>
                </div>
              ))}
            </Card>
          </section>

          <DuressSection />
          <TravelRuleSection />

          <TermsAdminSection />
        </div>

        <div className="min-w-0 space-y-5">
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Clients', 'Clients')}</h2>
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
                      · {tr('devices', 'appareils')} {c.devices.filter((d: any) => d.status === 'active').length}/2 · {tr('consolidated view:', 'vue consolidée :')}{' '}
                      <b>{{ full: tr('full', 'complète'), 'balance-only': tr('balance', 'solde'), none: tr('none', 'aucune') }[c.privacy as string]}</b>
                    </div>
                    <div className="text-[12px] text-sq-muted">{tr('Swissquote holds 1 key out of 3: it can suspend co-signing, never move the funds.', 'Swissquote détient 1 clé sur 3 : il peut suspendre la co-signature, jamais déplacer les fonds.')}</div>
                    <Button
                      variant={c.frozen ? 'primary' : 'secondary'}
                      className="min-h-11 text-[14px]"
                      onClick={async () => {
                        await cosigner.post(`/admin/clients/${c.clientId}/freeze`, { frozen: !c.frozen });
                        void reload();
                      }}
                    >
                      {c.frozen ? tr('Restore co-signing', 'Rétablir la co-signature') : tr('Suspend co-signing', 'Suspendre la co-signature')}
                    </Button>
                  </Card>
                ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-[17px] font-semibold">{tr('Audit log (all clients)', 'Journal d’audit (tous clients)')}</h2>
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
            {r.clientId} · {new Date(r.createdAt).toLocaleTimeString(locale(), { timeZone: 'Europe/Zurich' })}
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
        {tr('Client email code:', 'Code email du client :')} {r.otpVerified ? tr('confirmed', 'confirmé') : tr('pending', 'en attente')} · {tr('Cooling-off period:', 'Délai de réflexion :')}{' '}
        {r.coolingOffUntil ? (left > 0 ? mmss(left) : tr('elapsed', 'écoulé')) : tr('starts after the code', 'commence après le code')}
        {r.approval &&
          ` · ${r.approval.decision === 'approved' ? tr(`approved by ${r.approval.by}`, `validé par ${r.approval.by}`) : tr(`rejected by ${r.approval.by}`, `refusé par ${r.approval.by}`)}`}
      </div>
      {!r.approval && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="danger" onClick={() => onDecide(r.id, 'rejected')}>
            {tr('Reject', 'Refuser')}
          </Button>
          <Button onClick={() => onDecide(r.id, 'approved')}>{tr('Approve', 'Valider')}</Button>
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
          {tr('partner risk score', 'score de risque partenaire')} {r.riskScore}
          {r.status === 'pending-delay' && ` · ${tr(`executes in ${mmss(left)}`, `exécution dans ${mmss(left)}`)}`}
        </span>
      </span>
      <TxLink hash={r.txHash}>tx</TxLink>
    </div>
  );
}

/** #16 — Duress alerts: a client typed the duress code (co-signing was frozen silently). Never shown to the client. */
function DuressSection() {
  const { data, error, reload } = usePoll<any[]>(() => cosigner.get('/admin/duress'), 5000);
  const [busy, setBusy] = useState<string | null>(null);
  const open = (data ?? []).filter((a) => a.status === 'open');
  return (
    <section>
      <h2 className="mb-2 text-[17px] font-semibold">
        {tr('Duress alerts', 'Alertes de contrainte')} {open.length > 0 && <span className="ml-1 rounded-full bg-sq-down px-2 py-0.5 text-[12px] font-semibold text-white">{open.length}</span>}
      </h2>
      <Card className="space-y-2 p-4 text-[13px]">
        {error && <div className="text-sq-down">{error}</div>}
        {!data?.length && <div className="text-sq-muted">{tr('No duress alert.', 'Aucune alerte de contrainte.')}</div>}
        {data?.map((a) => (
          <div key={a.id} className={cx('rounded-[10px] border p-3', a.status === 'open' ? 'border-sq-down/40 bg-sq-bad-50' : 'border-sq-line')}>
            <div className="font-medium">
              {a.status === 'open' ? tr('DURESS — client may be under threat', 'CONTRAINTE — client possiblement menacé') : tr('Resolved', 'Résolue')} · {a.clientName ?? a.clientId} ({a.clientId})
            </div>
            <div className="text-[12px] text-sq-muted">
              {tr('Duress code used', 'Code de contrainte utilisé')} {new Date(a.at).toLocaleString(locale(), { timeZone: 'Europe/Zurich' })}
              {a.count > 1 && ` · ${a.count}× (${tr('last', 'dernier')} ${new Date(a.lastAt).toLocaleString(locale(), { timeZone: 'Europe/Zurich' })})`} · {a.frozen ? tr('co-signing frozen', 'co-signature gelée') : tr('not frozen any more', 'plus gelée')}
              {a.resolvedAt && ` · ${tr('resolved', 'résolue')} ${new Date(a.resolvedAt).toLocaleString(locale(), { timeZone: 'Europe/Zurich' })} — ${a.note ?? ''}`}
            </div>
            <p className="mt-1 text-[12px]">
              {tr(
                'The client saw a decoy wallet. Procedure: contact the client through a verified channel without revealing the alert, involve security / police if needed; lift the freeze (Clients section) only once the client is safe.',
                'Le client a vu un wallet leurre. Procédure : contacter le client par un canal vérifié sans révéler l’alerte, impliquer la sécurité / la police si nécessaire ; lever le gel (section Clients) seulement quand le client est en sécurité.',
              )}
            </p>
            {a.status === 'open' && (
              <Button
                variant="secondary"
                className="mt-2 min-h-9 w-auto px-3 text-[13px]"
                disabled={busy === a.id}
                onClick={async () => {
                  setBusy(a.id);
                  try {
                    await cosigner.post(`/admin/duress/${a.id}/resolve`, { note: tr('Client contacted, situation resolved', 'Client contacté, situation résolue') });
                    await reload();
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {tr('Mark as resolved', 'Marquer comme résolue')}
              </Button>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}

/** Travel Rule records (beneficiary data — compliance role only) and the decision audit trail (no personal data). */
function TravelRuleSection() {
  const { data, error } = usePoll(() => cosigner.get('/admin/travel-rule'), 10000);
  return (
    <section>
      <h2 className="mb-2 text-[17px] font-semibold">{tr('Travel Rule — third-party transfers', 'Travel Rule — transferts à des tiers')}</h2>
      <Card className="space-y-2 p-4 text-[13px]">
        {error && <div className="text-sq-down">{error}</div>}
        {data && (
          <p className="text-sq-muted">
            {tr('Rules', 'Règles')} {data.config.version} · {tr('threshold', 'seuil')} {data.config.thresholdChf} CHF ({tr('inclusive', 'inclus')}) · {data.config.linkedWindowDays} {tr('days linked', 'jours liés')} ·{' '}
            {tr('transmission', 'transmission')}: {data.config.transmissionIntegration ?? '—'}
          </p>
        )}
        {!data?.records?.length && <div className="text-sq-muted">{tr('No third-party transfer recorded.', 'Aucun transfert à un tiers enregistré.')}</div>}
        {data?.records?.map((r: any) => {
          const b = r.declaration?.beneficiary ?? {};
          return (
            <div key={r.id} className="border-t border-sq-line pt-2">
              <div className="font-medium">
                {r.amount} {r.asset} → {b.name} <span className="font-mono text-[12px] text-sq-muted"><Addr a={r.recipient} /></span>
              </div>
              <div className="text-[12px] text-sq-muted">
                {r.clientId} · {new Date(r.createdAt).toLocaleString(locale(), { timeZone: 'Europe/Zurich' })} · {r.chf === null ? tr('CHF value unknown', 'contre-valeur inconnue') : `≈ ${r.chf} CHF`} · {b.walletType === 'hosted' ? `${tr('hosted', 'hébergé')} (${b.providerName})` : tr('personal wallet', 'wallet personnel')}
                {b.country && ` · ${[b.street, b.postcode, b.city, b.country].filter(Boolean).join(', ')} · ${b.relationship} · ${b.purpose}`} · {r.requestStatus ?? '—'} · {tr('kept until', 'conservé jusqu’au')} {r.retainUntil.slice(0, 10)}
              </div>
              <div className="text-[12px]">
                Travel Rule:{' '}
                {r.route === 'vasp'
                  ? `${tr('transmitted to', 'transmis à')} ${r.vasp?.name} — ${r.trp?.status ?? tr('not sent', 'non envoyé')}${r.trp?.reference ? ` · ref ${r.trp.reference}` : ''}${r.trp?.reasonCode ? ` · ${r.trp.reasonCode}` : ''}${r.trp?.responseVerified ? ` · ${tr('signed answer verified', 'réponse signée vérifiée')}` : ''}`
                  : r.route === 'self-hosted-proof'
                    ? tr('personal wallet — ownership proven (EIP-191 signature)', 'wallet personnel — propriété prouvée (signature EIP-191)')
                    : r.route === 'self-hosted-declaration'
                      ? tr('personal wallet — client declaration (below threshold)', 'wallet personnel — déclaration du client (sous le seuil)')
                      : r.demo
                        ? tr('legacy demo mode — not transmitted', 'ancien mode démo — non transmis')
                        : '—'}
              </div>
            </div>
          );
        })}
        {!!data?.audit?.length && (
          <details>
            <summary className="cursor-pointer text-sq-muted">{tr('Decision audit trail (no personal data)', 'Journal des décisions (sans données personnelles)')} — {data.audit.length}</summary>
            <ul className="mt-1 space-y-1 font-mono text-[11px]">
              {data.audit.slice(0, 50).map((a: any) => (
                <li key={a.id}>
                  {a.at} {a.stage} {a.clientId} {a.ruleVersion} {a.category} chf={a.chfValue ?? 'null'} rate={a.rate ? `${a.rate.chf}@${a.rate.asOf}` : a.rateIssue} agg={a.aggregateChf ?? 'null'} enh={String(a.enhancedRequired)} missing=[{a.missingFields.join(',')}] {a.route ? `route=${a.route}` : ''} {a.trp ? `trp=${a.trp.status}${a.trp.reference ? `/${a.trp.reference}` : ''}${a.trp.reasonCode ? `/${a.trp.reasonCode}` : ''} req=${a.trp.requestIdentifier.slice(0, 8)}` : ''} {a.demo ? 'DEMO(legacy)' : ''} → {a.decision}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </section>
  );
}
