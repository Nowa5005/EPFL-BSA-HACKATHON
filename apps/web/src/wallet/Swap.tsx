// Demo exchange (Swaplet → Échanger). There is no USDC/ETH liquidity we can rely on for Circle's test USDC on
// Sepolia, so this flow shows a REAL server-side quote calculation (commission per plan, slippage, minimum
// received, expiry) but NEVER executes a transaction. It is labelled as a demonstration everywhere.

import { useEffect, useState } from 'react';
import { Fingerprint, KeyRound } from 'lucide-react';
import { cosigner, ApiError } from '../lib/api';
import { passkeyAssertion } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { Money, useMasked } from '../lib/prefs';
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
    if (q && left === 0) void quote('La cotation a expiré : elle a été recalculée. Vérifiez-la avant de confirmer.');
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
      else setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? 'Vérification annulée.' : e.message });
    } finally {
      setBusy(false);
    }
  };

  const to = from === 'USDC' ? 'ETH' : 'USDC';
  return (
    <div className="space-y-4">
      <Notice tone="warn" title="Échange de démonstration">
        La cotation est calculée par le serveur (commission selon votre offre, glissement, minimum reçu), mais aucune transaction n’est exécutée et vos soldes ne changent pas. <MockBadge />
      </Notice>
      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
          {(['USDC', 'ETH'] as const).map((a) => (
            <button key={a} type="button" aria-pressed={from === a} onClick={() => { setFrom(a); setAmount(a === 'USDC' ? '500' : '0.1'); }} className={cx('min-h-11 rounded-[8px] text-[14px]', from === a ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {a} → {a === 'USDC' ? 'ETH' : 'USDC'}
            </button>
          ))}
        </div>
        <Field label={`Vous échangez (${from})`}>
          <input className={cx(inputCls, 'num text-[18px]')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
        </Field>
        <Field label="Tolérance de glissement">
          <div className="flex gap-2">
            {[10, 50, 100].map((b) => (
              <button key={b} type="button" aria-pressed={slip === b} onClick={() => setSlip(b)} className={cx('min-h-10 rounded-full border px-3 text-[14px]', slip === b ? 'border-sq-chip bg-sq-chip font-medium' : 'border-sq-line bg-white')}>
                {(b / 100).toLocaleString('fr-CH')} %
              </button>
            ))}
          </div>
        </Field>
        {!q && (
          <Button onClick={() => quote()} disabled={busy || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : 'Obtenir une cotation'}
          </Button>
        )}
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {q && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Aperçu (estimation)</h3>
            <span className={cx('num text-[12px]', left <= 10 ? 'mw-important-text text-sq-warn' : 'text-sq-muted')}>Cotation valable encore {left} s</span>
          </div>
          <p className="text-[15px]">
            Vous échangez <b>{q.amountIn} {q.from}</b>. Vous recevrez au minimum <b>{q.minOut} {q.to}</b> (estimation : {q.expectedOut} {q.to}).
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-sq-muted">Cours de démonstration</dt>
            <dd className="num text-right">1 ETH ≈ {q.priceUsdcPerEth.toFixed(2)} USDC</dd>
            <dt className="text-sq-muted">Tolérance de glissement</dt>
            <dd className="num text-right">{(q.slippageBps / 100).toLocaleString('fr-CH')} %</dd>
            <dt className="text-sq-muted">Commission de service ({q.tier === 'free' ? 'Gratuit' : q.tier === 'plus' ? 'Plus' : 'Pro'}, {(q.commissionBps / 100).toFixed(2)} %)</dt>
            <dd className="num text-right">
              {q.commission} {q.from}
            </dd>
            <dt className="text-sq-muted">Frais réseau (estimés)</dt>
            <dd className="num text-right">
              {q.networkFee.chf.toFixed(2)} CHF {q.networkFee.demo && <MockBadge label="Démo" />} <span className="block text-[12px] text-sq-up">offerts par Swissquote</span>
            </dd>
            <dt className="text-sq-muted">Solde estimé pour les frais (ETH)</dt>
            <dd className="num text-right">
              <Money value={Number(q.balances.ethForFees)} decimals={5} unit="ETH" />
            </dd>
          </dl>
          <div className="rounded-[10px] bg-sq-bg p-3 text-[13px]">
            <div className="mb-1 font-medium">Votre wallet avant → après (estimation)</div>
            <div className="num">
              USDC : <Money value={Number(q.balances.before.usdc)} /> → {q.from === 'USDC' ? <Money value={Number(q.balances.after.usdc)} /> : <>{m(q.balances.after.usdc)}</>}
            </div>
            <div className="num">
              ETH : <Money value={Number(q.balances.before.eth)} decimals={5} /> → {q.from === 'ETH' ? <Money value={Number(q.balances.after.eth)} decimals={5} /> : m(q.balances.after.eth)}
            </div>
          </div>
          {q.insufficient && <Notice tone="warn">Solde {q.from} insuffisant sur votre wallet : en réel, cet échange serait refusé.</Notice>}
          {useCode ? (
            <Field label="Code de secours (12 caractères)">
              <input className={cx(inputCls, 'font-mono uppercase tracking-widest')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} />
            </Field>
          ) : null}
          <Button onClick={confirm} disabled={busy || (useCode && code.length !== 12)}>
            {busy ? <Spinner /> : useCode ? (
              <>
                <KeyRound size={18} strokeWidth={1.75} /> Confirmer (démo) avec le code de secours
              </>
            ) : (
              <>
                <Fingerprint size={18} strokeWidth={1.75} /> Confirmer (démo) avec ma passkey
              </>
            )}
          </Button>
          {q.backupCodeAvailable && (
            <button type="button" className="mx-auto block min-h-10 text-[13px] underline underline-offset-4" onClick={() => setUseCode((v) => !v)}>
              {useCode ? 'Utiliser plutôt ma passkey' : 'Utiliser mon code de secours'}
            </button>
          )}
          <p className="text-[12px] text-sq-muted">Démonstration : aucune transaction ne sera exécutée.</p>
        </Card>
      )}
    </div>
  );
}
