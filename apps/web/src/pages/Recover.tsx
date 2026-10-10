import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CircleCheck, CircleX, FileKey2, Fingerprint, HardDrive, ShieldAlert, Smile, Usb, X } from 'lucide-react';
import { Wallet, sha256 } from 'ethers';
import { buildSafeTx, decodeRecoveryCode, decryptShareOffline, parseShare2Record, questionLabel, reconstructK3FromShares, sealWithPassword, signSafeTx, swapOwnerData, type PasswordSealed, type Share2Record } from '@sq/shared';
import { openShareWithSecurityKey } from '../lib/securityKey';
import { recoveryQueueSafeTx } from '@sq/shared/protection';
import { getProtection } from '../lib/protection';
import { bank, cosigner, partner } from '../lib/api';
import { encryptKey, guessDeviceType, lock, registerPasskey, saveDevice, saveSession, setUnlocked } from '../lib/device';
import { checkPassword } from '../lib/passwordPolicy';
import { useLocal, usePoll } from '../lib/hooks';
import { getLang, tr } from '../lib/i18n';
import { Addr, Button, Card, cx, DemoFooter, Field, inputCls, Logo, mmss, MockBadge, Notice, ProgressList, SecretInput, Spinner, Steps, Tabs, TxLink, useCountdown, Why, type ProgState } from '../components/ui';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { CheckDisc } from '../components/Confirm';

const STEPS = [
  tr('Sign in', 'Connexion'),
  tr('Identity', 'Identité'),
  tr('Part of your backup key', 'Partie de votre clé de secours'),
  tr('New device', 'Nouvel appareil'),
  tr('Security delay', 'Délai de sécurité'),
];
const PENDING_KEY = 'mw:pending-recovery';

interface Pending {
  clientId: string;
  safeAddress: string;
  deviceAddress: string;
  keystore: string;
  credentialId: string;
  recoveryId: string;
  deviceType: 'mobile' | 'desktop';
  paperShareEnc?: PasswordSealed;
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

/** Groups the typed code by 4 characters (paste accepted). */
const formatCode = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 76)
    .replace(/(.{4})(?=.)/g, '$1 ');

function Frame({ children, step }: { children: React.ReactNode; step: number }) {
  return (
    <div className="mw-page min-h-screen bg-sq-bg">
      <div className="mx-auto w-full max-w-[560px] px-5 pb-8 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/sq" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-sq-ink-2">
            <ArrowLeft size={18} strokeWidth={1.75} /> Swissquote
          </Link>
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <Logo size={24} /> My Wall
          </span>
        </div>
        <Steps total={STEPS.length} current={Math.min(step, STEPS.length - 1)} label={STEPS[Math.min(step, STEPS.length - 1)]} />
        <div className="mt-6 space-y-4">{children}</div>
      </div>
      <DemoFooter />
    </div>
  );
}

export default function Recover() {
  const { session } = useLocal();
  const location = useLocation();
  useEffect(() => {
    if ((location.state as any)?.wipeDevice) {
      saveDevice(null); // "lost device" simulation: the encrypted device key is gone from this browser
      lock();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [pending, setPending] = useState<Pending | null>(loadPending());
  const [step, setStep] = useState(session ? 1 : 0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<any>(session?.profile);
  const [username, setUsername] = useState('alice');
  // identity
  const [sessionId, setSessionId] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [liveness, setLiveness] = useState<'match' | 'no-match' | null>(null);
  const [answers, setAnswers] = useState(['', '', '']);
  // recovery material: any 2 of ① paper code, ② security key (or offline file), ③ partner
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [part2Mode, setPart2Mode] = useState<'key' | 'file' | 'none'>('none');
  const [kitRecord, setKitRecord] = useState<Share2Record | null>(null);
  const [part2File, setPart2File] = useState<File | null>(null);
  const [filePw, setFilePw] = useState('');
  const [part2Progress, setPart2Progress] = useState(0);
  // decision
  const [refusal, setRefusal] = useState<any>(null);
  const [k3, setK3] = useState<Wallet | null>(null);
  const [paperShare, setPaperShare] = useState<string | null>(null);
  const [attestationId, setAttestationId] = useState('');
  const [safeAddress, setSafeAddress] = useState('');
  // new device
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [prog, setProg] = useState<{ label: string; state: ProgState; detail?: any }[]>([]);

  useEffect(() => {
    if (session) bank.get(`/clients/${session.clientId}`).then(setProfile).catch(() => undefined);
  }, [session?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== 1 || !session || sessionId) return;
    partner
      .post('/sessions', { clientId: session.clientId, context: { swissquoteLogin: true, newDevice: true, unusualIp: false, simSwapRecent: false } })
      .then((r) => {
        setSessionId(r.sessionId);
        setQuestions(r.questions);
      })
      .catch((e) => setErr(e.message));
  }, [step, session, sessionId]);

  // Part ② ciphertext kept by Swissquote (unreadable without the client's security key).
  useEffect(() => {
    if (step !== 2 || !session) return;
    cosigner
      .get(`/clients/${session.clientId}/recovery-kit`)
      .then((r) => {
        const rec = r?.share2?.record ? parseShare2Record(r.share2.record) : null;
        setKitRecord(rec);
      })
      .catch(() => setKitRecord(null));
  }, [step, session?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [first, ...rest] = (profile?.name ?? '').split(' ');
  const pwCheck = checkPassword(pw, { firstName: profile?.firstName ?? first, lastName: profile?.lastName ?? rest.join(' '), birthDate: profile?.birthDate });

  const login = async () => {
    setErr('');
    try {
      const r = await bank.post('/login', { username, password: 'demo' });
      saveSession({ token: r.token, clientId: r.clientId, profile: r.profile });
      setProfile(r.profile);
      setStep(1);
    } catch (e: any) {
      setErr(e.message);
    }
  };

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

  /** Opens part ② with the physical security key (record stored by Swissquote, or an offline copy) or the offline file. */
  const openPart2 = async (): Promise<string | null> => {
    if (part2Mode === 'none') return null;
    let rec: Share2Record | null = part2Mode === 'key' ? kitRecord : null;
    if (part2File) {
      try {
        rec = parseShare2Record(await part2File.text());
      } catch {
        throw new Error(tr('This file is not a My Wall recovery part ②.', "Ce fichier n'est pas une partie ② My Wall."));
      }
    }
    if (!rec) return null;
    if (rec.method === 'security-key') return openShareWithSecurityKey(rec);
    return decryptShareOffline(rec, filePw, setPart2Progress).catch(() => {
      throw new Error(tr('Wrong backup password for this offline file.', 'Mot de passe de sauvegarde incorrect pour ce fichier hors ligne.'));
    });
  };

  const decide = async (withMaterial: boolean) => {
    setBusy(true);
    setErr('');
    setCodeErr('');
    try {
      let paper: string | null = null;
      let part2: string | null = null;
      if (withMaterial) {
        // The security key is asked first, directly after the click (some browsers require a fresh user gesture).
        part2 = await openPart2();
        if (code.replace(/ /g, '').length) {
          const r = decodeRecoveryCode(code);
          if (!r.ok) {
            setCodeErr(r.error);
            return;
          }
          paper = r.share;
        }
        // Proof of possession for the partner: only a hash, never the part itself.
        if (paper) await partner.post(`/sessions/${sessionId}/paper-proof`, { commitment: sha256(paper), kind: 'paper' });
        else if (part2) await partner.post(`/sessions/${sessionId}/paper-proof`, { commitment: sha256(part2), kind: 'key' });
      }
      const r = await partner.post(`/sessions/${sessionId}/decide`);
      if (r.decision !== 'released') {
        setRefusal(r);
        return;
      }
      const own = [paper, part2].filter((x): x is string => !!x);
      if (!own.length) throw new Error(tr('One part of your backup key (paper code or security key) is required.', 'Une partie de votre clé de secours (code papier ou clé de sécurité) est nécessaire.'));
      const client = await cosigner.get(`/clients/${session!.clientId}`);
      // Two own parts (paper + security key): the partner's part is not even needed. Otherwise: own part + partner.
      const w = await reconstructK3FromShares(own.length >= 2 ? own : [own[0], r.share], { expectedAddress: client.owners?.recovery }).catch(() => {
        throw new Error(tr('These parts do not belong to this wallet (or were replaced since).', 'Ces parties n’appartiennent pas à ce wallet (ou ont été remplacées depuis).'));
      });
      setK3(w);
      setPaperShare(paper);
      setAttestationId(r.attestationId);
      setSafeAddress(client.safeAddress);
      setStep(3);
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? tr('The security key was not used (cancelled or timed out). Try again.', 'La clé de sécurité n’a pas été utilisée (annulé ou délai dépassé). Réessayez.') : e.message);
    } finally {
      setBusy(false);
    }
  };

  const setupDevice = async () => {
    setErr('');
    const labels = [
      tr('Creating a passkey on this new device', 'Création d’une passkey sur ce nouvel appareil'),
      tr('New device key, encrypted with your password', 'Nouvelle clé d’appareil, chiffrée avec votre mot de passe'),
      tr('Signing the replacement with your backup key', 'Signature du remplacement avec votre clé de secours'),
      tr('Sending the request to Swissquote (security delay starts)', 'Envoi de la demande à Swissquote (début du délai de sécurité)'),
    ];
    const p = labels.map((label) => ({ label, state: 'todo' as ProgState, detail: undefined as any }));
    const set = (i: number, state: ProgState, detail?: any) => {
      p[i] = { ...p[i], state, detail };
      setProg([...p]);
    };
    setProg([...p]);
    let i = 0;
    try {
      set(i, 'doing');
      const deviceType = guessDeviceType();
      const reg = await registerPasskey(session!.clientId, deviceType, attestationId);
      set(i, 'done', tr('Active as soon as recovery completes', 'Active dès la fin de la récupération'));
      set(++i, 'doing');
      const k1 = Wallet.createRandom();
      const keystore = await encryptKey(k1, pw);
      const paperShareEnc = paperShare ? await sealWithPassword(safeAddress, paperShare, pw) : undefined;
      set(i, 'done', <Addr a={k1.address} />);
      set(++i, 'doing');
      const on = await cosigner.get(`/clients/${session!.clientId}/onchain`);
      const client = await cosigner.get(`/clients/${session!.clientId}`);
      // Protected wallet: K3 + K2 can no longer swap directly — the swap is queued in the delay module D1 (on-chain countdown).
      const prot = await getProtection(session!.clientId).catch(() => null);
      const tx = prot?.protected && prot.config
        ? recoveryQueueSafeTx(safeAddress, prot.config.d1, on.owners, client.owners.device, k1.address, on.nonce).safeTx
        : buildSafeTx({ to: safeAddress, data: swapOwnerData(on.owners, client.owners.device, k1.address), nonce: on.nonce });
      const signatureK3 = await signSafeTx(k3!, safeAddress, tx);
      setK3(null); // the recovery key leaves memory
      set(i, 'done', tr('Old key → new key', 'Ancienne clé → nouvelle clé'));
      set(++i, 'doing');
      const r = await cosigner.post('/recovery/request', { clientId: session!.clientId, safeTx: tx, signatureK3, partnerAttestationId: attestationId, newCredentialId: reg.credentialId });
      set(i, 'done');
      const pend: Pending = { clientId: session!.clientId, safeAddress, deviceAddress: k1.address, keystore, credentialId: reg.credentialId, recoveryId: r.id, deviceType, paperShareEnc };
      storePending(pend);
      setUnlocked(k1);
      setPending(pend);
    } catch (e: any) {
      set(i, 'error');
      setErr(e?.name === 'NotAllowedError' ? tr('Touch ID was cancelled. Please try again.', 'Touch ID a été annulé. Réessayez.') : e.message);
    }
  };

  if (pending)
    return (
      <Waiting
        pending={pending}
        onReset={() => {
          storePending(null);
          setPending(null);
        }}
      />
    );

  if (refusal)
    return (
      <Frame step={2}>
        <RefusalCard refusal={refusal} />
        <Link to="/sq">
          <Button variant="secondary">{tr('Back to Swissquote', 'Retour à Swissquote')}</Button>
        </Link>
      </Frame>
    );

  return (
    <Frame step={step}>
      <h1 className="text-[26px] font-semibold tracking-tight">{tr('I lost my device', "J'ai perdu mon appareil")}</h1>
      {step === 0 && (
        <>
          <Why>{tr('First sign in to your Swissquote account. It is protected by its own credentials, separate from your wallet.', 'Connectez-vous d’abord à votre compte Swissquote. Il est protégé par ses propres identifiants, distincts de votre wallet.')}</Why>
          <Card className="space-y-4">
            <Field label={tr('Swissquote username', 'Identifiant Swissquote')} hint={tr('Demo: alice or bruno', 'Démo : alice ou bruno')}>
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            {err && <Notice tone="bad">{err}</Notice>}
            <Button onClick={login}>{tr('Sign in', 'Se connecter')}</Button>
          </Card>
        </>
      )}

      {step === 1 && (
        <>
          <Why>
            {tr(
              'An independent Swiss partner checks that it is really you. It holds one part of your backup key — useless on its own — and only releases it after these checks.',
              'Un partenaire suisse indépendant vérifie que c’est bien vous. Il détient une partie de votre clé de secours — inutile seule — et ne la libère qu’après ces contrôles.',
            )}
          </Why>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">1. {tr('Video selfie', 'Selfie vidéo')}</h2>
              <MockBadge label={tr('Simulated verification', 'Vérification simulée')} />
            </div>
            <div className="flex aspect-video items-center justify-center rounded-[10px] bg-sq-dark text-white/80">
              <Smile size={56} strokeWidth={1.25} />
            </div>
            <p className="text-[12px] text-sq-muted">{tr('In production, a certified provider compares a video selfie with your KYC photo.', 'En production, un prestataire certifié compare un selfie vidéo à votre photo KYC.')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={liveness === 'match' ? 'primary' : 'secondary'} onClick={() => setLiveness('match')}>
                <CircleCheck size={18} strokeWidth={1.75} /> {tr('Face matches', 'Visage conforme')}
              </Button>
              <Button variant={liveness === 'no-match' ? 'danger' : 'secondary'} onClick={() => setLiveness('no-match')}>
                <CircleX size={18} strokeWidth={1.75} /> {tr('No match', 'Non conforme')}
              </Button>
            </div>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-semibold">2. {tr('Your recovery questions', 'Vos questions de récupération')}</h2>
            <p className="text-[12px] text-sq-muted">{tr('They help recognise you but are never enough on their own.', 'Elles aident à vous reconnaître mais ne suffisent jamais seules.')}</p>
            {questions.map((q, j) => (
              <Field key={q} label={questionLabel(q, getLang())}>
                <SecretInput value={answers[j]} onChange={(v) => setAnswers(answers.map((a, k) => (k === j ? v : a)))} autoComplete="off" />
              </Field>
            ))}
            {!questions.length && !err && <Spinner className="text-sq-muted" />}
          </Card>
          {err && <Notice tone="bad">{err}</Notice>}
          <Button onClick={submitIdentity} disabled={!liveness || busy || !sessionId}>
            {tr('Continue', 'Continuer')}
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <Why>
            {tr(
              'You need 2 of the 3 parts of your backup key: ① your paper code, ② your security key, ③ the partner’s part. Bring what you have: with your paper code and your security key, the partner’s part is not even needed.',
              'Il faut 2 parties sur 3 de votre clé de secours : ① votre code papier, ② votre clé de sécurité, ③ la partie du partenaire. Apportez ce que vous avez : avec votre code papier et votre clé de sécurité, la partie du partenaire n’est même pas nécessaire.',
            )}
          </Why>
          <Card className="space-y-3">
            <h2 className="font-semibold">① {tr('Paper code', 'Code papier')}</h2>
            <Field label={tr('Recovery code', 'Code de récupération')} error={codeErr || undefined} hint={tr('19 groups of 4 characters. Pasting is allowed. Leave empty if you do not have it.', '19 groupes de 4 caractères. Le collage est accepté. Laissez vide si vous ne l’avez pas.')}>
              <textarea
                className={cx(inputCls, 'h-28 resize-none font-mono text-[15px] uppercase leading-relaxed tracking-wider')}
                value={code}
                onChange={(e) => {
                  setCode(formatCode(e.target.value));
                  setCodeErr('');
                }}
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="XXXX XXXX XXXX …"
                aria-label={tr('Recovery code', 'Code de récupération')}
              />
            </Field>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-semibold">② {tr('Security key', 'Clé de sécurité')}</h2>
            <Tabs
              value={part2Mode}
              onChange={(v) => {
                setPart2Mode(v);
                setPart2File(null);
                setFilePw('');
              }}
              tabs={[
                { id: 'none', label: tr('Not using it', 'Non utilisée') },
                { id: 'key', label: tr('Security key', 'Clé de sécurité') },
                { id: 'file', label: tr('Offline file', 'Fichier hors ligne') },
              ]}
            />
            {part2Mode === 'key' && (
              <>
                {kitRecord?.method === 'security-key' && !part2File ? (
                  <p className="flex items-start gap-2 text-[14px] text-sq-ink-2">
                    <Usb size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    {tr('Your encrypted part ② is kept by Swissquote — unreadable without your key. Insert your security key (or have your second device ready) and touch it when asked.', 'Votre partie ② chiffrée est conservée par Swissquote — illisible sans votre clé. Insérez votre clé de sécurité (ou préparez votre second appareil) et touchez-la quand on vous le demande.')}
                  </p>
                ) : (
                  <label className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-sq-line text-center text-[14px] text-sq-ink-2 hover:bg-sq-bg/60">
                    <Usb size={24} strokeWidth={1.5} />
                    {part2File ? part2File.name : tr('Choose the offline copy (my-wall-security-key-part-….json)', 'Choisir la copie hors ligne (my-wall-security-key-part-….json)')}
                    <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => setPart2File(e.target.files?.[0] ?? null)} />
                  </label>
                )}
              </>
            )}
            {part2Mode === 'file' && (
              <>
                <label className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-sq-line text-center text-[14px] text-sq-ink-2 hover:bg-sq-bg/60">
                  <HardDrive size={24} strokeWidth={1.5} />
                  {part2File ? part2File.name : tr('Choose the offline backup file (my-wall-offline-backup-….json)', 'Choisir le fichier de sauvegarde hors ligne (my-wall-offline-backup-….json)')}
                  <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => setPart2File(e.target.files?.[0] ?? null)} />
                </label>
                <Field label={tr('Backup password (not your wallet password)', 'Mot de passe de sauvegarde (pas celui du wallet)')}>
                  <SecretInput value={filePw} onChange={setFilePw} autoComplete="off" />
                </Field>
                {busy && part2Progress > 0 && <p className="num text-[13px] text-sq-muted">{tr('Decrypting…', 'Déchiffrement…')} {Math.round(part2Progress * 100)} %</p>}
              </>
            )}
          </Card>
          {err && <Notice tone="bad">{err}</Notice>}
          <Button
            onClick={() => decide(true)}
            disabled={
              busy ||
              (code.replace(/ /g, '').length < 4 &&
                !(part2Mode === 'key' && (kitRecord?.method === 'security-key' || part2File)) &&
                !(part2Mode === 'file' && part2File && filePw))
            }
          >
            {busy ? <Spinner /> : tr('Verify and continue', 'Vérifier et continuer')}
          </Button>
          <Button variant="ghost" onClick={() => decide(false)} disabled={busy}>
            {tr('I have neither the code nor the security key', "Je n'ai ni le code ni la clé de sécurité")}
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          <Notice tone="ok" title={tr('Identity confirmed — backup key rebuilt on this device', 'Identité confirmée — clé de secours reconstituée sur cet appareil')}>
            {tr('The partner released its part. Now set up this new device.', 'Le partenaire a libéré sa partie. Configurez maintenant ce nouvel appareil.')}
          </Notice>
          {!prog.length ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (pwCheck.ok && pw === pw2) void setupDevice();
              }}
            >
              <Card className="space-y-4">
                <Field label={tr('New wallet password', 'Nouveau mot de passe du wallet')} error={pw && !pwCheck.ok ? pwCheck.message : undefined}>
                  <SecretInput value={pw} onChange={setPw} />
                </Field>
                <PasswordChecklist rules={pwCheck.rules} />
                <Field label={tr('Confirm the password', 'Confirmez le mot de passe')} error={pw2 && pw2 !== pw ? tr('The two passwords do not match.', 'Les deux mots de passe ne correspondent pas.') : undefined}>
                  <SecretInput value={pw2} onChange={setPw2} />
                </Field>
              </Card>
              <Button type="submit" disabled={!pwCheck.ok || pw !== pw2}>
                <Fingerprint size={18} strokeWidth={1.75} /> {tr('Link this device with Touch ID', 'Lier cet appareil avec Touch ID')}
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
    </Frame>
  );
}

export function RefusalCard({ refusal }: { refusal: any }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-sq-bad-50 text-sq-down">
          <ShieldAlert size={24} strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-[18px] font-semibold">{tr('Recovery refused', 'Récupération refusée')}</div>
          <div className="text-[14px] text-sq-muted">
            {tr(
              `Risk score ${refusal.riskScore} (limit ${refusal.threshold}). Nothing was released.`,
              `Score de risque ${refusal.riskScore} (limite ${refusal.threshold}). Rien n’a été libéré.`,
            )}
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-[14px]">
        {refusal.factors.map((f: any) => (
          <li key={f.factor} className="flex items-start gap-2">
            <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white', f.ok ? 'bg-sq-up' : 'bg-sq-down')} aria-label={f.ok ? tr('Passed', 'Réussi') : tr('Failed', 'Échec')}>
              {f.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
            </span>
            <span>
              {f.factor}
              {f.hard && !f.ok && <b className="text-sq-down"> — {tr('required', 'obligatoire')}</b>}
              {!f.hard && f.points > 0 && <span className="text-sq-muted"> ({tr(`+${f.points} risk`, `+${f.points} risque`)})</span>}
            </span>
          </li>
        ))}
      </ul>
      <Why>
        {tr(
          'The real account holder has been alerted in their Swissquote account. If you are the holder, contact Swissquote: an adviser-assisted recovery is possible with video identification.',
          'Le vrai titulaire a été alerté dans son compte Swissquote. Si vous êtes le titulaire, contactez Swissquote : une récupération assistée par un conseiller est possible avec une identification vidéo.',
        )}
      </Why>
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
        paperShareEnc: pending.paperShareEnc,
      });
      storePending(null);
    }
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Frame step={r?.status === 'completed' ? 5 : 4}>
      <h1 className="text-[26px] font-semibold tracking-tight">{tr('Security delay', 'Délai de sécurité')}</h1>
      {!r ? (
        <Spinner />
      ) : r.status === 'pending-delay' || r.status === 'executing' ? (
        <>
          <Card className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="num text-[48px] font-semibold">{mmss(left)}</div>
            <div className="text-[14px] text-sq-muted">{r.status === 'executing' ? tr('Replacing the keys on Ethereum…', 'Remplacement des clés sur Ethereum…') : tr('before your new device is activated', 'avant l’activation de votre nouvel appareil')}</div>
            <div className="text-[12px] text-sq-muted">{tr('2 minutes in this demo · 48 hours in production', '2 minutes dans cette démo · 48 heures en production')}</div>
            {r.onchain && (
              <div className="text-[12px] text-sq-muted">
                {tr('Countdown enforced by the blockchain (delay module D1) — ', 'Compte à rebours imposé par la blockchain (module de délai D1) — ')}
                <TxLink hash={r.onchain.queueTx}>{tr('queued on-chain', 'mis en file on-chain')}</TxLink>
              </div>
            )}
          </Card>
          <Why>
            {tr(
              'We have notified you by email, SMS and in your Swissquote account. If someone else started this recovery, the real holder can cancel it in one tap during the delay.',
              'Nous vous avons prévenu par email, SMS et dans votre compte Swissquote. Si quelqu’un d’autre a lancé cette récupération, le vrai titulaire peut l’annuler d’un geste pendant le délai.',
            )}
          </Why>
          <Link to="/inbox" target="_blank" className="block">
            <Button variant="secondary">
              <FileKey2 size={18} strokeWidth={1.75} /> {tr('Open the inbox (cancel button)', 'Ouvrir la boîte de réception (bouton d’annulation)')}
            </Button>
          </Link>
        </>
      ) : r.status === 'completed' ? (
        <>
          <Card className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckDisc />
            <div className="text-[20px] font-semibold">{tr('Access recovered', 'Accès récupéré')}</div>
            <div className="text-[14px] text-sq-muted">{tr('Your old device can no longer sign: it has been revoked on the blockchain.', 'Votre ancien appareil ne peut plus signer : il a été révoqué sur la blockchain.')}</div>
            <TxLink hash={r.txHash} />
          </Card>
          <Button onClick={() => nav('/wallet')}>{tr('Open My Wall', 'Ouvrir My Wall')}</Button>
        </>
      ) : (
        <>
          <Notice tone={r.status === 'cancelled' ? 'warn' : 'bad'} title={r.status === 'cancelled' ? tr('Recovery cancelled', 'Récupération annulée') : tr('Recovery failed', 'Récupération échouée')}>
            {r.status === 'cancelled' ? tr('The recovery was cancelled from the Swissquote account. Nothing changed on the blockchain.', 'La récupération a été annulée depuis le compte Swissquote. Rien n’a changé sur la blockchain.') : r.error}
          </Notice>
          <Button variant="secondary" onClick={onReset}>
            {tr('Start over', 'Recommencer')}
          </Button>
        </>
      )}
    </Frame>
  );
}
