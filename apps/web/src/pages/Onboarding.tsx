import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { Wallet, hashMessage, sha256 } from 'ethers';
import {
  encodePaperShare,
  encryptCloudShare,
  explorerTx,
  ownershipStatement,
  signSafeMessage,
  splitRecoveryKey,
} from '@sq/shared';
import { bank, cosigner, partner } from '../lib/api';
import { encryptKey, guessDeviceType, registerPasskey, saveDevice, setUnlocked } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { Addr, Button, Card, Field, inputCls, MockBadge, Notice, ProgressList, RealBadge, Shell, Spinner, Steps, TxLink, Why } from '../components/ui';

const STEPS = ['Welcome', 'Passkey', 'Password', 'Create', 'Recovery kit'];
const DEFAULT_QUESTIONS = ['Name of your first pet?', 'City where your mother was born?', 'Surname of your favourite teacher?'];

type Prog = { label: string; state: 'todo' | 'doing' | 'done' | 'error'; detail?: any }[];

export default function Onboarding() {
  const nav = useNavigate();
  const { session } = useLocal();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentialId, setCredentialId] = useState<string>();
  const deviceType = guessDeviceType();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [prog, setProg] = useState<Prog>([]);
  const [result, setResult] = useState<{ safeAddress: string; deployTx: string; paper: string; cloudBlob: string } | null>(null);
  const [saved, setSaved] = useState({ printed: false, cloud: false });
  const qrRef = useRef<HTMLCanvasElement>(null);

  const clientId = session!.clientId;
  const profile = session!.profile;

  const createPasskey = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await registerPasskey(clientId, deviceType);
      setCredentialId(r.credentialId);
      setStep(2);
    } catch (e: any) {
      setErr(e.name === 'NotAllowedError' ? 'Touch ID was cancelled or timed out. Please try again.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setStep(3);
    setErr('');
    const labels = [
      'Generating your device key on this device',
      'Encrypting it with your password',
      'Generating your recovery key and splitting it in 3 parts',
      'Creating your wallet on Ethereum (fees paid by Swissquote)',
      'Sending part ③ to the independent recovery partner',
      'Encrypting part ② for your cloud backup',
      'Registering the wallet as yours (proof of ownership)',
    ];
    const p: Prog = labels.map((label) => ({ label, state: 'todo' }));
    const set = (i: number, state: Prog[number]['state'], detail?: any) => {
      p[i] = { ...p[i], state, detail };
      setProg([...p]);
    };
    setProg([...p]);
    let i = 0;
    try {
      set(i, 'doing');
      const k1 = Wallet.createRandom();
      const k3 = Wallet.createRandom();
      set(i, 'done', <Addr a={k1.address} />);

      set(++i, 'doing');
      const keystore = await encryptKey(k1, pw, (x) => set(1, 'doing', `${Math.round(x * 100)}%`));
      set(i, 'done', 'scrypt keystore, stored only on this device');

      set(++i, 'doing');
      const shares = await splitRecoveryKey(k3.privateKey);
      set(i, 'done', '① paper kit · ② your cloud · ③ recovery partner — any 2 rebuild it');

      set(++i, 'doing', 'Usually 10–20 seconds…');
      const dep = await cosigner.post('/wallets/deploy', { clientId, deviceAddress: k1.address, recoveryAddress: k3.address });
      set(i, 'done', <TxLink hash={dep.txHash}>Safe 2-of-3 deployed</TxLink>);

      set(++i, 'doing');
      await partner.post('/shares', {
        clientId,
        safeAddress: dep.safeAddress,
        share: shares.partner,
        kyc: { name: profile.name, dob: profile.kyc?.dob, idNumber: profile.kyc?.idDocument },
        questions: DEFAULT_QUESTIONS.map((question, j) => ({ question, answer: answers[j] })),
        paperCommitment: sha256(shares.paper),
      });
      set(i, 'done', 'Helvetia Trust & Recovery AG (mock) holds 1 of 3 parts — useless alone');

      set(++i, 'doing');
      const backup = await encryptCloudShare(dep.safeAddress, shares.cloud, pw);
      set(i, 'done', 'AES-256-GCM, key derived from your password');

      set(++i, 'doing');
      const statement = ownershipStatement(clientId, dep.safeAddress, new Date().toISOString());
      const sigK1 = await signSafeMessage(k1, dep.safeAddress, hashMessage(statement));
      const proof = await cosigner.post('/wallets/ownership-proof', { clientId, message: statement, signatureK1: sigK1 });
      await bank.post(`/clients/${clientId}/wallets`, { address: dep.safeAddress, message: statement, signature: proof.signature, label: 'SQ Wallet' });
      set(i, 'done', 'EIP-1271 signature verified on-chain → Travel Rule: verified self-hosted wallet');

      // Known beneficiaries imported from the Swissquote account (demo): own account + Bob.
      const bankInfo = await bank.get(`/clients/${clientId}`);
      await cosigner.post(`/clients/${clientId}/contacts`, { name: 'My Swissquote account', address: bankInfo.treasury, verifiedOwnership: true });
      await cosigner.post(`/clients/${clientId}/contacts`, { name: 'Bob', address: '0xb0b0000000000000000000000000000000000b0b' });

      saveDevice({ clientId, safeAddress: dep.safeAddress, deviceAddress: k1.address, keystore, credentialId, deviceType, createdAt: new Date().toISOString() });
      setUnlocked(k1);
      setResult({ safeAddress: dep.safeAddress, deployTx: dep.txHash, paper: encodePaperShare(dep.safeAddress, shares.paper), cloudBlob: JSON.stringify(backup, null, 2) });
      // The full recovery key only existed in memory; we drop every reference now.
      shares.partner = shares.cloud = '';
      setStep(4);
    } catch (e: any) {
      set(i, 'error');
      setErr(e.message);
    }
  };

  const download = (name: string, content: string | Blob, type = 'application/json') => {
    const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const downloadPaper = () => {
    const c = qrRef.current;
    if (!c || !result) return;
    c.toBlob((b) => b && download(`sq-wallet-paper-kit-${result.safeAddress.slice(2, 8)}.png`, b));
    setSaved((s) => ({ ...s, printed: true }));
  };

  const pwOk = pw.length >= 8 && pw === pw2;
  const answersOk = answers.every((a) => a.trim().length >= 2);

  return (
    <Shell>
      <Steps steps={STEPS} current={step} />
      <div className="mt-5 space-y-4">
        {step === 0 && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome, {profile.name.split(' ')[0]}</h1>
            <p className="text-[15px] text-navy-800">Create a self-custody wallet linked to your Swissquote account. You keep control of your funds — Swissquote adds bank-grade security, but can never move your money alone.</p>
            <Card className="space-y-4">
              {[
                ['📱', 'Your device key', 'Created on this device, protected by Touch ID / Face ID and your password. Used for everyday payments.'],
                ['🏦', 'Swissquote security check', 'Swissquote co-signs after its checks (identity, compliance, limits). It holds only 1 key of 3.'],
                ['🧩', 'Your recovery key', 'Split in 3 parts: a paper kit, your cloud backup and an independent Swiss trustee. Any 2 parts restore access — even if Swissquote disappears.'],
              ].map(([i, t, d]) => (
                <div key={t} className="flex gap-3">
                  <span className="text-2xl">{i}</span>
                  <div>
                    <div className="font-semibold">{t}</div>
                    <div className="text-sm text-navy-700/80">{d}</div>
                  </div>
                </div>
              ))}
              <p className="rounded-xl bg-navy-50 p-3 text-xs text-navy-800">
                Any 2 of these 3 keys are needed for a transaction. Rule enforced on-chain by a Safe smart account <RealBadge />
              </p>
            </Card>
            <Notice tone="ok" title="KYC already done">
              {profile.name} · {profile.kyc?.idDocument} <MockBadge />
            </Notice>
            <Button onClick={() => setStep(1)}>Create my wallet</Button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Link this {deviceType === 'mobile' ? 'phone' : 'computer'}</h1>
            <Why>We create a passkey on this device. Every sensitive action will ask for your fingerprint or face — so a stolen phone alone is useless. Max. 1 phone + 1 computer per client.</Why>
            <Card className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="text-5xl">👆</span>
              <div className="font-semibold">Touch ID / Face ID</div>
              <div className="text-sm text-navy-700/70">Your biometric data never leaves your device.</div>
            </Card>
            {err && <Notice tone="bad" title="Passkey not created">{err}</Notice>}
            <Button onClick={createPasskey} disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Waiting for Touch ID…
                </>
              ) : (
                'Create passkey'
              )}
            </Button>
          </>
        )}

        {step === 2 && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pwOk && answersOk) void create();
            }}
          >
            <h1 className="text-2xl font-semibold tracking-tight">Wallet password</h1>
            <Why>Your password encrypts your device key and your cloud backup. Swissquote never sees it and cannot reset it.</Why>
            <Card className="space-y-4">
              <Field label="Choose a password" hint="At least 8 characters">
                <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Repeat password">
                <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </Field>
            </Card>
            <h2 className="pt-2 font-semibold">Security questions</h2>
            <p className="-mt-2 text-sm text-navy-700/70">Used as one small signal during recovery — never enough on its own.</p>
            <Card className="space-y-4">
              {DEFAULT_QUESTIONS.map((q, j) => (
                <Field key={q} label={q}>
                  <input className={inputCls} value={answers[j]} onChange={(e) => setAnswers(answers.map((a, k) => (k === j ? e.target.value : a)))} />
                </Field>
              ))}
            </Card>
            <Button type="submit" disabled={!pwOk || !answersOk}>
              Create my wallet
            </Button>
          </form>
        )}

        {step === 3 && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Creating your wallet</h1>
            <Card>
              <ProgressList items={prog} />
            </Card>
            {err && (
              <Notice tone="bad" title="Something went wrong">
                {err}
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => setStep(2)}>
                    Try again
                  </Button>
                </div>
              </Notice>
            )}
          </>
        )}

        {step === 4 && result && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Save your recovery kit</h1>
            <Why>If you lose this device, these are your way back in. Keep the paper kit somewhere safe (not on this phone). Nobody — not even Swissquote — can rebuild your recovery key from one part alone.</Why>
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">① Paper kit</div>
                <span className="text-xs text-navy-700/60">print or store offline</span>
              </div>
              <div className="flex justify-center rounded-xl border border-navy-100 p-4">
                <QRCodeCanvas ref={qrRef} value={result.paper} size={220} marginSize={2} level="M" />
              </div>
              <details className="text-xs text-navy-700/70">
                <summary className="cursor-pointer">Show the code as text</summary>
                <code className="mt-2 block break-all rounded bg-navy-50 p-2">{result.paper}</code>
              </details>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={downloadPaper}>
                  Download kit
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.print();
                    setSaved((s) => ({ ...s, printed: true }));
                  }}
                >
                  Print
                </Button>
              </div>
            </Card>
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">② Cloud backup</div>
                <MockBadge label="Mock iCloud" />
              </div>
              <p className="text-sm text-navy-700/80">Encrypted with your wallet password. In the app this goes to your iCloud / Google Drive; here it is downloaded as a file.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  download(`sq-wallet-cloud-backup-${result.safeAddress.slice(2, 8)}.json`, result.cloudBlob);
                  setSaved((s) => ({ ...s, cloud: true }));
                }}
              >
                Save to cloud (download)
              </Button>
            </Card>
            <Card className="space-y-1">
              <div className="font-semibold">③ Recovery partner</div>
              <p className="text-sm text-navy-700/80">Stored with an independent Swiss trustee, released only after a video identity check. <MockBadge /></p>
            </Card>
            <Notice tone="ok" title="Your wallet is live on Ethereum">
              <Addr a={result.safeAddress} /> · <TxLink hash={result.deployTx} /> <span className="sr-only">{explorerTx(result.deployTx)}</span>
            </Notice>
            <Button disabled={!saved.printed || !saved.cloud} onClick={() => nav('/wallet')}>
              {saved.printed && saved.cloud ? 'Go to my wallet' : 'Save both parts to continue'}
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
}
