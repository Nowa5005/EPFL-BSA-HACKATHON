// Shared "review → Touch ID → co-sign → confirmed" flow for any Safe transaction.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { signSafeTx, type SafeTx } from '@sq/shared';
import { cosigner, ApiError } from '../lib/api';
import { passkeyAssertion, unlockedKey } from '../lib/device';
import { useEnsureUnlocked, usePoll } from '../lib/hooks';
import { Button, Card, Checks, chf, Field, fmt, inputCls, mmss, MockBadge, Notice, ProgressList, Spinner, TxLink, useCountdown, Why, cx } from './ui';
import { MOCK_USDC_CHF } from '@sq/shared';

type Phase =
  | { k: 'loading' }
  | { k: 'review'; prep: any }
  | { k: 'signing'; prep: any; stage: number }
  | { k: 'executed'; prep: any; txHash: string }
  | { k: 'step-up'; prep: any; requestId: string }
  | { k: 'rejected'; prep: any; policy: any; message: string }
  | { k: 'error'; message: string; prep?: any };

export function TxFlow({ clientId, safeAddress, safeTx, onDone, onBack }: { clientId: string; safeAddress: string; safeTx: SafeTx; onDone?: () => void; onBack: () => void }) {
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
      const r = await cosigner.post('/tx/submit', { clientId, safeTx, signatureK1, webauthn });
      if (r.status === 'executed') {
        setPhase({ k: 'executed', prep, txHash: r.txHash });
        onDone?.();
      } else setPhase({ k: 'step-up', prep, requestId: r.requestId });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403 && e.body?.policy) setPhase({ k: 'rejected', prep, policy: e.body.policy, message: e.message });
      else if (e?.name === 'NotAllowedError') setPhase({ k: 'error', prep, message: 'Touch ID was cancelled — nothing was signed.' });
      else setPhase({ k: 'error', prep, message: e.message });
    }
  };

  if (phase.k === 'loading')
    return (
      <Card className="flex items-center gap-3 text-sm">
        <Spinner /> Simulating your transaction and running compliance checks…
      </Card>
    );

  if (phase.k === 'error')
    return (
      <div className="space-y-3">
        <Notice tone="bad" title="Not sent">
          {phase.message}
        </Notice>
        <Button variant="secondary" onClick={onBack}>
          Back
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
          <div className="text-xs font-semibold uppercase tracking-wide text-navy-700/60">You are about to</div>
          <div className="text-lg font-semibold leading-snug">{d.summary}</div>
          {usdcAmt !== null && <div className="num text-sm text-navy-700/70">≈ {chf(usdcAmt * MOCK_USDC_CHF)} (indicative)</div>}
          <dl className="grid grid-cols-2 gap-y-1.5 border-t border-navy-100 pt-3 text-sm">
            <dt className="text-navy-700/70">Network fee</dt>
            <dd className="text-right font-medium text-ok-600">CHF 0.00 — offered by Swissquote</dd>
            <dt className="text-navy-700/70">Balance after</dt>
            <dd className="num text-right font-medium">
              {d.token === 'ETH' || d.kind === 'eth-transfer' ? `${fmt(Number(prep.balancesAfter.eth), 5)} ETH` : `${fmt(Number(prep.balancesAfter.usdc))} USDC`}
            </dd>
            <dt className="text-navy-700/70">Security level</dt>
            <dd className={cx('text-right font-medium', step ? 'text-warn-600' : reject ? 'text-bad-600' : '')}>{reject ? 'Will be refused' : step ? 'Reinforced' : 'Standard'}</dd>
          </dl>
          {d.warnings?.map((w: string) => (
            <Notice key={w} tone="bad" title="⚠️ Warning">
              {w}
            </Notice>
          ))}
        </Card>
        <Card>
          <div className="mb-1 font-semibold">Swissquote checks</div>
          <Checks checks={prep.policy.checks} />
        </Card>
        {step && <Why>This payment needs reinforced checks: Touch ID, a code sent by email, a short cooling-off period and a validation by a Swissquote compliance officer.</Why>}
        {reject ? (
          <>
            <Notice tone="bad" title="Swissquote will not co-sign this transaction">
              {prep.policy.reasons.join(' · ')}
            </Notice>
            <Button variant="secondary" onClick={onBack}>
              Change the payment
            </Button>
            <Button variant="ghost" onClick={() => confirm(prep)}>
              Try anyway (to see the refusal)
            </Button>
          </>
        ) : phase.k === 'signing' ? (
          <Card>
            <ProgressList
              items={['Touch ID: confirming it is you', 'Signing on this device', 'Compliance checks & co-signature, sending to Ethereum…'].map((label, i) => ({
                label,
                state: i < phase.stage ? 'done' : i === phase.stage ? 'doing' : 'todo',
              }))}
            />
          </Card>
        ) : (
          <>
            <Button onClick={() => confirm(prep)}>👆 Confirm with Touch ID</Button>
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
          </>
        )}
      </div>
    );
  }

  if (phase.k === 'executed')
    return (
      <div className="space-y-4">
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok-600 text-2xl text-white">✓</span>
          <div className="text-xl font-semibold">Confirmed</div>
          <div className="text-sm text-navy-700/80">{d.summary}</div>
          <div className="text-xs text-navy-700/60">Signed by you + co-signed by Swissquote · fee offered by Swissquote</div>
          <TxLink hash={phase.txHash} />
        </Card>
        <Link to="/wallet" className="block">
          <Button>Back to wallet</Button>
        </Link>
      </div>
    );

  if (phase.k === 'rejected')
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-full bg-bad-50 text-2xl text-bad-600">✕</span>
            <div>
              <div className="text-lg font-semibold">Payment refused</div>
              <div className="text-sm text-navy-700/70">Your funds have not moved.</div>
            </div>
          </div>
          <p className="text-sm">{phase.policy.reasons.join(' · ')}</p>
          <Checks checks={phase.policy.checks} />
          <Why>Swissquote can refuse to co-sign (to protect you and to comply with Swiss law), but can never move your funds by itself. If you think this is a mistake, contact your advisor.</Why>
        </Card>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    );

  return <StepUp requestId={phase.requestId} summary={d.summary} onDone={onDone} />;
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
  const approved = r.approval?.decision === 'approved';
  const items = [
    { label: 'Touch ID + device signature', state: 'done' as const },
    { label: 'Email code', state: r.otpVerified ? ('done' as const) : ('doing' as const), detail: <MockBadge label="Mock email" /> },
    {
      label: `Cooling-off period${r.coolingOffUntil && left > 0 ? ` — ${mmss(left)}` : ''}`,
      state: !r.otpVerified ? ('todo' as const) : left > 0 ? ('doing' as const) : ('done' as const),
      detail: 'Gives you time to cancel if you are being pressured or scammed',
    },
    {
      label: 'Four-eyes validation by a Swissquote compliance officer',
      state: r.status === 'rejected' ? ('error' as const) : approved ? ('done' as const) : r.otpVerified ? ('doing' as const) : ('todo' as const),
      detail: approved ? `Approved by ${r.approval.by}` : <Link className="text-accent-500" to="/admin" target="_blank">Open the admin console ↗</Link>,
    },
    { label: 'Co-signature & sending to Ethereum', state: r.status === 'executed' ? ('done' as const) : r.status === 'executing' ? ('doing' as const) : r.status === 'failed' ? ('error' as const) : ('todo' as const) },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-warn-600">Reinforced checks</div>
        <div className="font-semibold">{summary}</div>
        <ProgressList items={items} />
      </Card>
      {r.status === 'awaiting-otp' && (
        <Card className="space-y-3">
          <Field label="Code received by email" hint={<>Open the <Link className="text-accent-500" to="/inbox" target="_blank">mock inbox ↗</Link> to read it.</>}>
            <input className={inputCls} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" />
          </Field>
          {err && <p className="text-sm text-bad-600">{err}</p>}
          <Button onClick={submitOtp} disabled={code.length !== 6}>
            Confirm code
          </Button>
        </Card>
      )}
      {r.status === 'executed' && (
        <Notice tone="ok" title="Confirmed">
          {summary} · <TxLink hash={r.txHash} />
        </Notice>
      )}
      {r.status === 'rejected' && <Notice tone="bad" title="Refused by Swissquote compliance">{r.approval?.note ?? 'The payment was not executed. Your funds have not moved.'}</Notice>}
      {r.status === 'failed' && <Notice tone="bad" title="Execution failed">{r.error} — please create the payment again.</Notice>}
      {!['executed', 'rejected', 'cancelled', 'failed', 'executing'].includes(r.status) && (
        <Button
          variant="ghost"
          onClick={async () => {
            await cosigner.post(`/tx/${requestId}/cancel`);
            void reload();
          }}
        >
          Cancel this payment
        </Button>
      )}
      {r.status === 'cancelled' && <Notice tone="info" title="Cancelled">Nothing was sent.</Notice>}
    </div>
  );
}
