// Subscriptions & fees. Prices and the plan entitlement/commission are computed SERVER-side;
// no payment provider is configured, so subscribing runs in an explicit demo mode: nothing is charged.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PLANS, breakEvenCents, cheapestTier, euros, installments, monthlyCostCents, type Billing, type Tier } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Button, Card, cx, dateOnly, Field, inputCls, MockBadge, Notice, PageHeader } from '../components/ui';

const BILLING_LABEL: Record<Billing, string> = { monthly: 'Mensuel, résiliable à la prochaine échéance', 'annual-upfront': 'Annuel, paiement unique', 'annual-installments': 'Annuel en 12 mensualités (engagement 12 mois)' };
const pct = (bps: number) => `${(bps / 100).toFixed(2)} %`;

function priceLines(tier: Tier) {
  const p = PLANS[tier];
  if (tier === 'free') return [{ billing: null, text: '0 € — sans abonnement' }];
  const inst = installments(p.annualInstallmentsTotalCents!);
  const instText = inst.every((x) => x === inst[0]) ? `12 × ${euros(inst[0])} € = ${euros(p.annualInstallmentsTotalCents!)} €` : `11 × ${euros(inst[0])} € + 1 × ${euros(inst[11])} € = ${euros(p.annualInstallmentsTotalCents!)} €`;
  return [
    { billing: 'monthly' as Billing, text: `${euros(p.monthlyCents)} € / mois` },
    { billing: 'annual-upfront' as Billing, text: `${euros(p.annualUpfrontCents!)} € / an, en une fois` },
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
      setMsg({ tone: 'ok', text: `Abonnement ${PLANS[choice.tier].name} activé en mode démonstration : aucun paiement n’a été débité.` });
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
      <PageHeader title="Abonnements et frais" back="/wallet/more" subtitle="Réduisez la commission de service sur vos échanges. Les envois et réceptions restent sans commission." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="text-[13px] text-sq-muted">Votre offre</div>
          <div className="text-[18px] font-semibold">
            {PLANS[current].name} · commission {pct(PLANS[current].commissionBps)}
          </div>
          {s && s.status !== 'ended' && (
            <div className="text-[13px] text-sq-ink-2">
              {BILLING_LABEL[s.billing as Billing]} · {s.status === 'cancel-at-period-end' ? `se termine le ${dateOnly(s.currentPeriodEnd)}` : `prochaine échéance le ${dateOnly(s.schedule.find((x: any) => x.status === 'scheduled')?.dueAt ?? s.currentPeriodEnd)}`}
              {s.commitmentEnd && ` · engagement jusqu’au ${dateOnly(s.commitmentEnd)}`}
            </div>
          )}
        </div>
        {s && s.status === 'active' && (
          <Button variant="secondary" className="w-auto px-4" onClick={cancel}>
            {s.billing === 'annual-installments' ? 'Ne pas renouveler' : 'Résilier'}
          </Button>
        )}
        <MockBadge label="Paiement démo" />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {(['free', 'plus', 'pro'] as Tier[]).map((t) => {
          const p = PLANS[t];
          return (
            <Card key={t} className={cx('flex flex-col gap-3', current === t && 'ring-2 ring-sq-orange')}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[18px] font-semibold">{p.name}</h2>
                {current === t && <span className="text-[12px] font-semibold text-sq-orange-600">Offre actuelle</span>}
              </div>
              <div>
                <div className="num text-[26px] font-semibold">{pct(p.commissionBps)}</div>
                <div className="text-[13px] text-sq-muted">commission sur les échanges éligibles{t === 'plus' ? ' (−50 %)' : t === 'pro' ? ' (−75 %)' : ''}, sans limite de nombre d’opérations</div>
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
          <h2 className="text-[17px] font-semibold">Récapitulatif avant souscription</h2>
          <SubscriptionSummary tier={choice.tier} billing={choice.billing} />
          <label className="flex min-h-11 items-start gap-2 text-[14px]">
            <input type="checkbox" className="mt-1 accent-[var(--color-sq-orange)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>J’ai lu le coût total et les conditions ci-dessus{choice.billing === 'annual-installments' ? ', y compris l’engagement de 12 mois' : ''}.</span>
          </label>
          <Button onClick={subscribe} disabled={!accept}>
            Souscrire — démonstration, aucun débit
          </Button>
          <p className="text-[12px] text-sq-muted">Aucun prestataire de paiement n’est configuré dans ce prototype : la souscription est simulée et rien n’est facturé.</p>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-[17px] font-semibold">Comparateur de coût mensuel</h2>
        <Field label="Volume échangé par mois (€)" hint="Le volume est le total de vos échanges éligibles sur le mois, pas le solde détenu. Frais réseau et partenaires identiques exclus.">
          <input className={cx(inputCls, 'num')} inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-sq-muted">
              <th className="py-1 font-medium">Offre</th>
              <th className="py-1 font-medium">Calcul (paiement mensuel)</th>
              <th className="py-1 text-right font-medium">Coût / mois</th>
            </tr>
          </thead>
          <tbody>
            {(['free', 'plus', 'pro'] as Tier[]).map((t) => (
              <tr key={t} className={cx('border-t border-sq-line', best === t && 'font-semibold')}>
                <td className="py-2">
                  {PLANS[t].name}
                  {best === t && <span className="ml-2 rounded-[4px] bg-sq-ok-50 px-1.5 py-px text-[11px] text-sq-up">le moins cher</span>}
                </td>
                <td className="num py-2 text-sq-ink-2">{PLANS[t].monthlyCents ? `${euros(PLANS[t].monthlyCents)} + ` : ''}volume × {(PLANS[t].commissionBps / 10000).toFixed(3)}</td>
                <td className="num py-2 text-right">{euros(monthlyCostCents(t, vCents))} €</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-sq-ink-2">
          Plus devient avantageux face à Gratuit au-delà de <b>{euros(breakEvenCents('free', 'plus'))} €</b> échangés par mois ; Pro devient préférable à Plus au-delà de <b>{euros(breakEvenCents('plus', 'pro'))} €</b>.
        </p>
      </Card>

      <Card id="frais" className="scroll-mt-24 space-y-3">
        <h2 className="text-[17px] font-semibold">Quels frais s’appliquent ?</h2>
        <dl className="space-y-3 text-[14px]">
          <div>
            <dt className="font-semibold">Envoyer</dt>
            <dd className="text-sq-ink-2">Aucune commission de service. Frais réseau Ethereum estimés dans l’aperçu et payés par Swissquote (dans la limite de 20 opérations offertes par jour).</dd>
          </div>
          <div>
            <dt className="font-semibold">Recevoir</dt>
            <dd className="text-sq-ink-2">Gratuit. Les frais réseau sont payés par l’émetteur ; depuis votre compte Swissquote, ils sont offerts.</dd>
          </div>
          <div>
            <dt className="font-semibold">Échanger (échanges éligibles)</dt>
            <dd className="text-sq-ink-2">
              Commission de service selon votre offre : Gratuit {pct(PLANS.free.commissionBps)}, Plus {pct(PLANS.plus.commissionBps)}, Pro {pct(PLANS.pro.commissionBps)}. La réduction porte uniquement sur notre commission, pas sur les frais réseau ni ceux des partenaires. Aucun supplément caché dans le cours : le montant total est affiché avant confirmation.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Autorisations et révocations</dt>
            <dd className="text-sq-ink-2">Aucune commission ; frais réseau offerts.</dd>
          </div>
        </dl>
        <p className="text-[12px] text-sq-muted">Le taux de 0,80 % est une hypothèse produit pour les échanges éligibles, pas une moyenne de marché validée. Une tarification des transferts n’est pas active.</p>
      </Card>
    </div>
  );
}

function SubscriptionSummary({ tier, billing }: { tier: Exclude<Tier, 'free'>; billing: Billing }) {
  const p = PLANS[tier];
  const inst = installments(p.annualInstallmentsTotalCents!);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
      <dt className="text-sq-muted">Offre</dt>
      <dd>
        {p.name} — commission {pct(p.commissionBps)} sur les échanges éligibles
      </dd>
      <dt className="text-sq-muted">Paiement</dt>
      <dd>{BILLING_LABEL[billing]}</dd>
      <dt className="text-sq-muted">Coût total</dt>
      <dd className="num font-semibold">
        {billing === 'monthly' ? `${euros(p.monthlyCents)} € par mois (${euros(p.monthlyCents * 12)} € sur 12 mois)` : billing === 'annual-upfront' ? `${euros(p.annualUpfrontCents!)} € payés aujourd’hui pour 12 mois` : `${euros(p.annualInstallmentsTotalCents!)} € sur 12 mois`}
      </dd>
      {billing === 'annual-installments' && (
        <>
          <dt className="text-sq-muted">Échéancier</dt>
          <dd className="num">{inst.every((x) => x === inst[0]) ? `12 × ${euros(inst[0])} €` : `11 × ${euros(inst[0])} € puis 1 × ${euros(inst[11])} €`}</dd>
        </>
      )}
      <dt className="text-sq-muted">Conditions</dt>
      <dd className="text-sq-ink-2">
        {billing === 'monthly'
          ? 'Sans engagement : résiliable à tout moment, effet à la prochaine échéance.'
          : billing === 'annual-upfront'
            ? 'Paiement unique pour 12 mois ; pas de renouvellement si vous résiliez avant l’échéance.'
            : 'Engagement de 12 mois : les 12 mensualités restent dues même en cas de résiliation ; il ne s’agit pas d’un abonnement mensuel.'}
      </dd>
    </dl>
  );
}
