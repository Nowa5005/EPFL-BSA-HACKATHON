import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bank, cosigner } from '../lib/api';
import { saveComplianceSession, saveSession } from '../lib/device';
import { Button, Card, cx, DemoFooter, Field, inputCls, Logo, MockBadge, SecretInput, Spinner } from '../components/ui';
import { getLang, setLang, tr } from '../lib/i18n';

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('demo');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await bank.post('/login', { username, password });
      if (r.role === 'compliance') {
        // DEMO back-office user: opens the compliance console, does not touch the client session.
        saveComplianceSession({ token: r.token, name: r.profile?.name ?? 'Compliance' });
        nav('/admin');
        return;
      }
      saveSession({ token: r.token, clientId: r.clientId, profile: r.profile });
      await cosigner.post('/clients', { clientId: r.clientId, name: r.profile.name, email: r.profile.email });
      nav('/sq/markets');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mw-page relative flex min-h-screen flex-col bg-sq-bg">
      <LangSwitch />
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-5 text-[24px] font-semibold tracking-tight">{tr('Sign in', 'Connexion')}</h1>
          <p className="mt-1 text-[14px] text-sq-muted">
            {tr('Your Swissquote account', 'Votre compte Swissquote')} <MockBadge label={tr('Mock-up', 'Reconstitution')} />
          </p>
        </div>
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label={tr('Username', 'Identifiant')} hint={tr('Demo clients: alice or bruno (KYC already done)', 'Clients de démo : alice ou bruno (KYC déjà fait)')}>
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label={tr('Password', 'Mot de passe')} hint={tr('Any password works in this prototype', 'N’importe quel mot de passe dans ce prototype')} error={err || undefined}>
              <SecretInput value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : tr('Sign in', 'Se connecter')}
            </Button>
          </form>
        </Card>
        <div className="mt-5 flex justify-center gap-5 text-[13px] text-sq-muted">
          <Link className="underline underline-offset-4" to="/recover">
            {tr('I lost my device', 'J’ai perdu mon appareil')}
          </Link>
          <Link className="underline underline-offset-4" to="/admin">
            {tr('Swissquote console', 'Console Swissquote')}
          </Link>
          <Link className="underline underline-offset-4" to="/attacker">
            {tr('Attacker demo', 'Démo attaquant')}
          </Link>
        </div>
      </div>
      <DemoFooter />
    </div>
  );
}

/** Discreet language switch (English default; French only on explicit choice, persisted on this device). */
function LangSwitch() {
  const lang = getLang();
  return (
    <div className="absolute right-4 top-3 flex items-center gap-1 text-[13px] text-sq-muted" role="group" aria-label={tr('Language', 'Langue')}>
      {(
        [
          ['en', 'English'],
          ['fr', 'Français'],
        ] as const
      ).map(([id, label], i) => (
        <span key={id} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>|</span>}
          <button
            type="button"
            lang={id}
            aria-pressed={lang === id}
            onClick={() => lang !== id && setLang(id)}
            className={cx('min-h-11 px-1', lang === id ? 'font-semibold text-sq-ink-2' : 'underline-offset-4 hover:underline')}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  );
}
