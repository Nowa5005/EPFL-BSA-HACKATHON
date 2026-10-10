// Shared "review → Touch ID → co-signature → confirmed" flow for any Safe transaction.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, ShieldAlert, TriangleAlert } from 'lucide-react';
import { MOCK_USDC_CHF, signSafeTx, type SafeTx } from '@sq/shared';
import { cosigner, ApiError } from '../lib/api';
import { passkeyAssertion, unlockedKey } from '../lib/device';
import { useEnsureUnlocked, useLocal, usePoll, type WalletTxView } from '../lib/hooks';
import { Button, Card, Checks, cx, Field, fmt, inputCls, mmss, MockBadge, Notice, ProgressList, Spinner, TxLink, useCountdown, Why } from './ui';
import { CheckDisc, ConfirmedCard, PendingIndicator } from './Confirm';

type Phase =
  | { k: 'loading' }
  | { k: 'review'; prep: any }
  | { k: 'signing'; prep: any; stage: number }
  | { k: 'executed'; prep: any; txHash: string }
  | { k: 'step-up'; prep: any; requestId: string }
  | { k: 'rejected'; prep: any; policy: any; message: string }
  | { k: 'error'; message: string; prep?: any };

export function TxFlow({ clientId, safeAddress, safeTx, note, onDone, onBack }: { clientId: string; safeAddress: string; safeTx: SafeTx; note?: string; onDone?: () => void; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const ensureUnlocked = useEnsureUnlocked();

  useEffect(() => {
    cosigner
      .post('/tx/prepare', { clientId, safeTx })
      .then((prep) => setPhase({ k: 'review', prep }))
      .catch((e) => setPhase({ k: 'error', message: e.message }));
  }, [clientId, safeTx]);

  const confirm = async (prep: any) => {
    try {
      await ensureUnlocked();
    } catch {
      return;
    }
    try {
      setPhase({ k: 'signing', prep, stage: 0 });
      const webauthn = await passkeyAssertion(prep.authOptions);
      setPhase({ k: 'signing', prep, stage: 1 });
      const signatureK1 = await signSafeTx(unlockedKey(), safeAddress, safeTx);
      setPhase({ k: 'signing', prep, stage: 2 });
      const r = await cosigner.post('/tx/submit', { clientId, safeTx, signatureK1, webauthn, note });
      if (r.status === 'executed') {
        setPhase({ k: 'executed', prep, txHash: r.txHash });
        onDone?.();
      } else setPhase({ k: 'step-up', prep, requestId: r.requestId });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403 && e.body?.policy) setPhase({ k: 'rejected', prep, policy: e.body.policy, message: e.message });
      else if (e?.name === 'NotAllowedError') setPhase({ k: 'error', prep, message: 'Touch ID a été annulé : rien n’a été signé.' });
      else setPhase({ k: 'error', prep, message: e.message });
    }
  };

  if (phase.k === 'loading')
    return (
      <Card className="flex items-center gap-3 text-[14px] text-sq-ink-2">
        <Spinner className="text-sq-orange" /> Simulation de l’opération et contrôles de conformité…
      </Card>
    );

  if (phase.k === 'error')
    return (
      <div className="space-y-3">
        <Notice tone="bad" title="Rien n’a été envoyé">
          {phase.message}
        </Notice>
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
      </div>
    );

  const prep = phase.prep;
  const d = prep.decoded;
  const usdcAmt = d.kind === 'erc20-transfer' && d.token === 'USDC' ? Number(d.amount) : null;

  if (phase.k === 'review' || phase.k === 'signing') {
    const reject = prep.policy.decision === 'reject';
    const step = prep.policy.decision === 'step-up';
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-sq-muted">Vous allez</div>
          <div className="text-[19px] font-semibold leading-snug">{d.summary}</div>
          {usdcAmt !== null && <div className="num text-[14px] text-sq-muted">≈ {fmt(usdcAmt * MOCK_USDC_CHF)} CHF (indicatif)</div>}
          <dl className="grid grid-cols-2 gap-y-2 border-t border-sq-line pt-3 text-[14px]">
            <dt className="text-sq-muted">Frais de réseau</dt>
            <dd className="text-right font-medium text-sq-up">0.00 CHF — offerts par Swissquote</dd>
            <dt className="text-sq-muted">Solde après</dt>
            <dd className="num text-right font-medium">
              {d.kind === 'eth-transfer' ? `${fmt(Number(prep.balancesAfter.eth), 5)} ETH` : `${fmt(Number(prep.balancesAfter.usdc))} USDC`}
            </dd>
            <dt className="text-sq-muted">Niveau de sécurité</dt>
            <dd className={cx('text-right font-medium', step ? 'text-sq-warn' : reject ? 'text-sq-down' : '')}>{reject ? 'Sera refusée' : step ? 'Renforcé' : 'Standard'}</dd>
            {note && (
              <>
                <dt className="text-sq-muted">Motif</dt>
                <dd className="text-right">{note}</dd>
              </>
            )}
          </dl>
          {d.warnings?.map((w: string) => (
            <div key={w} role="alert" className="flex gap-2 rounded-[10px] bg-sq-down p-3 text-[14px] font-medium text-white">
              <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="mb-1 font-semibold">Contrôles Swissquote</h3>
          <Checks checks={prep.policy.checks} />
        </Card>
        {step && <Why>Cette opération demande des contrôles renforcés : Touch ID, un code envoyé par email, un court délai de réflexion et la validation d’un responsable conformité Swissquote.</Why>}
        {reject ? (
          <>
            <Notice tone="bad" title="Swissquote ne co-signera pas cette opération">
              {prep.policy.reasons.join(' · ')}
            </Notice>
            <Button variant="secondary" onClick={onBack}>
              Modifier l’opération
            </Button>
            <Button variant="ghost" onClick={() => confirm(prep)}>
              Essayer quand même (pour voir le refus)
            </Button>
          </>
        ) : phase.k === 'signing' ? (
          <Card>
            <ProgressList
              items={['Touch ID : nous vérifions que c’est bien vous', 'Signature sur cet appareil', 'Contrôles de conformité, co-signature, envoi sur Ethereum…'].map((label, i) => ({
                label,
                state: i < phase.stage ? 'done' : i === phase.stage ? 'doing' : 'todo',
              }))}
            />
          </Card>
        ) : (
          <>
            <Button onClick={() => confirm(prep)}>
              <Fingerprint size={20} strokeWidth={1.75} /> Confirmer avec Touch ID
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Annuler
            </Button>
          </>
        )}
      </div>
    );
  }

  if (phase.k === 'executed') return <Executed txHash={phase.txHash} summary={d.summary} />;

  if (phase.k === 'rejected')
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-full bg-sq-bad-50 text-sq-down">
              <ShieldAlert size={24} strokeWidth={1.75} />
            </span>
            <div>
              <div className="text-[18px] font-semibold">Opération refusée</div>
              <div className="text-[14px] text-sq-muted">Vos fonds n’ont pas bougé.</div>
            </div>
          </div>
          <p className="text-[14px]">{phase.policy.reasons.join(' · ')}</p>
          <Checks checks={phase.policy.checks} />
          <Why>Swissquote peut refuser de co-signer (pour vous protéger et respecter le droit suisse), mais ne peut jamais déplacer vos fonds seul. En cas de doute, contactez votre conseiller.</Why>
        </Card>
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
      </div>
    );

  return <StepUp requestId={phase.requestId} summary={d.summary} onDone={onDone} />;
}

/** Confirmed send: finds the wallet transaction (for the receipt) and shows the orange check. */
function Executed({ txHash, summary }: { txHash: string; summary: string }) {
  const { device, session } = useLocal();
  const { data } = usePoll<WalletTxView[]>(() => cosigner.get(`/clients/${device!.clientId}/wallet-txs`), 2000, [txHash]);
  const tx = data?.find((t) => t.txHash?.toLowerCase() === txHash.toLowerCase());
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        {tx ? (
          <ConfirmedCard tx={tx} clientName={session?.profile?.name ?? ''} />
        ) : (
          <div className="flex items-start gap-4">
            <CheckDisc />
            <div>
              <div className="text-[16px] font-semibold" role="status">
                Confirmée
              </div>
              <div className="mt-0.5 text-[14px] text-sq-ink-2">{summary}</div>
              <div className="mt-2">
                <TxLink hash={txHash} />
              </div>
            </div>
          </div>
        )}
        <p className="text-[13px] text-sq-muted">Signée par vous, co-signée par Swissquote · frais offerts.</p>
      </Card>
      <Link to="/wallet" className="block">
        <Button>Retour à My Wall</Button>
      </Link>
    </div>
  );
}

function StepUp({ requestId, summary, onDone }: { requestId: string; summary: string; onDone?: () => void }) {
  const { data: r, reload } = usePoll(() => cosigner.get(`/tx/${requestId}`), 2500, [requestId]);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const left = useCountdown(r?.coolingOffUntil);
  useEffect(() => {
    if (r?.status === 'executed') onDone?.();
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitOtp = async () => {
    setErr('');
    try {
      await cosigner.post(`/tx/${requestId}/otp`, { code });
      void reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (!r) return <Spinner />;
  if (r.status === 'executed') return <Executed txHash={r.txHash} summary={summary} />;
  const approved = r.approval?.decision === 'approved';
  const items = [
    { label: 'Touch ID + signature de l’appareil', state: 'done' as const },
    { label: 'Code reçu par email', state: r.otpVerified ? ('done' as const) : ('doing' as const), detail: <MockBadge label="Email simulé" /> },
    {
      label: `Délai de réflexion${r.coolingOffUntil && left > 0 ? ` — ${mmss(left)}` : ''}`,
      state: !r.otpVerified ? ('todo' as const) : left > 0 ? ('doing' as const) : ('done' as const),
      detail: 'Vous laisse le temps d’annuler si l’on vous met sous pression',
    },
    {
      label: 'Validation à quatre yeux par la conformité Swissquote',
      state: r.status === 'rejected' ? ('error' as const) : approved ? ('done' as const) : r.otpVerified ? ('doing' as const) : ('todo' as const),
      detail: approved ? (
        `Validé par ${r.approval.by}`
      ) : (
        <Link className="underline underline-offset-2" to="/admin" target="_blank">
          Ouvrir la console Swissquote (simulée)
        </Link>
      ),
    },
    { label: 'Co-signature et envoi sur Ethereum', state: r.status === 'executing' ? ('doing' as const) : r.status === 'failed' ? ('error' as const) : ('todo' as const) },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-sq-warn">Contrôles renforcés</div>
        <div className="font-semibold">{summary}</div>
        <ProgressList items={items} />
        {r.status === 'executing' && <PendingIndicator />}
      </Card>
      {r.status === 'awaiting-otp' && (
        <Card className="space-y-3">
          <Field
            label="Code reçu par email"
            error={err || undefined}
            hint={
              <>
                Ouvrez la{' '}
                <Link className="underline underline-offset-2" to="/inbox" target="_blank">
                  boîte de réception simulée
                </Link>{' '}
                pour le lire.
              </>
            }
          >
            <input className={cx(inputCls, 'num text-[18px] tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 chiffres" />
          </Field>
          <Button onClick={submitOtp} disabled={code.length !== 6}>
            Confirmer le code
          </Button>
        </Card>
      )}
      {r.status === 'rejected' && <Notice tone="bad" title="Refusée par la conformité Swissquote">{r.approval?.note ?? 'L’opération n’a pas été exécutée. Vos fonds n’ont pas bougé.'}</Notice>}
      {r.status === 'failed' && <Notice tone="bad" title="Exécution échouée">{r.error} — recommencez l’opération.</Notice>}
      {!['executed', 'rejected', 'cancelled', 'failed', 'executing'].includes(r.status) && (
        <Button
          variant="ghost"
          onClick={async () => {
            await cosigner.post(`/tx/${requestId}/cancel`);
            void reload();
          }}
        >
          Annuler cette opération
        </Button>
      )}
      {r.status === 'cancelled' && <Notice title="Annulée">Rien n’a été envoyé.</Notice>}
    </div>
  );
}
