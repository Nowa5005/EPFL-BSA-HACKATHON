import { useEffect, useState } from 'react';
import { BiometricsOptions } from '../components/BiometricsOptions';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Fingerprint } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import { cosigner } from '../lib/api';
import { setUnlocked, unlock, unlockState, UnlockError } from '../lib/device';
import type { HDNodeWallet, Wallet } from 'ethers';
import { useLocal } from '../lib/hooks';
import { Button, cx, DemoFooter, Field, inputCls, Logo, SecretInput, Spinner, useCountdown } from '../components/ui';

/** Password (decrypts the device key locally) then passkey (Touch ID). Never asks for a private key or recovery code. */
export function UnlockForm({ onDone }: { onDone: () => void }) {
  const { device } = useLocal();
  const [pw, setPw] = useState('');
  const [phase, setPhase] = useState<'idle' | 'decrypt' | 'passkey' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [lockedUntil, setLockedUntil] = useState(unlockState().lockedUntil);
  const [mode, setMode] = useState<'passkey' | 'code'>('passkey');
  const [code, setCode] = useState('');
  const [hasCode, setHasCode] = useState(false);
  useEffect(() => {
    if (device?.clientId) cosigner.get(`/clients/${device.clientId}`).then((c) => setHasCode(!!c.backupCode?.configured)).catch(() => undefined);
  }, [device?.clientId]);
  const left = useCountdown(lockedUntil > Date.now() ? lockedUntil : undefined);
  const locked = left > 0;

  useEffect(() => {
    if (!locked && lockedUntil) setErr('');
  }, [locked, lockedUntil]);

  const submit = async () => {
    setErr('');
    setPhase('decrypt');
    setProgress(0);
    let key: Wallet | HDNodeWallet;
    try {
      key = await unlock(pw, (p) => setProgress(p), { commit: false });
    } catch (e: any) {
      setPhase('idle');
      setPw('');
      if (e instanceof UnlockError && e.lockedUntil) setLockedUntil(e.lockedUntil);
      setErr(e.message);
      return;
    }
    try {
      setPhase('passkey');
      if (mode === 'code') {
        // Backup code instead of the passkey: single-use server challenge + attempt limiting.
        const { challengeId } = await cosigner.post(`/clients/${device!.clientId}/backup-code/challenge`);
        await cosigner.post(`/clients/${device!.clientId}/backup-code/verify`, { challengeId, code });
      } else {
        const options = await cosigner.post('/webauthn/auth/options', { clientId: device!.clientId, purpose: 'unlock' });
        const response = await startAuthentication({ optionsJSON: options });
        await cosigner.post('/webauthn/auth/verify', { clientId: device!.clientId, purpose: 'unlock', response });
      }
      setPhase('done');
      setUnlocked(key); // only now: password AND passkey verified
      onDone();
    } catch (e: any) {
      setPhase('idle');
      setErr(e?.name === 'NotAllowedError' ? 'Vérification annulée ou expirée. Réessayez, ou découvrez les autres options ci-dessous.' : e.message);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw && !locked) void submit();
      }}
    >
      <Field label="Mot de passe du wallet" error={err || undefined}>
        <SecretInput autoFocus value={pw} onChange={setPw} autoComplete="current-password" />
      </Field>
      {phase === 'decrypt' && (
        <div aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-sq-line">
            <div className="h-full bg-sq-orange transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] text-sq-muted">Déchiffrement de votre clé sur cet appareil…</p>
        </div>
      )}
      {phase === 'passkey' && (
        <p className="flex items-center gap-2 text-[14px] text-sq-ink-2" aria-live="polite">
          <Fingerprint size={20} strokeWidth={1.75} className="text-sq-orange" /> {mode === 'code' ? 'Vérification du code de secours…' : 'Confirmez avec Touch ID, Face ID ou le code de votre appareil.'}
        </p>
      )}
      {mode === 'code' && (
        <Field label="Code de secours (12 caractères)">
          <input className={cx(inputCls, 'font-mono uppercase tracking-widest')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12))} autoComplete="off" spellCheck={false} />
        </Field>
      )}
      {locked && <p className="num text-[14px] text-sq-down">Nouvel essai possible dans {left} s.</p>}
      <Button type="submit" disabled={!pw || locked || phase !== 'idle' || (mode === 'code' && code.length !== 12)}>
        {phase === 'idle' ? (mode === 'code' ? 'Déverrouiller avec le code de secours' : 'Déverrouiller') : <Spinner />}
      </Button>
      <BiometricsOptions>
        {hasCode ? (
          <button type="button" className="min-h-10 font-medium underline underline-offset-4" onClick={() => setMode(mode === 'code' ? 'passkey' : 'code')}>
            {mode === 'code' ? 'Revenir à la passkey' : 'Déverrouiller avec mon code de secours'}
          </button>
        ) : (
          <p className="text-sq-muted">Aucun code de secours n’est configuré pour ce wallet.</p>
        )}
      </BiometricsOptions>
      <Link to="/recover" className="flex min-h-11 items-center justify-center text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-4">
        J'ai perdu mon appareil / Restaurer mon wallet
      </Link>
    </form>
  );
}

export default function UnlockPage() {
  const { device, session, unlocked } = useLocal();
  const nav = useNavigate();
  const loc = useLocation();
  const target = (loc.state as any)?.from ?? '/wallet';
  if (!session) return <Navigate to="/login" replace />;
  if (!device?.safeAddress) return <Navigate to="/onboarding" replace />;
  if (unlocked) return <Navigate to={target} replace />;
  return (
    <div className="mw-page flex min-h-screen flex-col bg-sq-bg">
      <div className="mx-auto w-full max-w-[440px] flex-1 px-5 pt-4">
        <Link to="/sq" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-sq-ink-2">
          <ArrowLeft size={18} strokeWidth={1.75} /> Retour à Swissquote
        </Link>
        <div className="flex flex-col items-center pb-8 pt-8 text-center">
          <Logo size={56} />
          <h1 className="mt-4 text-[24px] font-semibold tracking-tight">Déverrouiller My Wall</h1>
          <p className="mt-1 text-[14px] text-sq-muted">{session.profile?.name}</p>
        </div>
        <UnlockForm onDone={() => nav(target, { replace: true })} />
      </div>
      <DemoFooter />
    </div>
  );
}
