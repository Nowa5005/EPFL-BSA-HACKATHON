// Shown when the client already has a My Wall wallet but NOT on this device: instead of starting a new
// activation (which the "1 phone + 1 computer" rule would refuse), offer to restore it here.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, ShieldCheck } from 'lucide-react';
import { SERVICE_URLS } from '@sq/shared';
import { cosigner } from '../lib/api';
import { getSession } from '../lib/device';
import { Button, Card, DemoFooter, Logo, MockBadge, Notice, Spinner, Why } from '../components/ui';

export function ExistingWalletActions({ clientId, onReset }: { clientId: string; onReset?: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const resetDemo = async () => {
    if (!confirm('Démo : oublier le wallet existant de ce client et recommencer l’activation ? (Le wallet reste sur la blockchain de test.)')) return;
    setBusy(true);
    setErr('');
    try {
      for (const base of [SERVICE_URLS.cosigner, SERVICE_URLS.partner, SERVICE_URLS.bank]) {
        const r = await fetch(`${base}/admin/clients/${clientId}/reset`, { method: 'POST' });
        if (!r.ok && base !== SERVICE_URLS.partner) throw new Error('Remise à zéro impossible');
      }
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
        <ShieldCheck size={18} strokeWidth={1.75} /> Restaurer mon wallet sur cet appareil
      </Button>
      <Button variant="ghost" onClick={resetDemo} disabled={busy}>
        {busy ? <Spinner /> : <RotateCcw size={16} strokeWidth={1.75} />} Démo : recommencer l’activation à zéro <MockBadge />
      </Button>
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
          <h1 className="mt-4 text-[24px] font-semibold tracking-tight">Votre wallet existe déjà</h1>
          <p className="mt-1 text-[14px] text-sq-muted">Il n’est simplement pas encore sur cet appareil.</p>
        </div>
        <Card className="space-y-4">
          <Why>
            Pour l’utiliser ici, restaurez-le : vérification d’identité, votre code de récupération ou votre sauvegarde cloud, puis une passkey sur cet appareil. Cette restauration remplace l’ancien appareil — elle n’est pas comptée comme un appareil supplémentaire (au maximum 1 téléphone et 1 ordinateur).
          </Why>
          <ExistingWalletActions clientId={clientId} onReset={onReset} />
        </Card>
      </div>
      <DemoFooter />
    </div>
  );
}
