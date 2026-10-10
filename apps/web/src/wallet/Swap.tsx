// Demo exchange (Swaplet → Échanger). There is no USDC/ETH liquidity we can rely on for Circle's test USDC on
// Sepolia, so this flow shows a REAL server-side quote calculation (commission per plan, slippage, minimum
// received, expiry) but NEVER executes a transaction. It is labelled as a demonstration everywhere.

import { useEffect, useState } from 'react';
import { Fingerprint, KeyRound } from 'lucide-react';
import { cosigner, ApiError } from '../lib/api';
import { passkeyAssertion } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { Money, useMasked } from '../lib/prefs';
import { locale, tr } from '../lib/i18n';
import { Button, Card, cx, Field, inputCls, MockBadge, Notice, Spinner, useCountdown } from '../components/ui';

export default function Swap() {
  const { device } = useLocal();
  const clientId = device!.clientId;
  const [from, setFrom] = useState<'USDC' | 'ETH'>('USDC');
  const [amount, setAmount] = useState('500');
  const [slip, setSlip] = useState(50);
  const [q, setQ] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const left = useCountdown(q?.expiresAt);
  const masked = useMasked();
  const m = (txt: string) => (masked ? '••••••' : txt);

  const quote = async (why?: string) => {
    setBusy(true);
    setMsg(why ? { tone: 'warn', text: why } : null);
    try {
      setQ(await cosigner.post('/swap/quote', { clientId, from, amount, slippageBps: slip }));
    } catch (e: any) {
      setQ(null);
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (q && left === 0) void quote(tr('The quote expired: it has been recalculated. Check it before confirming.', 'La cotation a expiré : elle a été recalculée. Vérifiez-la avant de confirmer.'));
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  // any change of the parameters invalidates the quote
  useEffect(() => setQ(null), [from, amount, slip]);

  const confirm = async () => {
    setBusy(true);
    try {
      const auth = useCode ? { backupCode: code } : { webauthn: await passkeyAssertion(q.authOptions) };
      const r = await cosigner.post('/swap/confirm', { clientId, quoteId: q.id, ...auth });
      setQ(null);
      setMsg({ tone: 'ok', text: r.message });
    } catch (e: any) {
      if (e instanceof ApiError && ['conditions-changed', 'preview-expired', 'preview-used'].includes(e.body?.code)) await quote(e.message);
      else setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Verification cancelled.', 'Vérification annulée.') : e.message });
    } finally {
      setBusy(false);
    }
  };

  const to = from === 'USDC' ? 'ETH' : 'USDC';
  return (
    <div className="space-y-4">
      <Notice tone="warn" title={tr('Demo swap', 'Échange de démonstration')}>
        {tr('The quote is calculated by the server (commission per your plan, slippage, minimum received), but no transaction is executed and your balances don’t change.', 'La cotation est calculée par le serveur (commission selon votre offre, glissement, minimum reçu), mais aucune transaction n’est exécutée et vos soldes ne changent pas.')} <MockBadge />
      </Notice>
      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
          {(['USDC', 'ETH'] as const).map((a) => (
            <button key={a} type="button" aria-pressed={from === a} onClick={() => { setFrom(a); setAmount(a === 'USDC' ? '500' : '0.1'); }} className={cx('min-h-11 rounded-[8px] text-[14px]', from === a ? 'bg-sq-surface font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {a} → {a === 'USDC' ? 'ETH' : 'USDC'}
            </button>
          ))}
        </div>
        <Field label={tr(`You swap (${from})`, `Vous échangez (${from})`)}>
          <input className={cx(inputCls, 'num text-[18px]')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
        </Field>
        <Field label={tr('Slippage tolerance', 'Tolérance de glissement')}>
          <div className="flex gap-2">
            {[10, 50, 100].map((b) => (
              <button key={b} type="button" aria-pressed={slip === b} onClick={() => setSlip(b)} className={cx('min-h-10 rounded-full border px-3 text-[14px]', slip === b ? 'border-sq-chip bg-sq-chip font-medium' : 'border-sq-line bg-sq-surface')}>
                {(b / 100).toLocaleString(locale())} %
              </button>
            ))}
          </div>
        </Field>
        {!q && (
          <Button onClick={() => quote()} disabled={busy || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : tr('Get a quote', 'Obtenir une cotation')}
          </Button>
        )}
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {q && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{tr('Preview (estimate)', 'Aperçu (estimation)')}</h3>
            <span className={cx('num text-[12px]', left <= 10 ? 'mw-important-text text-sq-warn' : 'text-sq-muted')}>{tr(`Quote valid for ${left} s`, `Cotation valable encore ${left} s`)}</span>
          </div>
          <p className="text-[15px]">
            {tr('You swap', 'Vous échangez')} <b>{q.amountIn} {q.from}</b>. {tr('You will receive at least', 'Vous recevrez au minimum')} <b>{q.minOut} {q.to}</b> ({tr('estimate:', 'estimation :')} {q.expectedOut} {q.to}).
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-sq-muted">{tr('Demo rate', 'Cours de démonstration')}</dt>
            <dd className="num text-right">
              1 ETH ≈ {q.priceUsdcPerEth.toFixed(2)} USDC
              <span className="block text-[11px] text-sq-muted">{tr('Demo quote based on the indicative market price — not executable', 'Cotation de démo basée sur le cours indicatif — non exécutable')}</span>
            </dd>
            <dt className="text-sq-muted">{tr('Slippage tolerance', 'Tolérance de glissement')}</dt>
            <dd className="num text-right">{(q.slippageBps / 100).toLocaleString(locale())} %</dd>
            <dt className="text-sq-muted">{tr('Service commission', 'Commission de service')} ({q.tier === 'free' ? tr('Free', 'Gratuit') : q.tier === 'plus' ? 'Plus' : 'Pro'}, {(q.commissionBps / 100).toFixed(2)} %)</dt>
            <dd className="num text-right">
              {q.commission} {q.from}
            </dd>
            <dt className="text-sq-muted">{tr('Network fee (estimated)', 'Frais réseau (estimés)')}</dt>
            <dd className="num text-right">
              {typeof q.networkFee.chf === 'number' ? `${q.networkFee.chf.toFixed(2)} CHF` : `${Number(q.networkFee.eth ?? 0).toFixed(6)} ETH`} {q.networkFee.demo && <MockBadge label={tr('Demo', 'Démo')} />}
              {q.networkFee.chf === null && <span className="block text-[12px] text-sq-warn">{tr('CHF value unavailable (no ETH market price)', 'Contre-valeur CHF indisponible (pas de cours ETH)')}</span>}
              {q.networkFee.rate && <span className="block text-[11px] text-sq-muted">{tr('indicative', 'indicatif')} · {q.networkFee.rate.provider}</span>}
              <span className="block text-[12px] text-sq-up">{tr('paid by Swissquote', 'offerts par Swissquote')}</span>
            </dd>
            <dt className="text-sq-muted">{tr('Estimated balance for fees (ETH)', 'Solde estimé pour les frais (ETH)')}</dt>
            <dd className="num text-right">
              <Money value={Number(q.balances.ethForFees)} decimals={5} unit="ETH" />
            </dd>
          </dl>
          <div className="rounded-[10px] bg-sq-bg p-3 text-[13px]">
            <div className="mb-1 font-medium">{tr('Your wallet before → after (estimate)', 'Votre wallet avant → après (estimation)')}</div>
            <div className="num">
              USDC : <Money value={Number(q.balances.before.usdc)} /> → {q.from === 'USDC' ? <Money value={Number(q.balances.after.usdc)} /> : <>{m(q.balances.after.usdc)}</>}
            </div>
            <div className="num">
              ETH : <Money value={Number(q.balances.before.eth)} decimals={5} /> → {q.from === 'ETH' ? <Money value={Number(q.balances.after.eth)} decimals={5} /> : m(q.balances.after.eth)}
            </div>
          </div>
          {q.insufficient && <Notice tone="warn">{tr(`Insufficient ${q.from} balance in your wallet: for real, this swap would be refused.`, `Solde ${q.from} insuffisant sur votre wallet : en réel, cet échange serait refusé.`)}</Notice>}
          {useCode ? (
            <Field label={tr('Backup code (12 characters)', 'Code de secours (12 caractères)')}>
              <input className={cx(inputCls, 'font-mono uppercase tracking-widest')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} />
            </Field>
          ) : null}
          <Button onClick={confirm} disabled={busy || (useCode && code.length !== 12)}>
            {busy ? <Spinner /> : useCode ? (
              <>
                <KeyRound size={18} strokeWidth={1.75} /> {tr('Confirm (demo) with the backup code', 'Confirmer (démo) avec le code de secours')}
              </>
            ) : (
              <>
                <Fingerprint size={18} strokeWidth={1.75} /> {tr('Confirm (demo) with my passkey', 'Confirmer (démo) avec ma passkey')}
              </>
            )}
          </Button>
          {q.backupCodeAvailable && (
            <button type="button" className="mx-auto block min-h-10 text-[13px] underline underline-offset-4" onClick={() => setUseCode((v) => !v)}>
              {useCode ? tr('Use my passkey instead', 'Utiliser plutôt ma passkey') : tr('Use my backup code', 'Utiliser mon code de secours')}
            </button>
          )}
          <p className="text-[12px] text-sq-muted">{tr('Demo: no transaction will be executed.', 'Démonstration : aucune transaction ne sera exécutée.')}</p>
        </Card>
      )}
    </div>
  );
}
