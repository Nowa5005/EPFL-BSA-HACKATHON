// Shared confirmation flow for any Safe transaction:
// simulation (estimate) → explicit preview → user verification → co-signature → confirmation.
// Each preview is bound to ONE exact transaction and expires; any change requires a new confirmation.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, KeyRound, ShieldAlert, TriangleAlert } from 'lucide-react';
import { parseUnits } from 'ethers';
import { erc20Iface, signSafeTx, type SafeTx, type TransferDeclaration } from '@sq/shared';
import { ChfCounterValue } from '../lib/valuation';
import { tr } from '../lib/i18n';
import { cosigner, ApiError } from '../lib/api';
import { passkeyAssertion, unlockedKey } from '../lib/device';
import { useEnsureUnlocked, useLocal, usePoll, type WalletTxView } from '../lib/hooks';
import { Money } from '../lib/prefs';
import { Button, Card, Checks, cx, Field, fmt, inputCls, mmss, MockBadge, Notice, ProgressList, Spinner, TxLink, useCountdown, Why } from './ui';
import { CheckDisc, ConfirmedCard, PendingIndicator } from './Confirm';
import { RecipientCheckView } from './RecipientCheck';
import { PreSendChecks, useAcks } from './PreSendChecks';
import { FundsNeverLocked, isCosignerRefusal, RefusalExplained } from './Refusal';

type Phase =
  | { k: 'loading' }
  | { k: 'review'; prep: any }
  | { k: 'signing'; prep: any; stage: number }
  | { k: 'executed'; prep: any; txHash: string }
  | { k: 'step-up'; prep: any; requestId: string }
  | { k: 'rejected'; prep: any; policy: any; message: string }
  | { k: 'error'; message: string; prep?: any };

export function TxFlow({ clientId, safeAddress, safeTx: initialTx, note, onDone, onBack, transfer }: { clientId: string; safeAddress: string; safeTx: SafeTx; note?: string; onDone?: () => void; onBack: () => void; /** Travel Rule declaration (own wallet / third party + beneficiary), checked by the co-signer */ transfer?: TransferDeclaration }) {
  const [tx, setTx] = useState<SafeTx>(initialTx);
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const ensureUnlocked = useEnsureUnlocked();
  const acks = useAcks(phase.k === 'review' || phase.k === 'signing' ? phase.prep.recipientInfo : null); // #20 pre-send confirmations
  const contacts = usePoll(() => cosigner.get(`/clients/${clientId}`).then((c) => c.contacts as { name: string; address: string }[]), 60000, [clientId]);

  const prepare = useCallback(
    async (t: SafeTx, why?: string) => {
      setPhase({ k: 'loading' });
      try {
        const prep = await cosigner.post('/tx/prepare', { clientId, safeTx: t, transfer });
        setPhase({ k: 'review', prep });
        if (why) setNotice(why);
      } catch (e: any) {
        setPhase({ k: 'error', message: e.message });
      }
    },
    [clientId, transfer],
  );

  useEffect(() => {
    void prepare(tx);
  }, [tx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview expires: recompute and require a new confirmation.
  const expiresAt = phase.k === 'review' ? phase.prep.expiresAt : undefined;
  const left = useCountdown(expiresAt);
  useEffect(() => {
    if (phase.k === 'review' && expiresAt && left === 0) void prepare(tx, tr('The preview expired: the conditions have been recalculated. Check them before confirming.', 'L’aperçu a expiré : les conditions ont été recalculées. Vérifiez-les avant de confirmer.'));
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async (prep: any) => {
    try {
      await ensureUnlocked();
    } catch {
      return;
    }
    try {
      setNotice(null);
      setPhase({ k: 'signing', prep, stage: 0 });
      const auth = useCode ? { backupCode: code } : { webauthn: await passkeyAssertion(prep.authOptions) };
      setPhase({ k: 'signing', prep, stage: 1 });
      const signatureK1 = await signSafeTx(unlockedKey(), safeAddress, tx);
      setPhase({ k: 'signing', prep, stage: 2 });
      const r = await cosigner.post('/tx/submit', { clientId, previewId: prep.previewId, safeTx: tx, signatureK1, note, ...auth });
      if (r.status === 'executed') {
        setPhase({ k: 'executed', prep, txHash: r.txHash });
        onDone?.();
      } else setPhase({ k: 'step-up', prep, requestId: r.requestId });
    } catch (e: any) {
      const code409 = e instanceof ApiError ? e.body?.code : undefined;
      if (e instanceof ApiError && e.status === 403 && e.body?.policy) setPhase({ k: 'rejected', prep, policy: e.body.policy, message: e.message });
      else if (code409 === 'conditions-changed' || code409 === 'preview-expired' || code409 === 'preview-used') void prepare(tx, e.message);
      else if (e?.name === 'NotAllowedError') setPhase({ k: 'error', prep, message: tr('Verification was cancelled: nothing was signed.', 'La vérification a été annulée : rien n’a été signé.') });
      else setPhase({ k: 'error', prep, message: e.message });
    }
  };

  /** Lower an approval cap: rebuilds the transaction (same nonce) → new simulation and new confirmation. */
  const limitCap = (spender: string, amount: string) => {
    const t = { ...tx, data: erc20Iface.encodeFunctionData('approve', [spender, parseUnits(amount, 6)]) };
    setNotice(tr('Limit changed: the transaction and its preview have been recalculated.', 'Plafond modifié : la transaction et son aperçu ont été recalculés.'));
    setTx(t);
  };

  const setDemoFee = async (chf: number | null, recompute: boolean) => {
    await cosigner.post(`/clients/${clientId}/demo/fees`, { chf });
    if (recompute) void prepare(tx);
  };

  if (phase.k === 'loading')
    return (
      <Card className="flex items-center gap-3 text-[14px] text-sq-ink-2">
        <Spinner className="text-sq-orange" /> {tr('Simulating the transaction and running compliance checks…', 'Simulation de l’opération et contrôles de conformité…')}
      </Card>
    );

  if (phase.k === 'error')
    return (
      <div className="space-y-3">
        <Notice tone="bad" title={tr('Nothing was sent', 'Rien n’a été envoyé')}>
          {phase.message}
        </Notice>
        {isCosignerRefusal(phase.message) && <FundsNeverLocked />}
        <Button variant="secondary" onClick={onBack}>
          {tr('Back', 'Retour')}
        </Button>
      </div>
    );

  const prep = phase.prep;
  const d = prep.decoded;
  const fee = prep.fee ?? { available: false };

  if (phase.k === 'review' || phase.k === 'signing') {
    const reject = prep.policy.decision === 'reject';
    const step = prep.policy.decision === 'step-up';
    const simOk = prep.simulation?.success;
    const recipient = d.kind === 'erc20-transfer' || d.kind === 'eth-transfer' ? d.recipient : null;
    return (
      <div className="space-y-4">
        {notice && <Notice tone="warn" title={tr('New confirmation required', 'Nouvelle confirmation nécessaire')}>{notice}</Notice>}
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-sq-muted">{tr('You are about to', 'Vous allez')}</div>
            {phase.k === 'review' && (
              <span className={cx('num text-[12px]', left <= 15 ? 'mw-important-text text-sq-warn' : 'text-sq-muted')} aria-live="polite">
                {tr(`Preview valid for ${left} s`, `Aperçu valable encore ${left} s`)}
              </span>
            )}
          </div>
          <div className="text-[19px] font-semibold leading-snug">{d.summary}</div>

          {recipient && <RecipientCheckView input={recipient} contacts={contacts.data ?? []} />}
          {!reject && <PreSendChecks info={prep.recipientInfo} acks={acks} disabled={phase.k === 'signing'} />}

          <section aria-label={tr('Amounts', 'Montants')}>
            <h3 className="mb-1 text-[13px] font-semibold text-sq-ink-2">{tr('Amounts (estimate)', 'Montants (estimation)')}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[14px]">
              {prep.debits.map((x: any) => (
                <Row key={`d${x.asset}`} k={tr('Debited from your wallet', 'Débité de votre wallet')} v={<span className="num font-medium">−{x.amount} {x.asset}</span>} />
              ))}
              {prep.receives.map((x: any) => (
                <Row key={`r${x.asset}`} k={tr('Received by the recipient (estimated)', 'Reçu par le destinataire (estimé)')} v={<span className="num">{x.amount} {x.asset}</span>} />
              ))}
              {!prep.debits.length && <Row k={tr('Debited from your wallet', 'Débité de votre wallet')} v={tr('Nothing right now', 'Aucun montant maintenant')} />}
              {prep.debits.map((x: any) => (
                <Row key={`cv${x.asset}`} k={tr('Indicative CHF value', 'Contre-valeur indicative')} v={<ChfCounterValue asset={x.asset} amount={Number(x.amount)} />} />
              ))}
            </dl>
          </section>

          <section aria-label={tr('Fees', 'Frais')}>
            <h3 className="mb-1 text-[13px] font-semibold text-sq-ink-2">{tr('Fees', 'Frais')}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[14px]">
              <Row
                k={tr('Network fee (estimated)', 'Frais réseau (estimés)')}
                v={
                  fee.available ? (
                    <span className="text-right">
                      <span className="num">{typeof fee.chf === 'number' ? `${fee.chf.toFixed(2)} CHF` : `${Number(fee.eth).toFixed(6)} ETH`}</span> {fee.demo && <MockBadge label={tr('Demo', 'Démo')} />}
                      {fee.chf === null && <span className="block text-[12px] text-sq-warn">{tr('CHF value unavailable (no ETH market price)', 'Contre-valeur CHF indisponible (pas de cours ETH)')}</span>}
                      <span className="block text-[12px] font-medium text-sq-up">{tr('paid by Swissquote', 'offerts par Swissquote')}</span>
                    </span>
                  ) : (
                    <span className="text-sq-warn">{tr('Estimate unavailable', 'Estimation indisponible')}</span>
                  )
                }
              />
              <Row
                k={
                  <>
                    {tr('Service fee', 'Commission de service')}{' '}
                    <Link to="/wallet/plans#frais" className="underline underline-offset-2" aria-label={tr('About fees', 'Explication des frais')}>
                      *
                    </Link>
                  </>
                }
                v={<span className="num">0.00 CHF</span>}
              />
              <Row k={tr('Total you pay', 'Total à votre charge')} v={<span className="num font-semibold">0.00 CHF</span>} />
            </dl>
            <p className="mt-1 text-[12px] text-sq-muted">{tr('* No fee on sending, receiving or approvals. Network fees are estimated and paid by Swissquote.', '* Aucune commission sur les envois, réceptions et autorisations. Les frais réseau sont estimés et payés par Swissquote.')}</p>
          </section>

          <section aria-label={tr('Balances before and after', 'Soldes avant et après')}>
            <h3 className="mb-1 text-[13px] font-semibold text-sq-ink-2">{tr('Your wallet before → after (estimate)', 'Votre wallet avant → après (estimation)')}</h3>
            <table className="w-full text-[14px]">
              <tbody>
                {(['USDC', 'ETH'] as const).map((a) => (
                  <tr key={a}>
                    <td className="py-0.5 text-sq-muted">{a}</td>
                    <td className="num py-0.5 text-right">
                      <Money value={Number(prep.balances[a.toLowerCase()])} decimals={a === 'ETH' ? 5 : 2} />
                    </td>
                    <td className="px-2 text-sq-muted">→</td>
                    <td className="num py-0.5 text-right font-medium">
                      <Money value={Number(prep.balancesAfter[a.toLowerCase()])} decimals={a === 'ETH' ? 5 : 2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[12px] text-sq-muted">{tr('ETH balance for fees: unchanged (fees paid by Swissquote).', 'Solde ETH pour les frais : inchangé (frais offerts par Swissquote).')}</p>
          </section>

          {prep.approvals.map((ap: any) => (
            <ApprovalBlock key={ap.spender} ap={ap} onLimit={(amt) => limitCap(ap.spender, amt)} disabled={phase.k === 'signing'} />
          ))}

          {d.warnings
            ?.filter((w: string) => !/ILLIMITÉE|UNLIMITED/.test(w))
            .map((w: string) => (
              <div key={w} role="alert" className="mw-important flex gap-2 rounded-[10px] bg-sq-down p-3 text-[14px] font-medium text-white">
                <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0" /> {w}
              </div>
            ))}
          {!simOk && <Notice tone="bad" title={tr('Simulation failed', 'Simulation en échec')}>{prep.simulation?.error ?? tr('The simulation could not be run.', 'La simulation n’a pas pu être réalisée.')} {tr('No outcome is guaranteed: the transaction will be refused.', 'Aucun résultat n’est garanti : l’opération sera refusée.')}</Notice>}
          <p className="text-[12px] text-sq-muted">{tr('Simulated on Ethereum Sepolia: this is an estimate, not a guarantee.', 'Simulation réalisée sur Ethereum Sepolia : c’est une estimation, pas une garantie.')}</p>
        </Card>
        <Card>
          <h3 className="mb-1 font-semibold">{tr('Swissquote checks', 'Contrôles Swissquote')}</h3>
          <Checks checks={prep.policy.checks} />
        </Card>
        {step && <Why>{tr('This transaction needs enhanced checks: verification on your device, a code sent by email, a short cooling-off period and approval by a Swissquote compliance officer.', 'Cette opération demande des contrôles renforcés : vérification sur votre appareil, un code envoyé par email, un court délai de réflexion et la validation d’un responsable conformité Swissquote.')}</Why>}

        <details className="rounded-[10px] border border-dashed border-sq-line bg-white px-3 py-2 text-[13px]">
          <summary className="min-h-10 cursor-pointer py-2 text-sq-muted">
            {tr('Demo: fee change', 'Démonstration : variation des frais')} <MockBadge />
          </summary>
          <div className="flex flex-wrap gap-2 pb-2">
            <Button variant="secondary" className="min-h-10 w-auto px-3 text-[13px]" onClick={() => setDemoFee(2, true)}>
              {tr('Simulated fee: 2 CHF', 'Frais simulés : 2 CHF')}
            </Button>
            <Button variant="secondary" className="min-h-10 w-auto px-3 text-[13px]" onClick={() => setDemoFee(8, false)}>
              {tr('Raise the fee to 8 CHF', 'Faire passer les frais à 8 CHF')}
            </Button>
            <Button variant="ghost" className="min-h-10 w-auto px-3 text-[13px]" onClick={() => setDemoFee(null, true)}>
              {tr('Back to real fees', 'Revenir aux frais réels')}
            </Button>
          </div>
          <p className="pb-2 text-[12px] text-sq-muted">{tr('Made-up values to show that a significant fee change invalidates the confirmation.', 'Valeurs fictives pour montrer qu’un changement sensible des frais invalide la confirmation.')}</p>
        </details>

        {reject ? (
          <>
            <Notice tone="bad" title={tr('Swissquote will not co-sign this transaction', 'Swissquote ne co-signera pas cette opération')}>
              {tr('Reason, rule and how to fix it:', 'Motif, règle et comment le résoudre :')}
            </Notice>
            <RefusalExplained checks={prep.policy.checks} reasons={prep.policy.reasons} />
            <Button variant="secondary" onClick={onBack}>
              {tr('Edit the transaction', 'Modifier l’opération')}
            </Button>
            <Button variant="ghost" onClick={() => confirm(prep)}>
              {tr('Try anyway (to see the refusal)', 'Essayer quand même (pour voir le refus)')}
            </Button>
          </>
        ) : phase.k === 'signing' ? (
          <Card>
            <ProgressList
              items={[useCode ? tr('Checking the recovery code', 'Vérification du code de secours') : tr('Verification on your device (passkey)', 'Vérification sur votre appareil (passkey)'), tr('Signing on this device', 'Signature sur cet appareil'), tr('Compliance checks, co-signing, sending on Ethereum…', 'Contrôles de conformité, co-signature, envoi sur Ethereum…')].map((label, i) => ({
                label,
                state: i < phase.stage ? 'done' : i === phase.stage ? 'doing' : 'todo',
              }))}
            />
          </Card>
        ) : (
          <>
            {useCode ? (
              <Card className="space-y-3">
                <Field label={tr('Recovery code (12 characters)', 'Code de secours (12 caractères)')} hint={tr('Can be used instead of the passkey for this transaction only.', 'Utilisable à la place de la passkey pour cette opération uniquement.')}>
                  <input className={cx(inputCls, 'font-mono uppercase tracking-widest')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} autoComplete="off" spellCheck={false} />
                </Field>
                <Button onClick={() => confirm(prep)} disabled={code.length !== 12 || !acks.ready}>
                  <KeyRound size={18} strokeWidth={1.75} /> {tr('Confirm with the recovery code', 'Confirmer avec le code de secours')}
                </Button>
              </Card>
            ) : (
              <Button onClick={() => confirm(prep)} disabled={!acks.ready}>
                <Fingerprint size={20} strokeWidth={1.75} /> {tr('Confirm with my passkey', 'Confirmer avec ma passkey')}
              </Button>
            )}
            <p className="-mt-2 text-center text-[12px] text-sq-muted">{tr('Touch ID, Face ID or device passcode, depending on what your device offers.', 'Touch ID, Face ID ou code de l’appareil, selon ce que votre appareil propose.')}</p>
            {prep.backupCodeAvailable && (
              <button type="button" className="mx-auto block min-h-10 text-[13px] text-sq-ink-2 underline underline-offset-4" onClick={() => setUseCode((v) => !v)}>
                {useCode ? tr('Use my passkey instead', 'Utiliser plutôt ma passkey') : tr('Biometrics not available? Use my recovery code', 'La biométrie n’est pas disponible ? Utiliser mon code de secours')}
              </button>
            )}
            <Button variant="ghost" onClick={onBack}>
              {tr('Cancel', 'Annuler')}
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
              <div className="text-[18px] font-semibold">{tr('Transaction refused', 'Opération refusée')}</div>
              <div className="text-[14px] text-sq-muted">{tr('Your funds have not moved.', 'Vos fonds n’ont pas bougé.')}</div>
            </div>
          </div>
          <RefusalExplained checks={phase.policy.checks} reasons={phase.policy.reasons} />
          <Checks checks={phase.policy.checks} />
          <Why>{tr('Swissquote can refuse to co-sign (to protect you and comply with Swiss law), but can never move your funds on its own. If in doubt, contact your advisor.', 'Swissquote peut refuser de co-signer (pour vous protéger et respecter le droit suisse), mais ne peut jamais déplacer vos fonds seul. En cas de doute, contactez votre conseiller.')}</Why>
        </Card>
        <Button variant="secondary" onClick={onBack}>
          {tr('Back', 'Retour')}
        </Button>
      </div>
    );

  return <StepUp requestId={phase.requestId} summary={d.summary} onDone={onDone} />;
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-sq-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </>
  );
}

function ApprovalBlock({ ap, onLimit, disabled }: { ap: any; onLimit: (amount: string) => void; disabled?: boolean }) {
  const [cap, setCap] = useState(ap.unlimited ? '25' : ap.amount);
  return (
    <section aria-label={tr('Approval', 'Autorisation')} className={cx('rounded-[10px] border p-3 text-[14px]', ap.unlimited ? 'mw-important border-sq-down/40 bg-sq-bad-50' : 'border-sq-line bg-white')}>
      <h3 className="mb-1 font-semibold">{ap.revocation ? tr('Approval revocation', 'Révocation d’autorisation') : tr('Spending approval granted', 'Autorisation de dépense accordée')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-sq-muted">{tr('App', 'Application')}</dt>
        <dd className="break-all">
          {ap.spenderName ?? tr('Unknown', 'Inconnue')} <span className="font-mono text-[12px] text-sq-muted">{ap.spender}</span>
        </dd>
        <dt className="text-sq-muted">{tr('Asset', 'Actif')}</dt>
        <dd>{ap.token} (Ethereum Sepolia)</dd>
        <dt className="text-sq-muted">{tr('Limit', 'Plafond')}</dt>
        <dd className={cx('font-semibold', ap.unlimited && 'text-sq-down')}>{ap.revocation ? tr('0 (access removed)', '0 (accès retiré)') : ap.unlimited ? tr('UNLIMITED', 'ILLIMITÉ') : `${ap.amount} ${ap.token}`}</dd>
      </dl>
      {ap.unlimited && (
        <div className="mt-2 space-y-2">
          <p role="alert" className="flex gap-2 font-medium text-sq-down">
            <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
            {tr('This app is asking for unlimited spending approval on your USDC. It could take your entire balance, now and in the future.', 'Cette application demande une autorisation de dépense illimitée sur vos USDC. Elle pourrait prendre tout votre solde, maintenant et à l’avenir.')}
          </p>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-[13px] font-medium">{tr('Limit to (USDC)', 'Limiter le plafond à (USDC)')}</span>
              <input className={cx(inputCls, 'num')} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(',', '.'))} />
            </label>
            <Button className="w-auto px-4" onClick={() => onLimit(cap)} disabled={disabled || !(Number(cap) > 0)}>
              {tr('Apply', 'Appliquer')}
            </Button>
          </div>
          <p className="text-[12px] text-sq-ink-2">{tr('Choose the amount your transaction needs. The transaction and its preview will be recalculated.', 'Choisissez le montant nécessaire à votre opération. La transaction et son aperçu seront recalculés.')}</p>
        </div>
      )}
    </section>
  );
}

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
                {tr('Confirmed', 'Confirmée')}
              </div>
              <div className="mt-0.5 text-[14px] text-sq-ink-2">{summary}</div>
              <div className="mt-2">
                <TxLink hash={txHash} />
              </div>
            </div>
          </div>
        )}
        <p className="text-[13px] text-sq-muted">{tr('Signed by you, co-signed by Swissquote · fees paid.', 'Signée par vous, co-signée par Swissquote · frais offerts.')}</p>
      </Card>
      <Link to="/wallet" className="block">
        <Button>{tr('Back to My Wall', 'Retour à My Wall')}</Button>
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
    { label: tr('Verification on your device + signature', 'Vérification sur votre appareil + signature'), state: 'done' as const },
    { label: tr('Code received by email', 'Code reçu par email'), state: r.otpVerified ? ('done' as const) : ('doing' as const), detail: <MockBadge label={tr('Simulated email', 'Email simulé')} /> },
    {
      label: `${tr('Cooling-off period', 'Délai de réflexion')}${r.coolingOffUntil && left > 0 ? ` — ${mmss(left)}` : ''}`,
      state: !r.otpVerified ? ('todo' as const) : left > 0 ? ('doing' as const) : ('done' as const),
      detail: tr('Gives you time to cancel if someone is pressuring you', 'Vous laisse le temps d’annuler si l’on vous met sous pression'),
    },
    {
      label: tr('Four-eyes approval by Swissquote compliance', 'Validation à quatre yeux par la conformité Swissquote'),
      state: r.status === 'rejected' ? ('error' as const) : approved ? ('done' as const) : r.otpVerified ? ('doing' as const) : ('todo' as const),
      detail: approved ? (
        tr(`Approved by ${r.approval.by}`, `Validé par ${r.approval.by}`)
      ) : (
        <Link className="underline underline-offset-2" to="/admin" target="_blank">
          {tr('Open the Swissquote console (simulated)', 'Ouvrir la console Swissquote (simulée)')}
        </Link>
      ),
    },
    { label: tr('Co-signing and sending on Ethereum', 'Co-signature et envoi sur Ethereum'), state: r.status === 'executing' ? ('doing' as const) : r.status === 'failed' ? ('error' as const) : ('todo' as const) },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-sq-warn">{tr('Enhanced checks', 'Contrôles renforcés')}</div>
        <div className="font-semibold">{summary}</div>
        <ProgressList items={items} />
        {r.status === 'executing' && <PendingIndicator />}
      </Card>
      {r.status === 'awaiting-otp' && (
        <Card className="space-y-3">
          <Field
            label={tr('Code received by email', 'Code reçu par email')}
            error={err || undefined}
            hint={
              <>
                {tr('Open the', 'Ouvrez la')}{' '}
                <Link className="underline underline-offset-2" to="/inbox" target="_blank">
                  {tr('simulated inbox', 'boîte de réception simulée')}
                </Link>{' '}
                {tr('to read it.', 'pour le lire.')}
              </>
            }
          >
            <input className={cx(inputCls, 'num text-[18px] tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={tr('6 digits', '6 chiffres')} />
          </Field>
          <Button onClick={submitOtp} disabled={code.length !== 6}>
            {tr('Confirm code', 'Confirmer le code')}
          </Button>
        </Card>
      )}
      {r.status === 'rejected' && <Notice tone="bad" title={tr('Refused by Swissquote compliance', 'Refusée par la conformité Swissquote')}>{r.approval?.note ?? tr('The transaction was not executed. Your funds have not moved.', 'L’opération n’a pas été exécutée. Vos fonds n’ont pas bougé.')} {tr('Rule: human review (four-eyes). How to fix it: contact your advisor with reference', 'Règle : revue humaine (quatre yeux). Comment le résoudre : contactez votre conseiller avec la référence')} {r.id.slice(0, 8)}.</Notice>}
      {r.status === 'rejected' && <FundsNeverLocked />}
      {r.status === 'failed' && <Notice tone="bad" title={tr('Execution failed', 'Exécution échouée')}>{r.error} — {tr('please start the transaction again.', 'recommencez l’opération.')}</Notice>}
      {!['executed', 'rejected', 'cancelled', 'failed', 'executing'].includes(r.status) && (
        <Button
          variant="ghost"
          onClick={async () => {
            await cosigner.post(`/tx/${requestId}/cancel`);
            void reload();
          }}
        >
          {tr('Cancel this transaction', 'Annuler cette opération')}
        </Button>
      )}
      {r.status === 'cancelled' && <Notice title={tr('Cancelled', 'Annulée')}>{tr('Nothing was sent.', 'Rien n’a été envoyé.')}</Notice>}
    </div>
  );
}
