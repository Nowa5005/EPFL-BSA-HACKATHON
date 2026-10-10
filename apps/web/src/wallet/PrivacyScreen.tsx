// Privacy screen shown INSTEAD of the wallet (the wallet content is unmounted) once the user left the app
// (see lib/privacy.ts). No figure at all. Resume: passkey (purpose 'resume-session'), or the wallet password
// if the passkey fails or is unavailable (checked locally by decrypting the keystore).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Fingerprint, Lock } from 'lucide-react';
import { useLocal } from '../lib/hooks';
import { resumeErrorMessage, resumeWithPassword, resumeWithPasskey } from '../lib/privacy';
import { passkeysBlockedInNative } from '../lib/platform';
import { UnlockError, unlockState } from '../lib/device';
import { tr } from '../lib/i18n';
import { Button, Field, Logo, SecretInput, Spinner, useCountdown } from '../components/ui';

export function PrivacyScreen() {
  const { device, session } = useLocal();
  const noPasskey = passkeysBlockedInNative() || typeof window === 'undefined' || !window.PublicKeyCredential;
  const [mode, setMode] = useState<'passkey' | 'password'>(noPasskey ? 'password' : 'passkey');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [progress, setProgress] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(unlockState().lockedUntil);
  const left = useCountdown(lockedUntil > Date.now() ? lockedUntil : undefined);

  useEffect(() => {
    document.title = tr('My Wall is locked', 'My Wall est verrouillé');
    return () => {
      document.title = 'My Wall';
    };
  }, []);

  const passkey = async () => {
    setErr('');
    setBusy(true);
    try {
      await resumeWithPasskey(device!.clientId);
    } catch (e) {
      setErr(resumeErrorMessage(e));
      setMode('password');
    } finally {
      setBusy(false);
    }
  };

  const password = async () => {
    setErr('');
    setBusy(true);
    setProgress(0);
    try {
      await resumeWithPassword(pw, setProgress);
    } catch (e: any) {
      setPw('');
      if (e instanceof UnlockError && e.lockedUntil) setLockedUntil(e.lockedUntil);
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mw-page flex min-h-screen flex-col bg-sq-bg" role="main" aria-labelledby="privacy-title" data-testid="privacy-screen">
      <div className="mx-auto w-full max-w-[440px] flex-1 px-5 pt-[max(16px,env(safe-area-inset-top))]">
        <Link to="/sq" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-sq-ink-2">
          <ArrowLeft size={18} strokeWidth={1.75} /> {tr('Back to Swissquote', 'Retour à Swissquote')}
        </Link>
        <div className="flex flex-col items-center pb-8 pt-10 text-center">
          <Logo size={56} />
          <h1 id="privacy-title" className="mt-4 flex items-center gap-2 text-[24px] font-semibold tracking-tight">
            <Lock size={22} strokeWidth={1.75} /> {tr('My Wall is locked', 'My Wall est verrouillé')}
          </h1>
          <p className="mt-1 text-[14px] text-sq-muted">{session?.profile?.name}</p>
          <p className="mt-3 max-w-[340px] text-[13px] text-sq-ink-2">
            {tr('You left the app, so your balances are hidden. Confirm it is you to continue.', 'Vous avez quitté l’app : vos soldes sont masqués. Confirmez que c’est bien vous pour continuer.')}
          </p>
        </div>

        {mode === 'passkey' ? (
          <div className="space-y-3">
            <Button onClick={() => void passkey()} disabled={busy}>
              {busy ? <Spinner /> : (
                <>
                  <Fingerprint size={20} strokeWidth={1.75} /> {tr('Unlock with my passkey', 'Déverrouiller avec ma passkey')}
                </>
              )}
            </Button>
            <p className="text-center text-[12px] text-sq-muted">{tr('Touch ID, Face ID or your device PIN, depending on your device.', 'Touch ID, Face ID ou le code de votre appareil, selon votre appareil.')}</p>
            <button type="button" className="flex min-h-11 w-full items-center justify-center text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-4" onClick={() => setMode('password')} data-testid="privacy-use-password">
              {tr('Use my wallet password instead', 'Utiliser plutôt mon mot de passe du wallet')}
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (pw && !left) void password();
            }}
          >
            <Field label={tr('Wallet password', 'Mot de passe du wallet')} error={err || undefined}>
              <SecretInput autoFocus value={pw} onChange={setPw} autoComplete="current-password" />
            </Field>
            {busy && (
              <div className="h-1 overflow-hidden rounded-full bg-sq-line" aria-hidden>
                <div className="h-full bg-sq-orange transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {left > 0 && <p className="num text-[14px] text-sq-down">{tr(`You can try again in ${left} s.`, `Nouvel essai possible dans ${left} s.`)}</p>}
            <Button type="submit" disabled={!pw || busy || left > 0}>
              {busy ? <Spinner /> : tr('Unlock', 'Déverrouiller')}
            </Button>
            {!noPasskey && (
              <button type="button" className="flex min-h-11 w-full items-center justify-center text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-4" onClick={() => setMode('passkey')}>
                {tr('Use my passkey', 'Utiliser ma passkey')}
              </button>
            )}
          </form>
        )}
        {mode === 'passkey' && err && (
          <p className="mt-2 text-center text-[13px] text-sq-down" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
