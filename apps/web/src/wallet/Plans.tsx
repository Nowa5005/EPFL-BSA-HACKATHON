// Subscriptions & fees. Prices and the plan entitlement/commission are computed SERVER-side;
// no payment provider is configured, so subscribing runs in an explicit demo mode: nothing is charged.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PLANS, breakEvenCents, cheapestTier, euros, installments, monthlyCostCents, type Billing, type Tier } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Button, Card, cx, dateOnly, Field, inputCls, MockBadge, Notice, PageHeader } from '../components/ui';
import { tr } from '../lib/i18n';

const BILLING_LABEL: Record<Billing, string> = {
  monthly: tr('Monthly, cancellable at the next due date', 'Mensuel, résiliable à la prochaine échéance'),
  'annual-upfront': tr('Annual, single payment', 'Annuel, paiement unique'),
  'annual-installments': tr('Annual in 12 monthly instalments (12-month commitment)', 'Annuel en 12 mensualités (engagement 12 mois)'),
};
/** Display name of a plan (the shared PLANS table holds the French name of the free tier). */
const planName = (t: Tier) => (t === 'free' ? tr('Free', PLANS.free.name) : PLANS[t].name);
const pct = (bps: number) => `${(bps / 100).toFixed(2)} %`;

function priceLines(tier: Tier) {
  const p = PLANS[tier];
  if (tier === 'free') return [{ billing: null, text: tr('€0 — no subscription', '0 € — sans abonnement') }];
  const inst = installments(p.annualInstallmentsTotalCents!);
  const instText = inst.every((x) => x === inst[0]) ? `12 × ${euros(inst[0])} € = ${euros(p.annualInstallmentsTotalCents!)} €` : `11 × ${euros(inst[0])} € + 1 × ${euros(inst[11])} € = ${euros(p.annualInstallmentsTotalCents!)} €`;
  return [
    { billing: 'monthly' as Billing, text: tr(`${euros(p.monthlyCents)} € / month`, `${euros(p.monthlyCents)} € / mois`) },
    { billing: 'annual-upfront' as Billing, text: tr(`${euros(p.annualUpfrontCents!)} € / year, paid once`, `${euros(p.annualUpfrontCents!)} € / an, en une fois`) },
    { billing: 'annual-installments' as Billing, text: instText },
  ];
}

export default function Plans() {
  const { device } = useLocal();
  const clientId = device!.clientId;
  const loc = useLocation();
  const { data: sub, reload } = usePoll<any>(() => cosigner.get(`/clients/${clientId}/subscription`), 30000, [clientId]);
  const [choice, setChoice] = useState<{ tier: Exclude<Tier, 'free'>; billing: Billing } | null>(null);
  const [accept, setAccept] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [volume, setVolume] = useState('2000');

  useEffect(() => {
    if (loc.hash === '#frais') document.getElementById('frais')?.scrollIntoView({ behavior: 'smooth' });
  }, [loc.hash]);

  const subscribe = async () => {
    if (!choice) return;
    setMsg(null);
    try {
      await cosigner.post(`/clients/${clientId}/subscription`, { ...choice, acceptTerms: accept });
      setMsg({ tone: 'ok', text: tr(`${planName(choice.tier)} subscription activated in demo mode: no payment was charged.`, `Abonnement ${PLANS[choice.tier].name} activé en mode démonstration : aucun paiement n’a été débité.`) });
      setChoice(null);
      setAccept(false);
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    }
  };
  const cancel = async () => {
    const r = await cosigner.post(`/clients/${clientId}/subscription/cancel`);
    setMsg({ tone: 'info', text: r.message });
    void reload();
  };

  const vCents = Math.max(0, Math.round(Number(volume || 0) * 100));
  const best = cheapestTier(vCents);
  const current: Tier = sub?.tier ?? 'free';
  const s = sub?.subscription;

  return (
    <div className="space-y-5">
      <PageHeader title={tr('Plans & fees', 'Abonnements et frais')} back="/wallet/more" subtitle={tr('Lower the service commission on your swaps. Sending and receiving stay commission-free.', 'Réduisez la commission de service sur vos échanges. Les envois et réceptions restent sans commission.')} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="text-[13px] text-sq-muted">{tr('Your plan', 'Votre offre')}</div>
          <div className="text-[18px] font-semibold">
            {planName(current)} · commission {pct(PLANS[current].commissionBps)}
          </div>
          {s && s.status !== 'ended' && (
            <div className="text-[13px] text-sq-ink-2">
              {BILLING_LABEL[s.billing as Billing]} · {s.status === 'cancel-at-period-end' ? `${tr('ends on', 'se termine le')} ${dateOnly(s.currentPeriodEnd)}` : `${tr('next due date', 'prochaine échéance le')} ${dateOnly(s.schedule.find((x: any) => x.status === 'scheduled')?.dueAt ?? s.currentPeriodEnd)}`}
              {s.commitmentEnd && ` · ${tr('committed until', 'engagement jusqu’au')} ${dateOnly(s.commitmentEnd)}`}
            </div>
          )}
        </div>
        {s && s.status === 'active' && (
          <Button variant="secondary" className="w-auto px-4" onClick={cancel}>
            {s.billing === 'annual-installments' ? tr('Don’t renew', 'Ne pas renouveler') : tr('Cancel', 'Résilier')}
          </Button>
        )}
        <MockBadge label={tr('Demo payment', 'Paiement démo')} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {(['free', 'plus', 'pro'] as Tier[]).map((t) => {
          const p = PLANS[t];
          return (
            <Card key={t} className={cx('flex flex-col gap-3', current === t && 'ring-2 ring-sq-orange')}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[18px] font-semibold">{planName(t)}</h2>
                {current === t && <span className="text-[12px] font-semibold text-sq-orange-600">{tr('Current plan', 'Offre actuelle')}</span>}
              </div>
              <div>
                <div className="num text-[26px] font-semibold">{pct(p.commissionBps)}</div>
                <div className="text-[13px] text-sq-muted">{tr('commission on eligible swaps', 'commission sur les échanges éligibles')}{t === 'plus' ? ' (−50 %)' : t === 'pro' ? ' (−75 %)' : ''}{tr(', no limit on the number of operations', ', sans limite de nombre d’opérations')}</div>
              </div>
              <ul className="space-y-1.5 text-[14px]">
                {priceLines(t).map((l) => (
                  <li key={l.text}>
                    {l.billing ? (
                      <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-[8px] px-1 hover:bg-sq-bg">
                        <input type="radio" name="plan" className="mt-1 accent-[var(--color-sq-orange)]" checked={choice?.tier === t && choice.billing === l.billing} onChange={() => setChoice({ tier: t as Exclude<Tier, 'free'>, billing: l.billing! })} />
                        <span>
                          <span className="num font-medium">{l.text}</span>
                          <span className="block text-[12px] text-sq-muted">{BILLING_LABEL[l.billing]}</span>
                        </span>
                      </label>
                    ) : (
                      <span className="flex items-center gap-2 px-1">
                        <Check size={16} strokeWidth={2} className="text-sq-up" /> {l.text}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {choice && (
        <Card className="space-y-3">
          <h2 className="text-[17px] font-semibold">{tr('Summary before subscribing', 'Récapitulatif avant souscription')}</h2>
          <SubscriptionSummary tier={choice.tier} billing={choice.billing} />
          <label className="flex min-h-11 items-start gap-2 text-[14px]">
            <input type="checkbox" className="mt-1 accent-[var(--color-sq-orange)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>{tr('I have read the total cost and the terms above', 'J’ai lu le coût total et les conditions ci-dessus')}{choice.billing === 'annual-installments' ? tr(', including the 12-month commitment', ', y compris l’engagement de 12 mois') : ''}.</span>
          </label>
          <Button onClick={subscribe} disabled={!accept}>
            {tr('Subscribe — demo, nothing charged', 'Souscrire — démonstration, aucun débit')}
          </Button>
          <p className="text-[12px] text-sq-muted">{tr('No payment provider is configured in this prototype: the subscription is simulated and nothing is billed.', 'Aucun prestataire de paiement n’est configuré dans ce prototype : la souscription est simulée et rien n’est facturé.')}</p>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-[17px] font-semibold">{tr('Monthly cost comparison', 'Comparateur de coût mensuel')}</h2>
        <Field label={tr('Volume swapped per month (€)', 'Volume échangé par mois (€)')} hint={tr('Volume is the total of your eligible swaps in the month, not the balance held. Network and partner fees (identical) excluded.', 'Le volume est le total de vos échanges éligibles sur le mois, pas le solde détenu. Frais réseau et partenaires identiques exclus.')}>
          <input className={cx(inputCls, 'num')} inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-sq-muted">
              <th className="py-1 font-medium">{tr('Plan', 'Offre')}</th>
              <th className="py-1 font-medium">{tr('Calculation (monthly payment)', 'Calcul (paiement mensuel)')}</th>
              <th className="py-1 text-right font-medium">{tr('Cost / month', 'Coût / mois')}</th>
            </tr>
          </thead>
          <tbody>
            {(['free', 'plus', 'pro'] as Tier[]).map((t) => (
              <tr key={t} className={cx('border-t border-sq-line', best === t && 'font-semibold')}>
                <td className="py-2">
                  {planName(t)}
                  {best === t && <span className="ml-2 rounded-[4px] bg-sq-ok-50 px-1.5 py-px text-[11px] text-sq-up">{tr('cheapest', 'le moins cher')}</span>}
                </td>
                <td className="num py-2 text-sq-ink-2">{PLANS[t].monthlyCents ? `${euros(PLANS[t].monthlyCents)} + ` : ''}{tr('volume', 'volume')} × {(PLANS[t].commissionBps / 10000).toFixed(3)}</td>
                <td className="num py-2 text-right">{euros(monthlyCostCents(t, vCents))} €</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-sq-ink-2">
          {tr('Plus beats Free above', 'Plus devient avantageux face à Gratuit au-delà de')} <b>{euros(breakEvenCents('free', 'plus'))} €</b> {tr('swapped per month; Pro beats Plus above', 'échangés par mois ; Pro devient préférable à Plus au-delà de')} <b>{euros(breakEvenCents('plus', 'pro'))} €</b>.
        </p>
      </Card>

      <Card id="frais" className="scroll-mt-24 space-y-3">
        <h2 className="text-[17px] font-semibold">{tr('Which fees apply?', 'Quels frais s’appliquent ?')}</h2>
        <dl className="space-y-3 text-[14px]">
          <div>
            <dt className="font-semibold">{tr('Send', 'Envoyer')}</dt>
            <dd className="text-sq-ink-2">{tr('No service commission. Ethereum network fees are estimated in the preview and paid by Swissquote (up to 20 free operations per day).', 'Aucune commission de service. Frais réseau Ethereum estimés dans l’aperçu et payés par Swissquote (dans la limite de 20 opérations offertes par jour).')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{tr('Receive', 'Recevoir')}</dt>
            <dd className="text-sq-ink-2">{tr('Free. Network fees are paid by the sender; from your Swissquote account, they are covered for you.', 'Gratuit. Les frais réseau sont payés par l’émetteur ; depuis votre compte Swissquote, ils sont offerts.')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{tr('Swap (eligible swaps)', 'Échanger (échanges éligibles)')}</dt>
            <dd className="text-sq-ink-2">
              {tr('Service commission depending on your plan:', 'Commission de service selon votre offre :')} {planName('free')} {pct(PLANS.free.commissionBps)}, Plus {pct(PLANS.plus.commissionBps)}, Pro {pct(PLANS.pro.commissionBps)}.{' '}
              {tr('The discount only applies to our commission, not to network or partner fees. No hidden mark-up in the rate: the total amount is shown before confirmation.', 'La réduction porte uniquement sur notre commission, pas sur les frais réseau ni ceux des partenaires. Aucun supplément caché dans le cours : le montant total est affiché avant confirmation.')}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{tr('Approvals and revocations', 'Autorisations et révocations')}</dt>
            <dd className="text-sq-ink-2">{tr('No commission; network fees covered.', 'Aucune commission ; frais réseau offerts.')}</dd>
          </div>
        </dl>
        <p className="text-[12px] text-sq-muted">{tr('The 0.80% rate is a product assumption for eligible swaps, not a validated market average. No pricing is active for transfers.', 'Le taux de 0,80 % est une hypothèse produit pour les échanges éligibles, pas une moyenne de marché validée. Une tarification des transferts n’est pas active.')}</p>
      </Card>
    </div>
  );
}

function SubscriptionSummary({ tier, billing }: { tier: Exclude<Tier, 'free'>; billing: Billing }) {
  const p = PLANS[tier];
  const inst = installments(p.annualInstallmentsTotalCents!);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
      <dt className="text-sq-muted">{tr('Plan', 'Offre')}</dt>
      <dd>
        {planName(tier)} — commission {pct(p.commissionBps)} {tr('on eligible swaps', 'sur les échanges éligibles')}
      </dd>
      <dt className="text-sq-muted">{tr('Payment', 'Paiement')}</dt>
      <dd>{BILLING_LABEL[billing]}</dd>
      <dt className="text-sq-muted">{tr('Total cost', 'Coût total')}</dt>
      <dd className="num font-semibold">
        {billing === 'monthly'
          ? tr(`${euros(p.monthlyCents)} € per month (${euros(p.monthlyCents * 12)} € over 12 months)`, `${euros(p.monthlyCents)} € par mois (${euros(p.monthlyCents * 12)} € sur 12 mois)`)
          : billing === 'annual-upfront'
            ? tr(`${euros(p.annualUpfrontCents!)} € paid today for 12 months`, `${euros(p.annualUpfrontCents!)} € payés aujourd’hui pour 12 mois`)
            : tr(`${euros(p.annualInstallmentsTotalCents!)} € over 12 months`, `${euros(p.annualInstallmentsTotalCents!)} € sur 12 mois`)}
      </dd>
      {billing === 'annual-installments' && (
        <>
          <dt className="text-sq-muted">{tr('Schedule', 'Échéancier')}</dt>
          <dd className="num">{inst.every((x) => x === inst[0]) ? `12 × ${euros(inst[0])} €` : tr(`11 × ${euros(inst[0])} € then 1 × ${euros(inst[11])} €`, `11 × ${euros(inst[0])} € puis 1 × ${euros(inst[11])} €`)}</dd>
        </>
      )}
      <dt className="text-sq-muted">{tr('Terms', 'Conditions')}</dt>
      <dd className="text-sq-ink-2">
        {billing === 'monthly'
          ? tr('No commitment: cancel any time, effective at the next due date.', 'Sans engagement : résiliable à tout moment, effet à la prochaine échéance.')
          : billing === 'annual-upfront'
            ? tr('Single payment for 12 months; no renewal if you cancel before the due date.', 'Paiement unique pour 12 mois ; pas de renouvellement si vous résiliez avant l’échéance.')
            : tr('12-month commitment: all 12 instalments remain due even if you cancel; this is not a monthly subscription.', 'Engagement de 12 mois : les 12 mensualités restent dues même en cas de résiliation ; il ne s’agit pas d’un abonnement mensuel.')}
      </dd>
    </dl>
  );
}
