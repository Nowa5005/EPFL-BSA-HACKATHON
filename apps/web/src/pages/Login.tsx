import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bank, cosigner } from '../lib/api';
import { saveSession } from '../lib/device';
import { Button, Card, DemoFooter, Field, inputCls, Logo, MockBadge, SecretInput, Spinner } from '../components/ui';

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
    <div className="mw-page flex min-h-screen flex-col bg-sq-bg">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-5 text-[24px] font-semibold tracking-tight">Connexion</h1>
          <p className="mt-1 text-[14px] text-sq-muted">
            Votre compte Swissquote <MockBadge label="Reconstitution" />
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
            <Field label="Identifiant" hint="Clients de démo : alice ou bruno (KYC déjà fait)">
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Mot de passe" hint="N’importe quel mot de passe dans ce prototype" error={err || undefined}>
              <SecretInput value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : 'Se connecter'}
            </Button>
          </form>
        </Card>
        <div className="mt-5 flex justify-center gap-5 text-[13px] text-sq-muted">
          <Link className="underline underline-offset-4" to="/recover">
            J’ai perdu mon appareil
          </Link>
          <Link className="underline underline-offset-4" to="/admin">
            Console Swissquote
          </Link>
          <Link className="underline underline-offset-4" to="/attacker">
            Démo attaquant
          </Link>
        </div>
      </div>
      <DemoFooter />
    </div>
  );
}
