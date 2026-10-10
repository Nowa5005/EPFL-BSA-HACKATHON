// Shown when the client already has a My Wall wallet but NOT on this device: instead of starting a new
// activation (which the "1 phone + 1 computer" rule would refuse), offer to restore it here.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, ShieldCheck } from 'lucide-react';
import { bank, cosigner, partner } from '../lib/api';
import { getSession } from '../lib/device';
import { tr } from '../lib/i18n';
import { Button, Card, DemoFooter, Field, Logo, MockBadge, Notice, SecretInput, Spinner, Why } from '../components/ui';

export function ExistingWalletActions({ clientId, onReset }: { clientId: string; onReset?: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  // Sensitive demo operation: the services only accept it with a FRESH token, obtained by re-entering the
  // Swissquote password (valid 5 minutes). Disabled on the server in production.
  const resetDemo = async () => {
    if (!confirm(tr('Demo: forget this client’s existing wallet and restart the activation? (The wallet stays on the test blockchain.)', 'Démo : oublier le wallet existant de ce client et recommencer l’activation ? (Le wallet reste sur la blockchain de test.)'))) return;
    setBusy(true);
    setErr('');
    try {
      const fresh = await bank.post<{ token: string }>('/reauth', { password });
      for (const svc of [cosigner, partner, bank]) {
        await svc.post(`/admin/clients/${encodeURIComponent(clientId)}/reset`, {}, { token: fresh.token }).catch((e) => {
          if (svc !== partner) throw e;
        });
      }
      setPassword('');
      setAsking(false);
      const profile = getSession()?.profile;
      await cosigner.post('/clients', { clientId, name: profile?.name ?? clientId, email: profile?.email ?? `${clientId}@example.ch` });
      onReset?.();
      nav('/onboarding', { replace: true, state: { fresh: Date.now() } });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Button onClick={() => nav('/recover')}>
        <ShieldCheck size={18} strokeWidth={1.75} /> {tr('Restore my wallet on this device', 'Restaurer mon wallet sur cet appareil')}
      </Button>
      {!asking ? (
        <Button variant="ghost" onClick={() => setAsking(true)} disabled={busy}>
          <RotateCcw size={16} strokeWidth={1.75} /> {tr('Demo: restart the activation from scratch', 'Démo : recommencer l’activation à zéro')} <MockBadge />
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void resetDemo();
          }}
        >
          <Field label={tr('Confirm with your Swissquote password', 'Confirmez avec votre mot de passe Swissquote')} hint={tr('Required before a reset. Any password in this prototype.', 'Requis avant une remise à zéro. N’importe quel mot de passe dans ce prototype.')}>
            <SecretInput value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy || !password}>
            {busy ? <Spinner /> : <RotateCcw size={16} strokeWidth={1.75} />} {tr('Confirm the demo reset', 'Confirmer la remise à zéro de démo')}
          </Button>
        </form>
      )}
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}

export default function ExistingWallet({ clientId, onReset }: { clientId: string; onReset?: () => void }) {
  return (
    <div className="mw-page min-h-screen bg-sq-bg">
      <div className="mx-auto w-full max-w-[480px] px-5 pb-8 pt-4">
        <Link to="/sq" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-sq-ink-2">
          <ArrowLeft size={18} strokeWidth={1.75} /> Swissquote
        </Link>
        <div className="flex flex-col items-center pb-6 pt-8 text-center">
          <Logo size={56} />
          <h1 className="mt-4 text-[24px] font-semibold tracking-tight">{tr('Your wallet already exists', 'Votre wallet existe déjà')}</h1>
          <p className="mt-1 text-[14px] text-sq-muted">{tr('It just isn’t on this device yet.', 'Il n’est simplement pas encore sur cet appareil.')}</p>
        </div>
        <Card className="space-y-4">
          <Why>
            {tr(
              'To use it here, restore it: identity check, your recovery code or your cloud backup, then a passkey on this device. Restoring replaces the old device — it doesn’t count as an extra device (at most 1 phone and 1 computer).',
              'Pour l’utiliser ici, restaurez-le : vérification d’identité, votre code de récupération ou votre sauvegarde cloud, puis une passkey sur cet appareil. Cette restauration remplace l’ancien appareil — elle n’est pas comptée comme un appareil supplémentaire (au maximum 1 téléphone et 1 ordinateur).',
            )}
          </Why>
          <ExistingWalletActions clientId={clientId} onReset={onReset} />
        </Card>
      </div>
      <DemoFooter />
    </div>
  );
}
