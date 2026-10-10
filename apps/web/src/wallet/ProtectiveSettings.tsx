// #16 — Protection under threat: the optional duress code and the daily limit chosen by the client
// (lowering immediate, raising only after a security delay). Server: services/sq-cosigner/src/duress.ts.

import { useState } from 'react';
import { Gauge, ShieldAlert } from 'lucide-react';
import { startAuthentication } from '../lib/passkeyGuard'; // guarded for the native app
import { cosigner } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { decryptDeviceKey } from '../lib/device';
import { duressProof } from '../lib/decoy';
import { Button, Card, cx, dateOnly, dateTime, Field, inputCls, Notice, SecretInput, Spinner, useCountdown, Why } from '../components/ui';
import { tr } from '../lib/i18n';

const cancelled = (e: any) => (e?.name === 'NotAllowedError' ? tr('Verification cancelled.', 'Vérification annulée.') : e?.message ?? String(e));

async function passkey(clientId: string, purpose: string, optionsPath = '/webauthn/auth/options', body: Record<string, unknown> = {}) {
  const options = await cosigner.post(optionsPath, { clientId, purpose, ...body });
  return startAuthentication({ optionsJSON: options });
}

export function DuressCodeCard({ clientId }: { clientId: string }) {
  const status = usePoll<{ configured: boolean; createdAt: string | null }>(() => cosigner.get(`/clients/${clientId}/duress-code`), 60000, [clientId]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const configured = !!status.data?.configured;

  const save = async () => {
    setMsg(null);
    if (code.length < 6) return setMsg({ tone: 'bad', text: tr('Use at least 6 characters.', 'Utilisez au moins 6 caractères.') });
    if (code !== again) return setMsg({ tone: 'bad', text: tr('The two entries don’t match.', 'Les deux saisies ne correspondent pas.') });
    setBusy(true);
    try {
      // It must never open the real wallet: refuse the wallet password itself (checked on this device only).
      const isPassword = await decryptDeviceKey(code).then(
        () => true,
        () => false,
      );
      if (isPassword) throw new Error(tr('The duress code must be different from your wallet password.', 'Le code de contrainte doit être différent de votre mot de passe du wallet.'));
      const webauthn = await passkey(clientId, 'duress-code');
      const proof = await duressProof(clientId, code); // only a derived value leaves the device; the server hashes it again
      await cosigner.post(`/clients/${clientId}/duress-code`, { proof, webauthn });
      setCode('');
      setAgain('');
      setOpen(false);
      setMsg({ tone: 'ok', text: tr('Duress code saved. Swissquote keeps only a fingerprint of it.', 'Code de contrainte enregistré. Swissquote n’en conserve qu’une empreinte.') });
      void status.reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: cancelled(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(tr('Remove the duress code?', 'Supprimer le code de contrainte ?'))) return;
    setBusy(true);
    setMsg(null);
    try {
      const webauthn = await passkey(clientId, 'duress-code');
      await cosigner.post(`/clients/${clientId}/duress-code/remove`, { webauthn });
      setMsg({ tone: 'ok', text: tr('Duress code removed.', 'Code de contrainte supprimé.') });
      void status.reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: cancelled(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="duress-code" className="scroll-mt-24 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Duress code (if you are forced to open My Wall)', 'Code de contrainte (si l’on vous force à ouvrir My Wall)')}</h2>
        <span className={cx('rounded-[4px] px-1.5 py-px text-[11px] font-semibold uppercase', configured ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-chip text-sq-muted')}>{configured ? tr('Active', 'Actif') : tr('Not set up', 'Non configuré')}</span>
      </div>
      <Why>
        {tr(
          'Optional. If someone forces you to unlock your wallet, type this code instead of your password. My Wall opens normally but shows a small balance that isn’t yours, and Swissquote silently stops co-signing anything for your wallet and is alerted. Nothing on the screen shows it. Afterwards, contact Swissquote to lift the freeze. Keep the code secret, easy to remember and different from your password.',
          'Facultatif. Si quelqu’un vous force à déverrouiller votre wallet, saisissez ce code à la place de votre mot de passe. My Wall s’ouvre normalement mais affiche un petit solde qui n’est pas le vôtre, et Swissquote cesse en silence de co-signer quoi que ce soit pour votre wallet et est alerté. Rien à l’écran ne le montre. Ensuite, contactez Swissquote pour lever le gel. Gardez ce code secret, facile à retenir et différent de votre mot de passe.',
        )}
      </Why>
      {configured && !open && status.data?.createdAt && <p className="text-[13px] text-sq-ink-2">{tr('Set up on', 'Configuré le')} {dateOnly(status.data.createdAt)}.</p>}
      {open ? (
        <div className="space-y-3">
          <Field label={tr('Duress code', 'Code de contrainte')} hint={tr('At least 6 characters, different from your wallet password.', 'Au moins 6 caractères, différent de votre mot de passe du wallet.')}>
            <SecretInput value={code} onChange={setCode} autoComplete="off" />
          </Field>
          <Field label={tr('Type it again', 'Saisissez-le à nouveau')}>
            <SecretInput value={again} onChange={setAgain} autoComplete="off" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="w-auto px-4" onClick={() => setOpen(false)} disabled={busy}>
              {tr('Cancel', 'Annuler')}
            </Button>
            <Button className="w-auto px-4" onClick={save} disabled={busy || !code || !again}>
              {busy ? <Spinner /> : tr('Save with my passkey', 'Enregistrer avec ma passkey')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="w-auto px-4" onClick={() => (setOpen(true), setMsg(null))} disabled={busy}>
            {configured ? tr('Change the duress code', 'Changer le code de contrainte') : tr('Set up a duress code', 'Configurer un code de contrainte')}
          </Button>
          {configured && (
            <Button variant="danger" className="w-auto px-4" onClick={remove} disabled={busy}>
              {tr('Remove', 'Supprimer')}
            </Button>
          )}
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}

interface LimitsView {
  dailyUsdc: number;
  pending: { dailyUsdc: number; requestedAt: string; effectiveAt: string } | null;
  defaultUsdc: number;
  maxUsdc: number;
  raiseDelaySec: number;
}

export function DailyLimitCard({ clientId }: { clientId: string }) {
  const lim = usePoll<LimitsView>(() => cosigner.get(`/clients/${clientId}/limits`), 5000, [clientId]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const left = useCountdown(lim.data?.pending ? new Date(lim.data.pending.effectiveAt).getTime() : undefined);
  const delay = lim.data?.raiseDelaySec ?? 60;
  const delayText = delay >= 3600 ? tr(`${Math.round(delay / 3600)} h`, `${Math.round(delay / 3600)} h`) : tr(`${delay} s (demo; 24 h in production)`, `${delay} s (démo ; 24 h en production)`);

  const apply = async () => {
    setMsg(null);
    const v = Number(value.replace(',', '.'));
    if (!lim.data || !Number.isFinite(v) || v < 0 || v > lim.data.maxUsdc) return setMsg({ tone: 'bad', text: tr(`Choose a limit between 0 and ${lim.data?.maxUsdc ?? 0} USDC.`, `Choisissez une limite entre 0 et ${lim.data?.maxUsdc ?? 0} USDC.`) });
    setBusy(true);
    try {
      const raising = v > lim.data.dailyUsdc;
      const webauthn = raising ? await passkey(clientId, `limits:${v}`, `/clients/${clientId}/limits/options`, { dailyUsdc: v }) : undefined;
      const r = await cosigner.post<LimitsView & { applied: 'lowered' | 'pending' }>(`/clients/${clientId}/limits`, { dailyUsdc: v, webauthn });
      setValue('');
      setMsg(
        r.applied === 'lowered'
          ? { tone: 'ok', text: tr(`Daily limit lowered to ${v} USDC — effective now.`, `Limite journalière abaissée à ${v} USDC — effective immédiatement.`) }
          : { tone: 'warn', text: tr(`Raise to ${v} USDC requested: it takes effect on ${dateTime(r.pending!.effectiveAt)}. You were notified and can cancel until then.`, `Relèvement à ${v} USDC demandé : effectif le ${dateTime(r.pending!.effectiveAt)}. Vous avez été notifié et pouvez l’annuler d’ici là.`) },
      );
      void lim.reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: cancelled(e) });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await cosigner.post(`/clients/${clientId}/limits/cancel`);
      setMsg({ tone: 'ok', text: tr('Pending raise cancelled.', 'Relèvement en attente annulé.') });
      void lim.reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: cancelled(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="daily-limit" className="scroll-mt-24 space-y-3">
      <div className="flex items-center gap-2">
        <Gauge size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Daily limit', 'Limite journalière')}</h2>
        {lim.data && <span className="num text-[15px] font-semibold">{lim.data.dailyUsdc} USDC</span>}
      </div>
      <Why>
        {tr(
          `The most you can send per day (USDC equivalent). Lowering it is immediate. Raising it only takes effect after ${delayText}, with a notification — so nobody can force you to unlock a large amount at once. A first payment of a large amount to a new recipient is always delayed too.`,
          `Le montant maximal envoyé par jour (équivalent USDC). L’abaisser est immédiat. Le relever ne prend effet qu’après ${delayText}, avec une notification — personne ne peut donc vous forcer à débloquer d’un coup un gros montant. Un premier paiement d’un montant important vers un nouveau destinataire est lui aussi toujours différé.`,
        )}
      </Why>
      {lim.error && <Notice tone="bad">{lim.error}</Notice>}
      {lim.data?.pending && (
        <Notice tone="warn" title={tr(`Raise to ${lim.data.pending.dailyUsdc} USDC pending`, `Relèvement à ${lim.data.pending.dailyUsdc} USDC en attente`)}>
          <span className="block">
            {tr('Takes effect on', 'Effectif le')} {dateTime(lim.data.pending.effectiveAt)}
            {left > 0 && <span className="num"> · {left} s</span>}
          </span>
          <Button variant="secondary" className="mt-2 w-auto px-4" onClick={cancel} disabled={busy}>
            {tr('Cancel the raise', 'Annuler le relèvement')}
          </Button>
        </Notice>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={tr('New daily limit (USDC)', 'Nouvelle limite journalière (USDC)')} hint={lim.data ? tr(`Between 0 and ${lim.data.maxUsdc}. Default: ${lim.data.defaultUsdc}.`, `Entre 0 et ${lim.data.maxUsdc}. Par défaut : ${lim.data.defaultUsdc}.`) : undefined}>
          <input className={cx(inputCls, 'num w-40')} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button className="mb-[2px] w-auto px-4" onClick={apply} disabled={busy || !value}>
          {busy ? <Spinner /> : tr('Apply', 'Appliquer')}
        </Button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
