import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, Cloud, Copy, Eye, Fingerprint, IdCard, KeyRound, Printer, ScanFace, ShieldCheck, Smartphone } from 'lucide-react';
import { Wallet, hashMessage, sha256 } from 'ethers';
import {
  RECOVERY_QUESTIONS,
  availableQuestions,
  encodeRecoveryCode,
  encryptCloudShare,
  ownershipStatement,
  signSafeMessage,
  splitRecoveryKey,
} from '@sq/shared';
import { bank, cosigner, partner } from '../lib/api';
import { encryptKey, guessDeviceType, registerPasskey, saveDevice, setUnlocked } from '../lib/device';
import { checkPassword } from '../lib/passwordPolicy';
import { useLocal } from '../lib/hooks';
import { Button, Card, cx, dateOnly, DemoFooter, Field, inputCls, Logo, MockBadge, Notice, ProgressList, SecretInput, Spinner, Steps, TxLink, Why, type ProgState } from '../components/ui';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { BiometricsOptions } from '../components/BiometricsOptions';

const STEP_LABELS = ['Bienvenue', "Pièce d'identité", 'Passkey', 'Mot de passe', 'Questions', 'Création du wallet', 'Kit de récupération'];
type Prog = { label: string; state: ProgState; detail?: any }[];

export default function Onboarding() {
  const nav = useNavigate();
  const { session } = useLocal();
  const clientId = session!.clientId;
  const [profile, setProfile] = useState<any>(session!.profile);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentialId, setCredentialId] = useState<string>();
  const deviceType = guessDeviceType();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [qs, setQs] = useState<(number | null)[]>([null, null, null]);
  const [answers, setAnswers] = useState(['', '', '']);
  const [prog, setProg] = useState<Prog>([]);
  const [result, setResult] = useState<{ safeAddress: string; deployTx: string; code: string; cloudBlob: string } | null>(null);

  useEffect(() => {
    bank.get(`/clients/${clientId}`).then(setProfile).catch(() => undefined);
  }, [clientId]);

  const [first, ...rest] = (profile?.name ?? '').split(' ');
  const pwCheck = checkPassword(pw, { firstName: profile?.firstName ?? first, lastName: profile?.lastName ?? rest.join(' '), birthDate: profile?.birthDate });
  const idVerified = profile?.idVerification?.status === 'accepted';
  const goNext = () => setStep((s) => (s === 0 && idVerified ? 2 : s + 1));

  const createPasskey = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await registerPasskey(clientId, deviceType);
      setCredentialId(r.credentialId);
      setStep(3);
    } catch (e: any) {
      setErr(e.name === 'NotAllowedError' ? 'Touch ID a été annulé ou a expiré. Réessayez.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setStep(5);
    setErr('');
    const labels = [
      'Création de votre clé d’appareil',
      'Chiffrement avec votre mot de passe',
      'Préparation de votre clé de secours (3 parties)',
      'Ouverture de votre wallet sur Ethereum (frais offerts)',
      'Envoi de la partie ③ au partenaire de récupération',
      'Chiffrement de la partie ② pour votre sauvegarde cloud',
      'Enregistrement du wallet à votre nom',
    ];
    const p: Prog = labels.map((label) => ({ label, state: 'todo' }));
    const set = (i: number, state: ProgState, detail?: any) => {
      p[i] = { ...p[i], state, detail };
      setProg([...p]);
    };
    setProg([...p]);
    let i = 0;
    try {
      set(i, 'doing');
      const k1 = Wallet.createRandom();
      const k3 = Wallet.createRandom();
      set(i, 'done', 'Générée sur cet appareil');

      set(++i, 'doing');
      const keystore = await encryptKey(k1, pw, (x) => set(1, 'doing', `${Math.round(x * 100)} %`));
      set(i, 'done', 'Elle ne quitte jamais cet appareil');

      set(++i, 'doing');
      const shares = await splitRecoveryKey(k3.privateKey);
      set(i, 'done', '① code papier · ② votre cloud · ③ partenaire — 2 parties suffisent');

      set(++i, 'doing', 'En général 10 à 20 secondes…');
      const dep = await cosigner.post('/wallets/deploy', { clientId, deviceAddress: k1.address, recoveryAddress: k3.address });
      set(i, 'done', <TxLink hash={dep.txHash}>Wallet 2 sur 3 ouvert</TxLink>);

      set(++i, 'doing');
      await partner.post('/shares', {
        clientId,
        safeAddress: dep.safeAddress,
        share: shares.partner,
        kyc: { name: profile.name, dob: profile.birthDate ?? profile.kyc?.dob, idNumber: profile.kyc?.idDocument },
        questions: qs.map((q, j) => ({ question: RECOVERY_QUESTIONS[q!], answer: answers[j] })),
        paperCommitment: sha256(shares.paper),
        cloudCommitment: sha256(shares.cloud),
      });
      set(i, 'done', 'Une partie sur trois : inutilisable seule');

      set(++i, 'doing');
      const backup = await encryptCloudShare(dep.safeAddress, shares.cloud, pw);
      const paperEnc = await encryptCloudShare(dep.safeAddress, shares.paper, pw);
      set(i, 'done', 'AES-256-GCM, clé dérivée de votre mot de passe');

      set(++i, 'doing');
      const statement = ownershipStatement(clientId, dep.safeAddress, new Date().toISOString());
      const sigK1 = await signSafeMessage(k1, dep.safeAddress, hashMessage(statement));
      const proof = await cosigner.post('/wallets/ownership-proof', { clientId, message: statement, signatureK1: sigK1 });
      await bank.post(`/clients/${clientId}/wallets`, { address: dep.safeAddress, message: statement, signature: proof.signature, label: 'My Wall' });
      const bankInfo = await bank.get(`/clients/${clientId}`);
      await cosigner.post(`/clients/${clientId}/contacts`, { name: 'Compte Swissquote', address: bankInfo.treasury, verifiedOwnership: true });
      await cosigner.post(`/clients/${clientId}/contacts`, { name: 'Bob', address: '0xb0b0000000000000000000000000000000000b0b' });
      set(i, 'done', 'Preuve EIP-1271 vérifiée sur la blockchain (Travel Rule)');

      saveDevice({ clientId, safeAddress: dep.safeAddress, deviceAddress: k1.address, keystore, credentialId, deviceType, createdAt: new Date().toISOString(), paperShareEnc: paperEnc });
      setUnlocked(k1);
      setResult({ safeAddress: dep.safeAddress, deployTx: dep.txHash, code: encodeRecoveryCode(shares.paper), cloudBlob: JSON.stringify(backup, null, 2) });
      // The full recovery key only existed in memory; drop the references.
      shares.partner = shares.cloud = shares.paper = '';
      setStep(6);
    } catch (e: any) {
      set(i, 'error');
      setErr(e.message);
    }
  };

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
        <Steps total={STEP_LABELS.length} current={step} label={STEP_LABELS[step]} />
        <div className="mt-6 space-y-4">
          {step === 0 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight">Bienvenue, {profile?.firstName ?? first}</h1>
              <p className="text-[15px] leading-relaxed text-sq-ink-2">
                Activez My Wall : un wallet en self-custody relié à votre compte Swissquote. Vous gardez le contrôle de vos fonds ; Swissquote ajoute une sécurité de banque, sans jamais pouvoir déplacer votre argent seul.
              </p>
              <Card className="space-y-4">
                {[
                  [Smartphone, 'Votre clé d’appareil', 'Créée sur cet appareil, protégée par Touch ID / Face ID et votre mot de passe. Pour les opérations courantes.'],
                  [Building2, 'Le contrôle Swissquote', 'Swissquote co-signe après ses vérifications (identité, conformité, limites). Il ne détient qu’une clé sur trois.'],
                  [KeyRound, 'Votre clé de secours', 'Découpée en 3 parties : un code papier, votre sauvegarde cloud et un partenaire suisse indépendant. 2 parties suffisent — même si Swissquote disparaît.'],
                ].map(([Icon, t, d]: any) => (
                  <div key={t} className="flex gap-3">
                    <Icon size={24} strokeWidth={1.75} className="mt-0.5 shrink-0 text-sq-ink-2" />
                    <div>
                      <div className="font-semibold">{t}</div>
                      <div className="text-[14px] text-sq-muted">{d}</div>
                    </div>
                  </div>
                ))}
                <p className="rounded-[10px] bg-sq-bg p-3 text-[13px] text-sq-ink-2">Deux clés sur trois sont nécessaires pour chaque opération. Cette règle est appliquée par la blockchain elle-même (Safe).</p>
              </Card>
              <Notice tone="ok" title="Client Swissquote, identité déjà connue (KYC)">
                {profile?.name} <MockBadge />
              </Notice>
              <Button onClick={goNext}>Activer My Wall</Button>
            </>
          )}

          {step === 1 && (
            <IdentityStep
              clientId={clientId}
              name={profile?.name ?? ''}
              onDone={(v) => {
                setProfile({ ...profile, idVerification: v });
                setStep(2);
              }}
            />
          )}

          {step === 2 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight">Lier {deviceType === 'mobile' ? 'ce téléphone' : 'cet ordinateur'}</h1>
              <Why>Nous créons une passkey sur cet appareil. Chaque action sensible demandera une vérification par votre appareil (empreinte, visage ou code de l’appareil) : un téléphone volé seul ne sert à rien. Au maximum 1 téléphone et 1 ordinateur par client.</Why>
              <Card className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-sq-bg">
                  <Fingerprint size={32} strokeWidth={1.5} className="text-sq-orange" />
                </span>
                <div className="font-semibold">Touch ID, Face ID ou code de l’appareil</div>
                <div className="text-[14px] text-sq-muted">Vos données biométriques ne quittent jamais l’appareil.</div>
              </Card>
              <BiometricsOptions>
                <p className="text-sq-muted">Vous pourrez configurer un code de secours juste après l’activation, dans Clés et sécurité.</p>
              </BiometricsOptions>
              {err && <Notice tone="bad" title="Passkey non créée">{err}</Notice>}
              <Button onClick={createPasskey} disabled={busy}>
                {busy ? (
                  <>
                    <Spinner /> En attente de Touch ID…
                  </>
                ) : (
                  'Créer la passkey'
                )}
              </Button>
            </>
          )}

          {step === 3 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (pwCheck.ok && pw === pw2) setStep(4);
              }}
            >
              <h1 className="text-[26px] font-semibold tracking-tight">Mot de passe du wallet</h1>
              <Why>Il chiffre votre clé d’appareil et votre sauvegarde cloud. Swissquote ne le voit jamais et ne peut pas le réinitialiser. Le collage et les gestionnaires de mots de passe sont acceptés.</Why>
              <Card className="space-y-4">
                <Field label="Choisissez un mot de passe" error={pw.length > 0 && !pwCheck.ok ? pwCheck.message : undefined}>
                  <SecretInput value={pw} onChange={setPw} autoComplete="new-password" />
                </Field>
                <PasswordChecklist rules={pwCheck.rules} />
                <Field label="Confirmez le mot de passe" error={pw2 && pw2 !== pw ? 'Les deux mots de passe ne correspondent pas.' : undefined}>
                  <SecretInput value={pw2} onChange={setPw2} autoComplete="new-password" />
                </Field>
              </Card>
              <p className="text-[12px] text-sq-muted">Ces règles ne garantissent pas à elles seules la sécurité : la clé reste aussi protégée par Touch ID et par la co-signature Swissquote.</p>
              <Button type="submit" disabled={!pwCheck.ok || pw !== pw2}>
                Continuer
              </Button>
            </form>
          )}

          {step === 4 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (qs.every((q) => q !== null) && answers.every((a) => a.trim())) void create();
              }}
            >
              <h1 className="text-[26px] font-semibold tracking-tight">Questions de récupération</h1>
              <Why>Choisissez 3 questions différentes. Elles aident à vous reconnaître mais ne suffisent jamais seules : récupérer votre wallet exige aussi un selfie vidéo, une partie de votre clé de secours et un délai de sécurité.</Why>
              {[0, 1, 2].map((slot) => (
                <Card key={slot} className="space-y-3">
                  <Field label={`Question ${slot + 1}`}>
                    <select
                      className={cx(inputCls, 'appearance-auto')}
                      value={qs[slot] ?? ''}
                      onChange={(e) => setQs(qs.map((q, k) => (k === slot ? (e.target.value === '' ? null : Number(e.target.value)) : q)))}
                    >
                      <option value="">Choisir une question…</option>
                      {availableQuestions(qs, slot).map((i) => (
                        <option key={i} value={i}>
                          {RECOVERY_QUESTIONS[i]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Réponse" hint="Majuscules, accents et espaces ne comptent pas.">
                    <SecretInput value={answers[slot]} onChange={(v) => setAnswers(answers.map((a, k) => (k === slot ? v : a)))} autoComplete="off" />
                  </Field>
                </Card>
              ))}
              <p className="text-[12px] text-sq-muted">Le partenaire de récupération ne conserve qu’une empreinte (hash) de vos réponses, jamais les réponses en clair.</p>
              <Button type="submit" disabled={!qs.every((q) => q !== null) || !answers.every((a) => a.trim())}>
                Créer mon wallet
              </Button>
            </form>
          )}

          {step === 5 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight">Création de votre wallet</h1>
              <Card>
                <ProgressList items={prog} />
              </Card>
              {err && (
                <Notice tone="bad" title="Un problème est survenu">
                  {err}
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => setStep(4)}>
                      Réessayer
                    </Button>
                  </div>
                </Notice>
              )}
            </>
          )}

          {step === 6 && result && <KitStep result={result} name={profile?.name ?? ''} onDone={() => nav('/wallet')} />}
        </div>
      </div>
      <DemoFooter />
    </div>
  );
}

// ───────────────── Identity document (simulated, processed locally only) ─────────────────
function specimen(kind: 'front' | 'back' | 'passport', name: string) {
  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ').toUpperCase();
  const stamp = `<text x="214" y="160" text-anchor="middle" font-family="Helvetica" font-size="44" font-weight="700" fill="#e20e00" opacity=".35" transform="rotate(-14 214 140)">SPECIMEN</text>`;
  const svg =
    kind === 'back'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="428" height="270"><rect width="428" height="270" rx="16" fill="#eef1f6"/><rect x="24" y="24" width="380" height="60" rx="6" fill="#dfe4ee"/><text x="34" y="200" font-family="monospace" font-size="15" fill="#303137">IDCHEX1234567&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text><text x="34" y="222" font-family="monospace" font-size="15" fill="#303137">9203147F3105019CHE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text><text x="34" y="244" font-family="monospace" font-size="15" fill="#303137">${last}&lt;&lt;${(first ?? '').toUpperCase()}&lt;&lt;&lt;&lt;</text>${stamp}</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="428" height="270"><rect width="428" height="270" rx="16" fill="${kind === 'passport' ? '#f4ece6' : '#fbe9e7'}"/><rect x="24" y="22" width="380" height="30" rx="4" fill="#e20e00"/><text x="36" y="43" font-family="Helvetica" font-size="15" font-weight="700" fill="#fff">${kind === 'passport' ? 'PASSEPORT · SCHWEIZ · SUISSE' : "CARTE D'IDENTITÉ · SUISSE"}</text><rect x="28" y="70" width="110" height="140" rx="8" fill="#cfd5e0"/><circle cx="83" cy="120" r="26" fill="#aab3c2"/><rect x="48" y="152" width="70" height="44" rx="22" fill="#aab3c2"/><text x="160" y="92" font-family="Helvetica" font-size="12" fill="#6f7480">Nom / Name</text><text x="160" y="112" font-family="Helvetica" font-size="18" font-weight="700" fill="#303137">${last}</text><text x="160" y="138" font-family="Helvetica" font-size="12" fill="#6f7480">Prénom(s)</text><text x="160" y="158" font-family="Helvetica" font-size="18" font-weight="700" fill="#303137">${first ?? ''}</text><text x="160" y="186" font-family="Helvetica" font-size="12" fill="#6f7480">N° X1234567 · exp. 2031</text>${stamp}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function IdentityStep({ clientId, name, onDone }: { clientId: string; name: string; onDone: (v: any) => void }) {
  const [method, setMethod] = useState<'id-card' | 'passport'>('id-card');
  const [front, setFront] = useState<{ url: string; name: string } | null>(null);
  const [back, setBack] = useState<{ url: string; name: string } | null>(null);
  const [simulateRefusal, setSimulateRefusal] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'checking' | 'refused' | 'accepted'>('edit');
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = (setter: (v: { url: string; name: string }) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Processed locally only: never uploaded, never stored.
    const url = URL.createObjectURL(f);
    urls.current.push(url);
    setter({ url, name: f.name });
  };
  const useDemo = () => {
    if (method === 'id-card') {
      setFront({ url: specimen('front', name), name: 'specimen-recto.svg' });
      setBack({ url: specimen('back', name), name: 'specimen-verso.svg' });
    } else setFront({ url: specimen('passport', name), name: 'specimen-passeport.svg' });
  };
  const ready = method === 'passport' ? !!front : !!front && !!back;
  const submit = async () => {
    setPhase('checking');
    await new Promise((r) => setTimeout(r, 2000));
    const refused = simulateRefusal || [front?.name, back?.name].some((n) => n?.toUpperCase().includes('REJECT'));
    const v = await bank.post(`/clients/${clientId}/id-verification`, { status: refused ? 'refused' : 'accepted', method });
    if (refused) setPhase('refused');
    else {
      setPhase('accepted');
      setTimeout(() => onDone(v), 900);
    }
  };

  const slot = (label: string, v: { url: string; name: string } | null, set: any) => (
    <label className="block cursor-pointer">
      <span className="mb-1.5 block text-[14px] font-medium">{label}</span>
      {v ? (
        <img src={v.url} alt={`Aperçu ${label}`} className="aspect-[1.58] w-full rounded-[10px] border border-sq-line object-cover" />
      ) : (
        <span className="flex aspect-[1.58] w-full flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-sq-line bg-white text-[13px] text-sq-muted">
          <IdCard size={28} strokeWidth={1.5} /> Ajouter une photo
        </span>
      )}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick(set)} />
    </label>
  );

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Pièce d'identité</h1>
      <Why>Nous vérifions que le wallet est bien ouvert par vous. Cette étape n'a lieu qu'une fois. Dans cette démo, les images sont traitées localement : jamais envoyées, jamais stockées.</Why>
      {phase === 'checking' ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <ScanFace size={36} strokeWidth={1.5} className="text-sq-orange" />
          <div className="font-semibold">Vérification en cours…</div>
          <Spinner className="text-sq-muted" />
        </Card>
      ) : phase === 'accepted' ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-sq-up text-white">
            <Check size={24} strokeWidth={2.5} />
          </span>
          <div className="font-semibold">Pièce d'identité acceptée</div>
          <div className="text-[13px] text-sq-muted">Identité vérifiée (simulée) — {dateOnly(new Date().toISOString())}</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-sq-chip/60 p-1">
            {(
              [
                ['id-card', "Carte d'identité suisse"],
                ['passport', 'Passeport'],
              ] as const
            ).map(([id, l]) => (
              <button
                key={id}
                type="button"
                aria-pressed={method === id}
                onClick={() => {
                  setMethod(id);
                  setFront(null);
                  setBack(null);
                  setPhase('edit');
                }}
                className={cx('min-h-11 rounded-[8px] text-[14px]', method === id ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}
              >
                {l}
              </button>
            ))}
          </div>
          <Card className="space-y-4">
            {method === 'id-card' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {slot('Recto', front, setFront)}
                {slot('Verso', back, setBack)}
              </div>
            ) : (
              slot('Page photo', front, setFront)
            )}
            <Button variant="secondary" onClick={useDemo}>
              Utiliser le document de démonstration
            </Button>
            <details className="text-[13px] text-sq-muted">
              <summary className="min-h-11 cursor-pointer py-2">Options de démo</summary>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={simulateRefusal} onChange={(e) => setSimulateRefusal(e.target.checked)} className="size-4 accent-[#fa5b35]" />
                Simuler un refus
              </label>
            </details>
          </Card>
          {phase === 'refused' && (
            <Notice tone="bad" title="Document illisible">
              La photo est floue. Reprenez une photo nette, sans reflet.
            </Notice>
          )}
          <Button onClick={submit} disabled={!ready}>
            {phase === 'refused' ? 'Réessayer' : 'Envoyer'}
          </Button>
          <p className="text-[12px] text-sq-muted">
            Vérification simulée <MockBadge /> — en production : prestataire de vérification vidéo agréé (conservation et accès à définir).
          </p>
        </>
      )}
    </>
  );
}

// ───────────────── Recovery kit — no QR code ─────────────────
function KitStep({ result, name, onDone }: { result: { safeAddress: string; deployTx: string; code: string; cloudBlob: string }; name: string; onDone: () => void }) {
  const [shownUntil, setShownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saved, setSaved] = useState({ code: false, cloud: false });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    const onVis = () => document.visibilityState === 'hidden' && setShownUntil(0);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const left = Math.max(0, Math.ceil((shownUntil - now) / 1000));
  const visible = left > 0;
  const download = (fileName: string, content: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Votre kit de récupération</h1>
      <Why>Si vous perdez cet appareil, c'est votre chemin de retour. Gardez le code papier hors de ce téléphone. Personne — pas même Swissquote — ne peut reconstituer votre clé de secours avec une seule partie.</Why>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">① Code de récupération papier</h2>
          <span className="text-[12px] text-sq-muted">à imprimer ou recopier</span>
        </div>
        <code data-testid="recovery-code" className={cx('block rounded-[10px] border border-sq-line p-3 font-mono text-[15px] leading-loose tracking-wider', !visible && 'select-none text-sq-muted')} aria-live="polite">
          {visible ? result.code : result.code.replace(/[0-9A-Z]/g, '•')}
        </code>
        {visible && (
          <div className="h-1 overflow-hidden rounded-full bg-sq-line" aria-hidden>
            <div className="mw-countdown h-full bg-sq-orange" style={{ animationDuration: '30s' }} key={shownUntil} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="px-2 text-[14px]" onClick={() => (visible ? setShownUntil(0) : setShownUntil(Date.now() + 30_000))}>
            <Eye size={16} strokeWidth={1.75} /> {visible ? `Masquer (${left} s)` : 'Afficher'}
          </Button>
          <Button
            variant="secondary"
            className="px-2 text-[14px]"
            onClick={() => {
              window.print();
              setSaved((s) => ({ ...s, code: true }));
            }}
          >
            <Printer size={16} strokeWidth={1.75} /> Imprimer
          </Button>
          <Button
            variant="secondary"
            className="px-2 text-[14px]"
            onClick={async () => {
              await navigator.clipboard.writeText(result.code).catch(() => undefined);
              setCopied(true);
              setSaved((s) => ({ ...s, code: true }));
              setTimeout(() => navigator.clipboard.writeText('').catch(() => undefined), 30_000);
            }}
          >
            <Copy size={16} strokeWidth={1.75} /> Copier
          </Button>
        </div>
        {copied && <p className="text-[12px] text-sq-muted">Copié. Le presse-papiers contient une donnée sensible.</p>}
        <p className="text-[12px] text-sq-muted">19 groupes de 4 caractères ; chaque groupe contient un caractère de contrôle pour repérer les fautes de frappe.</p>
      </Card>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Cloud size={18} strokeWidth={1.75} /> ② Sauvegarde cloud
          </h2>
          <MockBadge label="Cloud simulé" />
        </div>
        <p className="text-[14px] text-sq-ink-2">Chiffrée avec votre mot de passe. Dans l'app, elle irait dans votre iCloud / Google Drive ; ici, elle est téléchargée.</p>
        <Button
          variant="secondary"
          onClick={() => {
            download(`my-wall-cloud-backup-${result.safeAddress.slice(2, 8)}.json`, result.cloudBlob);
            setSaved((s) => ({ ...s, cloud: true }));
          }}
        >
          Enregistrer dans le cloud (télécharger)
        </Button>
      </Card>
      <Card className="space-y-1">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} strokeWidth={1.75} /> ③ Partenaire de récupération
        </h2>
        <p className="text-[14px] text-sq-ink-2">
          Conservée par un trustee suisse indépendant, libérée seulement après une vérification d'identité vidéo. <MockBadge />
        </p>
      </Card>
      <Notice tone="ok" title="Votre wallet est ouvert sur Ethereum">
        <TxLink hash={result.deployTx} />
      </Notice>
      <Button disabled={!saved.code || !saved.cloud} onClick={onDone}>
        {saved.code && saved.cloud ? 'Ouvrir My Wall' : 'Imprimez ou copiez le code, puis sauvegardez la partie ②'}
      </Button>

      {/* Printable kit (window.print): logo, name, date, code in large monospace, instructions — no QR. */}
      <div className="print-only">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/brand/swissquote-logo.png" width={48} height={48} alt="" />
          <div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>My Wall — Kit de récupération</div>
            <div style={{ fontSize: 12, color: '#6f7480' }}>Prototype — données de test</div>
          </div>
        </div>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          Client : <b>{name}</b> · Date : {dateOnly(new Date().toISOString())}
          <br />
          Wallet : <span style={{ fontFamily: 'monospace' }}>{result.safeAddress}</span>
        </p>
        <div style={{ marginTop: 24, padding: 20, border: '2px solid #303137', borderRadius: 12, fontFamily: 'monospace', fontSize: 22, lineHeight: 1.8, letterSpacing: 2 }}>{result.code}</div>
        <ol style={{ marginTop: 24, fontSize: 13, lineHeight: 1.7 }}>
          <li>Ce code est la partie ① de votre clé de secours. Seul, il ne permet rien.</li>
          <li>Rangez cette feuille dans un endroit sûr, hors de votre téléphone. Conseil : faites-en 2 copies.</li>
          <li>En cas de perte d'appareil : My Wall → « J'ai perdu mon appareil », puis saisissez ce code.</li>
          <li>Ne le communiquez jamais, ni par téléphone ni par email. Swissquote ne vous le demandera jamais.</li>
        </ol>
      </div>
    </>
  );
}
