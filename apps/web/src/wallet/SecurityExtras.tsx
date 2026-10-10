// Security extras: freeze co-signing (passkey only) and the backup code (passkey alternative).

import { useState } from 'react';
import { KeyRound, Snowflake } from 'lucide-react';
import { startAuthentication } from '../lib/passkeyGuard'; // guarded for the native app
import { cosigner } from '../lib/api';
import { useWalletData } from '../lib/hooks';
import { Button, Card, CopyButton, cx, dateOnly, Field, inputCls, Notice, Spinner, Why } from '../components/ui';
import { getLang, tr } from '../lib/i18n';

async function passkeyFor(clientId: string, purpose: string, optionsPath = '/webauthn/auth/options', body: any = {}) {
  const options = await cosigner.post(optionsPath, { clientId, purpose, ...body });
  return startAuthentication({ optionsJSON: options });
}

export function FreezeCard({ clientId }: { clientId: string }) {
  const { data, reload } = useWalletData(15000);
  const c = data?.client;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const frozen = !!c?.frozen;
  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const options = await cosigner.post(`/clients/${clientId}/freeze/options`, { frozen: !frozen });
      const webauthn = await startAuthentication({ optionsJSON: options });
      await cosigner.post(`/clients/${clientId}/freeze`, { frozen: !frozen, webauthn });
      setMsg({ tone: 'ok', text: !frozen ? tr('Co-signing frozen. No operation will be co-signed.', 'Co-signature gelée. Aucune opération ne sera co-signée.') : tr('Co-signing unfrozen.', 'Co-signature dégelée.') });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Verification cancelled: nothing changed.', 'Vérification annulée : rien n’a changé.') : e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Snowflake size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Freeze co-signing', 'Geler la co-signature')}
          {getLang() === 'fr' && (
            <>
              {' '}
              <span className="font-normal text-sq-muted">(Freeze co-signing)</span>
            </>
          )}
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={frozen}
          aria-label={tr('Freeze co-signing', 'Geler la co-signature')}
          disabled={busy || c?.frozenBy === 'compliance'}
          onClick={toggle}
          className={cx('relative box-border h-7 w-12 shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-50', frozen ? 'bg-sq-orange' : 'bg-sq-line')}
        >
          {/* Track 48×28, knob 24×24 anchored at left/top 2 px: off = x 2→26, on = translate 20 px → x 22→46 (2 px inset both sides). */}
          <span aria-hidden className={cx('pointer-events-none absolute left-0.5 top-0.5 block size-6 rounded-full bg-white mw-keep-white shadow transition-transform motion-reduce:transition-none', frozen ? 'translate-x-5' : 'translate-x-0')} />
        </button>
      </div>
      <p className="text-[13px] text-sq-muted">
        {tr(
          'If in doubt (lost device, suspicious message), freeze co-signing: Swissquote will refuse to sign any operation for this wallet, including ones already prepared. Freezing and unfreezing require your passkey; the backup code is not enough.',
          'En cas de doute (appareil égaré, message suspect), gelez la co-signature : Swissquote refusera de signer toute opération pour ce wallet, y compris celles déjà préparées. Le gel et le dégel demandent votre passkey ; le code de secours ne suffit pas.',
        )}
      </p>
      <p className="text-[13px] text-sq-muted">{tr('You can still exit with your own keys (device key + backup key): freezing changes neither the keys nor the 2-of-3 rule.', 'Votre sortie avec vos propres clés (clé de l’appareil + clé de secours) reste possible : le gel ne change ni les clés ni la règle 2 sur 3.')}</p>
      {frozen && <Notice tone="warn" title={c?.frozenBy === 'compliance' ? tr('Freeze decided by Swissquote compliance', 'Gel décidé par la conformité Swissquote') : tr('Co-signing frozen', 'Co-signature gelée')}>{c?.frozenBy === 'compliance' ? tr('Only a Swissquote officer can lift it.', 'Seul un responsable Swissquote peut le lever.') : tr('Turn the switch off to resume operations.', 'Désactivez l’interrupteur pour reprendre les opérations.')}</Notice>}
      {busy && <Spinner className="text-sq-muted" />}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 12 characters from a CSPRNG (60 bits), unbiased: 32 symbols = 5 bits per byte draw. */
function generateCode() {
  const out: string[] = [];
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  for (const b of buf) out.push(ALPHABET[b & 31]);
  return out.join('');
}
const group = (c: string) => c.replace(/(.{4})(?=.)/g, '$1 ');

export function BackupCodeCard({ clientId }: { clientId: string }) {
  const { data, reload } = useWalletData(30000);
  const bc = data?.client?.backupCode;
  const [step, setStep] = useState<'idle' | 'show' | 'confirm'>('idle');
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const start = () => {
    setCode(generateCode());
    setTyped('');
    setMsg(null);
    setStep('show');
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const webauthn = await passkeyFor(clientId, 'backup-code');
      await cosigner.post(`/clients/${clientId}/backup-code`, { code, webauthn });
      setCode('');
      setTyped('');
      setStep('idle');
      setMsg({ tone: 'ok', text: tr('Backup code saved. Swissquote only keeps a fingerprint of it: it cannot give it back to you.', 'Code de secours enregistré. Swissquote n’en conserve qu’une empreinte : il ne pourra pas vous le redonner.') });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Verification cancelled.', 'Vérification annulée.') : e.message });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!confirm(tr('Revoke the backup code? It can no longer be used.', 'Révoquer le code de secours ? Il ne pourra plus être utilisé.'))) return;
    setBusy(true);
    try {
      const webauthn = await passkeyFor(clientId, 'backup-code');
      await cosigner.post(`/clients/${clientId}/backup-code/revoke`, { webauthn });
      setMsg({ tone: 'ok', text: tr('Backup code revoked.', 'Code de secours révoqué.') });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Verification cancelled.', 'Vérification annulée.') : e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="code-de-secours" className="scroll-mt-24 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Backup code (if biometrics are unavailable)', 'Code de secours (si la biométrie n’est pas disponible)')}</h2>
        <span className={cx('rounded-[4px] px-1.5 py-px text-[11px] font-semibold uppercase', bc?.configured ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-chip text-sq-muted')}>{bc?.configured ? tr('Active', 'Actif') : tr('Not set up', 'Non configuré')}</span>
      </div>
      <Why>
        {tr(
          'A 12-character code that replaces the passkey to unlock My Wall and confirm an operation when biometrics or the device PIN don’t work. It is not a recovery phrase: it can’t rebuild your keys, freeze/unfreeze co-signing, or show your amounts or secrets. Set it up in advance, with your passkey. 5 attempts, then a 15-minute lock.',
          'Un code de 12 caractères qui remplace la passkey pour déverrouiller My Wall et confirmer une opération quand la biométrie ou le code de l’appareil ne fonctionnent pas. Ce n’est pas une phrase de récupération : il ne permet ni de reconstituer vos clés, ni de geler/dégeler la co-signature, ni d’afficher vos montants ou vos secrets. Il se configure à l’avance, avec votre passkey. 5 essais, puis blocage de 15 minutes.',
        )}
      </Why>
      {bc?.configured && step === 'idle' && <p className="text-[13px] text-sq-ink-2">{tr('Set up on', 'Configuré le')} {dateOnly(bc.createdAt)}{bc.locked ? tr(' — temporarily locked after too many attempts', ' — bloqué temporairement après trop d’essais') : ''}.</p>}
      {step === 'show' && (
        <div className="space-y-2">
          <p className="text-[14px]">{tr('Write this code down and keep it away from your phone (for example with your recovery kit). It will never be shown again.', 'Notez ce code et rangez-le hors de votre téléphone (par exemple avec votre kit de récupération). Il ne sera plus jamais affiché.')}</p>
          <code className="block rounded-[10px] border border-sq-line bg-sq-surface p-3 text-center font-mono text-[22px] tracking-[0.2em]">{group(code)}</code>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={code} sensitive />
            <Button className="w-auto px-4" onClick={() => setStep('confirm')}>
              {tr('I’ve written it down', 'Je l’ai noté')}
            </Button>
          </div>
        </div>
      )}
      {step === 'confirm' && (
        <div className="space-y-2">
          <Field label={tr('Type the code to confirm', 'Recopiez le code pour confirmer')} error={typed.length === 12 && typed !== code ? tr('The code doesn’t match.', 'Le code ne correspond pas.') : undefined}>
            <input className={cx(inputCls, 'font-mono uppercase tracking-widest')} value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" className="w-auto px-4" onClick={() => setStep('show')}>
              {tr('Show the code again', 'Revoir le code')}
            </Button>
            <Button className="w-auto px-4" onClick={save} disabled={busy || typed !== code}>
              {busy ? <Spinner /> : tr('Activate with my passkey', 'Activer avec ma passkey')}
            </Button>
          </div>
        </div>
      )}
      {step === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="w-auto px-4" onClick={start} disabled={busy}>
            {bc?.configured ? tr('Replace the code', 'Remplacer le code') : tr('Set up a backup code', 'Configurer un code de secours')}
          </Button>
          {bc?.configured && (
            <Button variant="danger" className="w-auto px-4" onClick={revoke} disabled={busy}>
              {tr('Revoke', 'Révoquer')}
            </Button>
          )}
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
