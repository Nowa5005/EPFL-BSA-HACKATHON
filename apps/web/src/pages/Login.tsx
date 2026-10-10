import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bank, cosigner } from '../lib/api';
import { getDevice, saveSession } from '../lib/device';
import { Button, Card, Field, inputCls, MockBadge, Spinner } from '../components/ui';

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
      const c = await cosigner.post('/clients', { clientId: r.clientId, name: r.profile.name, email: r.profile.email });
      const d = getDevice();
      if (d?.safeAddress && d.clientId === r.clientId) nav('/wallet');
      else nav(c.safeAddress ? '/recover' : '/onboarding'); // wallet exists but not on this device → recovery

    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-navy-900">
      <div className="mx-auto w-full max-w-md flex-1 px-5 pt-14 text-white">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-navy-900">SQ</span>
          <span className="text-lg font-semibold">Online banking</span>
          <MockBadge className="ml-auto" />
        </div>
        <h1 className="mt-10 text-3xl font-semibold leading-tight tracking-tight">Your crypto, your keys.
          <br />
          <span className="text-white/60">Swiss-bank simple.</span>
        </h1>
        <p className="mt-3 text-[15px] text-white/70">Sign in with your Swissquote account to open the new <b className="text-white">Wallet</b> tab.</p>
      </div>
      <div className="mx-auto w-full max-w-md px-4 pb-8">
        <Card className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Swissquote username" hint="Demo clients: alice or bruno (KYC already completed)">
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password" hint="Any password works in the prototype">
              <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {err && <p className="text-sm text-bad-600">{err}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : 'Sign in'}
            </Button>
          </form>
          <div className="flex justify-between text-sm">
            <Link className="text-accent-500" to="/recover">
              I lost my device
            </Link>
            <span className="flex gap-3">
              <Link className="text-navy-700/60" to="/admin">
                Admin
              </Link>
              <Link className="text-navy-700/60" to="/attacker">
                Attacker demo
              </Link>
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
