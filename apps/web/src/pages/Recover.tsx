import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, sha256 } from 'ethers';
import jsQR from 'jsqr';
import { buildSafeTx, combineShares, decodePaperShare, signSafeTx, swapOwnerData } from '@sq/shared';
import { bank, cosigner, partner } from '../lib/api';
import { encryptKey, guessDeviceType, registerPasskey, saveDevice, saveSession, setUnlocked } from '../lib/device';
import { useLocal, usePoll } from '../lib/hooks';
import { Addr, Button, Card, Field, inputCls, mmss, MockBadge, Notice, ProgressList, Shell, Spinner, Steps, TxLink, useCountdown, Why, cx } from '../components/ui';

const STEPS = ['Sign in', 'Identity', 'Paper kit', 'New device', 'Security delay'];
const PENDING_KEY = 'sqw:pending-recovery';

interface Pending {
  clientId: string;
  safeAddress: string;
  deviceAddress: string;
  keystore: string;
  credentialId: string;
  recoveryId: string;
  deviceType: 'mobile' | 'desktop';
}
const loadPending = (): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const storePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
};

export default function Recover() {
  const { session } = useLocal();
  const [pending, setPending] = useState<Pending | null>(loadPending());
  const [step, setStep] = useState(session ? 1 : 0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // identity
  const [sessionId, setSessionId] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [liveness, setLiveness] = useState<'match' | 'no-match' | null>(null);
  const [answers, setAnswers] = useState(['', '', '']);
  // paper
  const [paperText, setPaperText] = useState('');
  // decision
  const [refusal, setRefusal] = useState<any>(null);
  const [k3, setK3] = useState<Wallet | null>(null);
  const [attestationId, setAttestationId] = useState('');
  const [safeAddress, setSafeAddress] = useState('');
  // new device
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [prog, setProg] = useState<any[]>([]);

  const [username, setUsername] = useState('alice');

  const login = async () => {
    setErr('');
    try {
      const r = await bank.post('/login', { username, password: 'demo' });
      saveSession({ token: r.token, clientId: r.clientId, profile: r.profile });
      setStep(1);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const startIdentity = async () => {
    setErr('');
    try {
      const r = await partner.post('/sessions', {
        clientId: session!.clientId,
        context: { swissquoteLogin: true, newDevice: true, unusualIp: false, simSwapRecent: false },
      });
      setSessionId(r.sessionId);
      setQuestions(r.questions);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    if (step === 1 && session && !sessionId) void startIdentity();
  }, [step, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitIdentity = async () => {
    setBusy(true);
    setErr('');
    try {
      await partner.post(`/sessions/${sessionId}/liveness`, { result: liveness });
      await partner.post(`/sessions/${sessionId}/answers`, { answers });
      setStep(2);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const readQrFile = async (file: File) => {
    setErr('');
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    const code = jsQR(data.data, data.width, data.height);
    if (!code) return setErr('No QR code found in this image. Try a sharper photo, or paste the text code.');
    setPaperText(code.data);
  };

  const decide = async (withPaper: boolean) => {
    setBusy(true);
    setErr('');
    try {
      let paper: { safeAddress: string; share: string } | null = null;
      if (withPaper) {
        paper = decodePaperShare(paperText);
        await partner.post(`/sessions/${sessionId}/paper-proof`, { commitment: sha256(paper.share) });
      }
      const r = await partner.post(`/sessions/${sessionId}/decide`);
      if (r.decision !== 'released') {
        setRefusal(r);
        return;
      }
      if (!paper) throw new Error('The paper kit is required to rebuild your recovery key.');
      const key = await combineShares([paper.share, r.share]);
      const w = new Wallet(key);
      const client = await cosigner.get(`/clients/${session!.clientId}`);
      if (w.address.toLowerCase() !== client.owners?.recovery?.toLowerCase()) throw new Error('This paper kit does not belong to this wallet.');
      setK3(w);
      setAttestationId(r.attestationId);
      setSafeAddress(client.safeAddress);
      setStep(3);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setupDevice = async () => {
    setErr('');
    const labels = ['Create a passkey on this new device', 'Generate & encrypt the new device key', 'Sign the key rotation with your recovery key', 'Send the request to Swissquote (security delay starts)'];
    const p = labels.map((label) => ({ label, state: 'todo' }));
    const set = (i: number, state: string, detail?: any) => {
      p[i] = { ...p[i], state, detail } as any;
      setProg([...p]);
    };
    setProg([...p]);
    let i = 0;
    try {
      set(i, 'doing');
      const deviceType = guessDeviceType();
      const reg = await registerPasskey(session!.clientId, deviceType, attestationId);
      set(i, 'done', 'activates when recovery completes');
      set(++i, 'doing');
      const k1 = Wallet.createRandom();
      const keystore = await encryptKey(k1, pw);
      set(i, 'done', <Addr a={k1.address} />);
      set(++i, 'doing');
      const on = await cosigner.get(`/clients/${session!.clientId}/onchain`);
      const client = await cosigner.get(`/clients/${session!.clientId}`);
      const tx = buildSafeTx({ to: safeAddress, data: swapOwnerData(on.owners, client.owners.device, k1.address), nonce: on.nonce });
      const signatureK3 = await signSafeTx(k3!, safeAddress, tx);
      setK3(null); // recovery key leaves memory
      set(i, 'done', `replace ${client.owners.device.slice(0, 8)}… → ${k1.address.slice(0, 8)}…`);
      set(++i, 'doing');
      const r = await cosigner.post('/recovery/request', { clientId: session!.clientId, safeTx: tx, signatureK3, partnerAttestationId: attestationId, newCredentialId: reg.credentialId });
      set(i, 'done');
      const pend: Pending = { clientId: session!.clientId, safeAddress, deviceAddress: k1.address, keystore, credentialId: reg.credentialId, recoveryId: r.id, deviceType };
      storePending(pend);
      setUnlocked(k1);
      setPending(pend);
    } catch (e: any) {
      set(i, 'error');
      setErr(e?.name === 'NotAllowedError' ? 'Touch ID was cancelled. Please try again.' : e.message);
    }
  };

  if (pending) return <Waiting pending={pending} onReset={() => { storePending(null); setPending(null); }} />;

  if (refusal)
    return (
      <Shell>
        <RefusalCard refusal={refusal} />
        <div className="mt-4">
          <Link to="/login">
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <Steps steps={STEPS} current={step} />
      <div className="mt-5 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">I lost my device</h1>
        {step === 0 && (
          <>
            <Why>First, sign in to your Swissquote account. It is protected by its own credentials, separate from your wallet.</Why>
            <Card className="space-y-4">
              <Field label="Swissquote username">
                <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Button onClick={login}>Sign in</Button>
            </Card>
          </>
        )}

        {step === 1 && (
          <>
            <Why>An independent Swiss recovery partner verifies it is really you. It holds one part of your recovery key — useless alone — and only releases it after these checks.</Why>
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">1. Video selfie</div>
                <MockBadge label="Mock liveness" />
              </div>
              <div className="flex aspect-video items-center justify-center rounded-xl bg-navy-900 text-5xl">🙂</div>
              <p className="text-xs text-navy-700/70">In production, a certified video-ident provider compares a live selfie with your KYC photo.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant={liveness === 'match' ? 'primary' : 'secondary'} onClick={() => setLiveness('match')}>
                  ✓ Face matches
                </Button>
                <Button variant={liveness === 'no-match' ? 'danger' : 'secondary'} onClick={() => setLiveness('no-match')}>
                  ✕ Does not match
                </Button>
              </div>
            </Card>
            <Card className="space-y-3">
              <div className="font-semibold">2. Security questions</div>
              <p className="text-xs text-navy-700/70">Low weight in the decision — never enough on their own.</p>
              {questions.map((q, j) => (
                <Field key={q} label={q}>
                  <input className={inputCls} value={answers[j]} onChange={(e) => setAnswers(answers.map((a, k) => (k === j ? e.target.value : a)))} />
                </Field>
              ))}
              {!questions.length && <Spinner />}
            </Card>
            {err && <Notice tone="bad">{err}</Notice>}
            <Button onClick={submitIdentity} disabled={!liveness || busy || !sessionId}>
              Continue
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            <Why>Your paper kit is part ① of your recovery key. With part ③ from the partner, your recovery key is rebuilt — only on this device.</Why>
            <Card className="space-y-3">
              <div className="font-semibold">Scan your paper kit</div>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-navy-100 p-6 text-center text-sm hover:bg-navy-50">
                <span className="text-3xl">📷</span>
                Take a photo / choose the kit image
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void readQrFile(e.target.files[0])} />
              </label>
              <Field label="…or paste the text code">
                <textarea className={cx(inputCls, 'h-20 font-mono text-xs')} value={paperText} onChange={(e) => setPaperText(e.target.value.trim())} placeholder="sqwallet:recovery:v1:0x…" />
              </Field>
              {paperText && <Notice tone="ok">Paper kit read ✓</Notice>}
            </Card>
            {err && <Notice tone="bad">{err}</Notice>}
            <Button onClick={() => decide(true)} disabled={!paperText || busy}>
              {busy ? <Spinner /> : 'Verify & continue'}
            </Button>
            <Button variant="ghost" onClick={() => decide(false)} disabled={busy}>
              I don't have my paper kit
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <Notice tone="ok" title="Identity confirmed — recovery key rebuilt on this device">
              The partner released its part. Now set up this device.
            </Notice>
            {!prog.length ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void setupDevice();
                }}
              >
                <Card className="space-y-4">
                  <Field label="New wallet password" hint="At least 8 characters">
                    <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
                  </Field>
                  <Field label="Repeat password">
                    <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  </Field>
                </Card>
                <Button type="submit" disabled={pw.length < 8 || pw !== pw2}>
                  👆 Link this device with Touch ID
                </Button>
              </form>
            ) : (
              <Card>
                <ProgressList items={prog} />
              </Card>
            )}
            {err && <Notice tone="bad">{err}</Notice>}
          </>
        )}
      </div>
    </Shell>
  );
}

export function RefusalCard({ refusal }: { refusal: any }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-bad-50 text-2xl text-bad-600">🛑</span>
        <div>
          <div className="text-lg font-semibold">Recovery refused</div>
          <div className="text-sm text-navy-700/70">
            Risk score {refusal.riskScore} (limit {refusal.threshold}). Nothing was released.
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {refusal.factors.map((f: any) => (
          <li key={f.factor} className="flex items-start gap-2">
            <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white', f.ok ? 'bg-ok-600' : 'bg-bad-600')}>{f.ok ? '✓' : '✕'}</span>
            <span>
              {f.factor}
              {f.hard && !f.ok && <b className="text-bad-600"> — mandatory</b>}
              {!f.hard && f.points > 0 && <span className="text-navy-700/60"> (+{f.points} risk)</span>}
            </span>
          </li>
        ))}
      </ul>
      <Why>The real owner has been notified in their Swissquote account. If you are the owner, contact Swissquote: a human-assisted recovery is possible with a video identification.</Why>
    </Card>
  );
}

function Waiting({ pending, onReset }: { pending: Pending; onReset: () => void }) {
  const nav = useNavigate();
  const { data: r } = usePoll(() => cosigner.get(`/recovery/${pending.recoveryId}`), 3000, [pending.recoveryId]);
  const left = useCountdown(r?.executeAfter);

  useEffect(() => {
    if (r?.status === 'completed') {
      saveDevice({
        clientId: pending.clientId,
        safeAddress: pending.safeAddress,
        deviceAddress: pending.deviceAddress,
        keystore: pending.keystore,
        credentialId: pending.credentialId,
        deviceType: pending.deviceType,
        createdAt: new Date().toISOString(),
      });
      storePending(null);
    }
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Shell>
      <Steps steps={STEPS} current={r?.status === 'completed' ? 5 : 4} />
      <div className="mt-5 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Security delay</h1>
        {!r ? (
          <Spinner />
        ) : r.status === 'pending-delay' || r.status === 'executing' ? (
          <>
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="num text-5xl font-semibold">{mmss(left)}</div>
              <div className="text-sm text-navy-700/70">{r.status === 'executing' ? 'Rotating keys on Ethereum…' : 'until your new device is activated'}</div>
              <div className="text-xs text-navy-700/50">2 minutes in this demo · 48 hours in production</div>
            </Card>
            <Why>We have notified you by email, SMS and in your Swissquote account. If someone else started this recovery, the real owner can cancel it with one tap during the delay.</Why>
            <Link to="/inbox" target="_blank" className="block">
              <Button variant="secondary">Open the mock inbox (cancel button) ↗</Button>
            </Link>
          </>
        ) : r.status === 'completed' ? (
          <>
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-ok-600 text-2xl text-white">✓</span>
              <div className="text-xl font-semibold">Access recovered</div>
              <div className="text-sm text-navy-700/80">Your old device can no longer sign — revoked on-chain.</div>
              <TxLink hash={r.txHash} />
            </Card>
            <Button onClick={() => nav('/wallet')}>Go to my wallet</Button>
          </>
        ) : (
          <>
            <Notice tone={r.status === 'cancelled' ? 'warn' : 'bad'} title={r.status === 'cancelled' ? 'Recovery cancelled' : 'Recovery failed'}>
              {r.status === 'cancelled' ? 'The recovery was cancelled from the Swissquote account. Nothing changed on-chain.' : r.error}
            </Notice>
            <Button variant="secondary" onClick={onReset}>
              Start again
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
}
