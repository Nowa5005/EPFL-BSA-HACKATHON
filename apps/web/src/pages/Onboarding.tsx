import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, Fingerprint, IdCard, KeyRound, ScanFace, Smartphone } from 'lucide-react';
import { Wallet, hashMessage, sha256 } from 'ethers';
import {
  RECOVERY_QUESTIONS,
  availableQuestions,
  questionText,
  encodeRecoveryCode,
  ownershipStatement,
  sealWithPassword,
  signSafeMessage,
  splitRecoveryKey,
} from '@sq/shared';
import { bank, cosigner, partner } from '../lib/api';
import { activateProtection } from '../lib/protection';
import { guessDeviceType, registerPasskey, saveDevice, sealDeviceKey, setUnlocked, type PasskeyBinding } from '../lib/device';
import { checkPassword } from '../lib/passwordPolicy';
import { useLocal } from '../lib/hooks';
import { getLang, tr } from '../lib/i18n';
import { Button, Card, cx, dateOnly, DemoFooter, Field, inputCls, Logo, MockBadge, Notice, ProgressList, SecretInput, Spinner, Steps, TxLink, Why, type ProgState } from '../components/ui';
import { RecoveryKitSetup } from '../components/RecoveryKitSetup';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { BiometricsOptions } from '../components/BiometricsOptions';

const STEP_LABELS = [
  tr('Welcome', 'Bienvenue'),
  tr('ID document', "Pièce d'identité"),
  'Passkey',
  tr('Password', 'Mot de passe'),
  tr('Questions', 'Questions'),
  tr('Wallet creation', 'Création du wallet'),
  tr('Recovery kit', 'Kit de récupération'),
];
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
  const [result, setResult] = useState<{ safeAddress: string; deployTx: string; code: string } | null>(null);
  // Part ② of the recovery key stays in memory only until the client protected it (security key or offline file).
  const share2Ref = useRef<string | null>(null);
  // #11 — PRF output of the new passkey (memory only) used to bind the device key to this hardware.
  const bindingRef = useRef<PasskeyBinding | null>(null);

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
      const r = await registerPasskey(clientId, deviceType, undefined, { hardwareBinding: true });
      bindingRef.current = r.binding;
      setCredentialId(r.credentialId);
      setStep(3);
    } catch (e: any) {
      setErr(e.name === 'NotAllowedError' ? tr('Touch ID was cancelled or timed out. Please try again.', 'Touch ID a été annulé ou a expiré. Réessayez.') : e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setStep(5);
    setErr('');
    const labels = [
      tr('Creating your device key', 'Création de votre clé d’appareil'),
      tr('Encrypting with your password', 'Chiffrement avec votre mot de passe'),
      tr('Preparing your backup key (3 parts)', 'Préparation de votre clé de secours (3 parties)'),
      tr('Opening your wallet on Ethereum (fees covered)', 'Ouverture de votre wallet sur Ethereum (frais offerts)'),
      tr('Activating on-chain protection (security delays)', 'Activation de la protection on-chain (délais de sécurité)'),
      tr('Sending part ③ to the recovery partner', 'Envoi de la partie ③ au partenaire de récupération'),
      tr('Keeping a sealed copy of part ① on this device', 'Copie scellée de la partie ① sur cet appareil'),
      tr('Registering the wallet in your name', 'Enregistrement du wallet à votre nom'),
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
      set(i, 'done', tr('Generated on this device', 'Générée sur cet appareil'));

      set(++i, 'doing');
      const sealed = await sealDeviceKey(k1, pw, bindingRef.current, (x) => set(1, 'doing', `${Math.round(x * 100)} %`));
      bindingRef.current = null;
      set(i, 'done', sealed.hwKeystore ? tr('Password + this device’s passkey (hardware binding) — it never leaves this device', 'Mot de passe + passkey de cet appareil (liaison matérielle) — elle ne quitte jamais cet appareil') : tr('It never leaves this device', 'Elle ne quitte jamais cet appareil'));

      set(++i, 'doing');
      const shares = await splitRecoveryKey(k3.privateKey);
      set(i, 'done', tr('① paper code · ② your security key · ③ partner — any 2 parts are enough', '① code papier · ② votre clé de sécurité · ③ partenaire — 2 parties suffisent'));

      set(++i, 'doing', tr('Usually 10 to 20 seconds…', 'En général 10 à 20 secondes…'));
      const dep = await cosigner.post('/wallets/deploy', { clientId, deviceAddress: k1.address, recoveryAddress: k3.address });
      set(i, 'done', <TxLink hash={dep.txHash}>{tr('2-of-3 wallet opened', 'Wallet 2 sur 3 ouvert')}</TxLink>);

      // Guard + delay modules (K1 + K2 batch, signed here with the brand-new device key). Not blocking: if it fails,
      // the wallet works as before and "Upgrade wallet security" in Security activates it later.
      set(++i, 'doing');
      try {
        const prot = await activateProtection(clientId, dep.safeAddress, k1);
        set(i, 'done', <TxLink hash={prot.txHash}>{tr('Only your device + Swissquote act immediately', 'Seuls votre appareil + Swissquote agissent immédiatement')}</TxLink>);
      } catch (e: any) {
        set(i, 'error', tr(`Not activated (${e.message}) — you can enable it later in Security`, `Non activée (${e.message}) — vous pourrez l’activer plus tard dans Sécurité`));
      }

      set(++i, 'doing');
      await partner.post('/shares', {
        clientId,
        safeAddress: dep.safeAddress,
        share: shares.partner,
        kyc: { name: profile.name, dob: profile.birthDate ?? profile.kyc?.dob, idNumber: profile.kyc?.idDocument },
        questions: qs.map((q, j) => ({ question: RECOVERY_QUESTIONS[q!], answer: answers[j] })),
        paperCommitment: sha256(shares.paper),
        share2Commitment: sha256(shares.key),
      });
      set(i, 'done', tr('One part out of three: useless on its own', 'Une partie sur trois : inutilisable seule'));

      set(++i, 'doing');
      const paperEnc = await sealWithPassword(dep.safeAddress, shares.paper, pw);
      set(i, 'done', tr('AES-256-GCM, key derived from your password — never leaves this device', 'AES-256-GCM, clé dérivée de votre mot de passe — ne quitte jamais cet appareil'));

      set(++i, 'doing');
      const statement = ownershipStatement(clientId, dep.safeAddress, new Date().toISOString());
      const sigK1 = await signSafeMessage(k1, dep.safeAddress, hashMessage(statement));
      const proof = await cosigner.post('/wallets/ownership-proof', { clientId, message: statement, signatureK1: sigK1 });
      await bank.post(`/clients/${clientId}/wallets`, { address: dep.safeAddress, message: statement, signature: proof.signature, label: 'My Wall' });
      const bankInfo = await bank.get(`/clients/${clientId}`);
      await cosigner.post(`/clients/${clientId}/contacts`, { name: tr('Swissquote account', 'Compte Swissquote'), address: bankInfo.treasury, verifiedOwnership: true });
      await cosigner.post(`/clients/${clientId}/contacts`, { name: 'Bob', address: '0xb0b0000000000000000000000000000000000b0b' });
      set(i, 'done', tr('EIP-1271 proof verified on the blockchain (Travel Rule)', 'Preuve EIP-1271 vérifiée sur la blockchain (Travel Rule)'));

      saveDevice({ clientId, safeAddress: dep.safeAddress, deviceAddress: k1.address, ...sealed, credentialId, deviceType, createdAt: new Date().toISOString(), paperShareEnc: paperEnc });
      setUnlocked(k1);
      share2Ref.current = shares.key; // protected at the next step (security key, or offline file)
      setResult({ safeAddress: dep.safeAddress, deployTx: dep.txHash, code: encodeRecoveryCode(shares.paper) });
      // The full recovery key only existed in memory; drop the references.
      shares.partner = shares.key = shares.paper = '';
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
              <h1 className="text-[26px] font-semibold tracking-tight">{tr('Welcome', 'Bienvenue')}, {profile?.firstName ?? first}</h1>
              <p className="text-[15px] leading-relaxed text-sq-ink-2">
                {tr(
                  'Activate My Wall: a self-custody wallet linked to your Swissquote account. You stay in control of your funds; Swissquote adds bank-grade security without ever being able to move your money on its own.',
                  'Activez My Wall : un wallet en self-custody relié à votre compte Swissquote. Vous gardez le contrôle de vos fonds ; Swissquote ajoute une sécurité de banque, sans jamais pouvoir déplacer votre argent seul.',
                )}
              </p>
              <Card className="space-y-4">
                {[
                  [Smartphone, tr('Your device key', 'Votre clé d’appareil'), tr('Created on this device, protected by Touch ID / Face ID and your password. For everyday operations.', 'Créée sur cet appareil, protégée par Touch ID / Face ID et votre mot de passe. Pour les opérations courantes.')],
                  [Building2, tr('Swissquote control', 'Le contrôle Swissquote'), tr('Swissquote co-signs after its checks (identity, compliance, limits). It holds only one key out of three.', 'Swissquote co-signe après ses vérifications (identité, conformité, limites). Il ne détient qu’une clé sur trois.')],
                  [KeyRound, tr('Your backup key', 'Votre clé de secours'), tr('Split into 3 parts: a paper code, your physical security key and an independent Swiss partner. Any 2 parts are enough — even if Swissquote disappears. Nothing goes to a cloud.', 'Découpée en 3 parties : un code papier, votre clé de sécurité physique et un partenaire suisse indépendant. 2 parties suffisent — même si Swissquote disparaît. Rien ne part dans un cloud.')],
                ].map(([Icon, t, d]: any) => (
                  <div key={t} className="flex gap-3">
                    <Icon size={24} strokeWidth={1.75} className="mt-0.5 shrink-0 text-sq-ink-2" />
                    <div>
                      <div className="font-semibold">{t}</div>
                      <div className="text-[14px] text-sq-muted">{d}</div>
                    </div>
                  </div>
                ))}
                <p className="rounded-[10px] bg-sq-bg p-3 text-[13px] text-sq-ink-2">{tr('Two keys out of three are required for every operation. This rule is enforced by the blockchain itself (Safe).', 'Deux clés sur trois sont nécessaires pour chaque opération. Cette règle est appliquée par la blockchain elle-même (Safe).')}</p>
              </Card>
              <Notice tone="ok" title={tr('Swissquote client, identity already known (KYC)', 'Client Swissquote, identité déjà connue (KYC)')}>
                {profile?.name} <MockBadge />
              </Notice>
              <Button onClick={goNext}>{tr('Activate My Wall', 'Activer My Wall')}</Button>
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
              <h1 className="text-[26px] font-semibold tracking-tight">{deviceType === 'mobile' ? tr('Link this phone', 'Lier ce téléphone') : tr('Link this computer', 'Lier cet ordinateur')}</h1>
              <Why>
                {tr(
                  'We create a passkey on this device. Every sensitive action will ask your device to verify you (fingerprint, face or device code): a stolen phone alone is useless. At most 1 phone and 1 computer per client.',
                  'Nous créons une passkey sur cet appareil. Chaque action sensible demandera une vérification par votre appareil (empreinte, visage ou code de l’appareil) : un téléphone volé seul ne sert à rien. Au maximum 1 téléphone et 1 ordinateur par client.',
                )}
              </Why>
              <Card className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-sq-bg">
                  <Fingerprint size={32} strokeWidth={1.5} className="text-sq-orange" />
                </span>
                <div className="font-semibold">{tr('Touch ID, Face ID or device code', 'Touch ID, Face ID ou code de l’appareil')}</div>
                <div className="text-[14px] text-sq-muted">{tr('Your biometric data never leaves the device.', 'Vos données biométriques ne quittent jamais l’appareil.')}</div>
              </Card>
              <BiometricsOptions>
                <p className="text-sq-muted">{tr('You can set up a backup code right after activation, in Keys & security.', 'Vous pourrez configurer un code de secours juste après l’activation, dans Clés et sécurité.')}</p>
              </BiometricsOptions>
              {err && <Notice tone="bad" title={tr('Passkey not created', 'Passkey non créée')}>{err}</Notice>}
              <Button onClick={createPasskey} disabled={busy}>
                {busy ? (
                  <>
                    <Spinner /> {tr('Waiting for Touch ID…', 'En attente de Touch ID…')}
                  </>
                ) : (
                  tr('Create the passkey', 'Créer la passkey')
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
              <h1 className="text-[26px] font-semibold tracking-tight">{tr('Wallet password', 'Mot de passe du wallet')}</h1>
              <Why>
                {tr(
                  'It encrypts your device key on this device. Swissquote never sees it and cannot reset it. Pasting and password managers are allowed.',
                  'Il chiffre votre clé d’appareil sur cet appareil. Swissquote ne le voit jamais et ne peut pas le réinitialiser. Le collage et les gestionnaires de mots de passe sont acceptés.',
                )}
              </Why>
              <Card className="space-y-4">
                <Field label={tr('Choose a password', 'Choisissez un mot de passe')} error={pw.length > 0 && !pwCheck.ok ? pwCheck.message : undefined}>
                  <SecretInput value={pw} onChange={setPw} autoComplete="new-password" />
                </Field>
                <PasswordChecklist rules={pwCheck.rules} />
                <Field label={tr('Confirm the password', 'Confirmez le mot de passe')} error={pw2 && pw2 !== pw ? tr('The two passwords do not match.', 'Les deux mots de passe ne correspondent pas.') : undefined}>
                  <SecretInput value={pw2} onChange={setPw2} autoComplete="new-password" />
                </Field>
              </Card>
              <p className="text-[12px] text-sq-muted">{tr('These rules alone do not guarantee security: the key is also protected by Touch ID and Swissquote co-signing.', 'Ces règles ne garantissent pas à elles seules la sécurité : la clé reste aussi protégée par Touch ID et par la co-signature Swissquote.')}</p>
              <Button type="submit" disabled={!pwCheck.ok || pw !== pw2}>
                {tr('Continue', 'Continuer')}
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
              <h1 className="text-[26px] font-semibold tracking-tight">{tr('Recovery questions', 'Questions de récupération')}</h1>
              <Why>
                {tr(
                  'Choose 3 different questions. They help recognise you but are never enough on their own: recovering your wallet also requires a video selfie, one part of your backup key and a security delay.',
                  'Choisissez 3 questions différentes. Elles aident à vous reconnaître mais ne suffisent jamais seules : récupérer votre wallet exige aussi un selfie vidéo, une partie de votre clé de secours et un délai de sécurité.',
                )}
              </Why>
              {[0, 1, 2].map((slot) => (
                <Card key={slot} className="space-y-3">
                  <Field label={`Question ${slot + 1}`}>
                    <select
                      className={cx(inputCls, 'appearance-auto')}
                      value={qs[slot] ?? ''}
                      onChange={(e) => setQs(qs.map((q, k) => (k === slot ? (e.target.value === '' ? null : Number(e.target.value)) : q)))}
                    >
                      <option value="">{tr('Choose a question…', 'Choisir une question…')}</option>
                      {availableQuestions(qs, slot).map((i) => (
                        <option key={i} value={i}>
                          {questionText(i, getLang())}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tr('Answer', 'Réponse')} hint={tr('Capitals, accents and spaces do not matter.', 'Majuscules, accents et espaces ne comptent pas.')}>
                    <SecretInput value={answers[slot]} onChange={(v) => setAnswers(answers.map((a, k) => (k === slot ? v : a)))} autoComplete="off" />
                  </Field>
                </Card>
              ))}
              <p className="text-[12px] text-sq-muted">{tr('The recovery partner only keeps a fingerprint (hash) of your answers, never the answers in clear text.', 'Le partenaire de récupération ne conserve qu’une empreinte (hash) de vos réponses, jamais les réponses en clair.')}</p>
              <Button type="submit" disabled={!qs.every((q) => q !== null) || !answers.every((a) => a.trim())}>
                {tr('Create my wallet', 'Créer mon wallet')}
              </Button>
            </form>
          )}

          {step === 5 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight">{tr('Creating your wallet', 'Création de votre wallet')}</h1>
              <Card>
                <ProgressList items={prog} />
              </Card>
              {err && (
                <Notice tone="bad" title={tr('Something went wrong', 'Un problème est survenu')}>
                  {err}
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => setStep(4)}>
                      {tr('Try again', 'Réessayer')}
                    </Button>
                  </div>
                </Notice>
              )}
            </>
          )}

          {step === 6 && result && (
            <KitStep
              result={result}
              name={profile?.name ?? ''}
              clientId={clientId}
              walletPassword={pw}
              pwContext={{ firstName: profile?.firstName ?? first, lastName: profile?.lastName ?? rest.join(' '), birthDate: profile?.birthDate }}
              share2={share2Ref.current}
              dropShare2={() => (share2Ref.current = null)}
              onDone={() => {
                setPw('');
                setPw2('');
                nav('/wallet');
              }}
            />
          )}
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
        <img src={v.url} alt={tr(`${label} preview`, `Aperçu ${label}`)} className="aspect-[1.58] w-full rounded-[10px] border border-sq-line object-cover" />
      ) : (
        <span className="flex aspect-[1.58] w-full flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-sq-line bg-white text-[13px] text-sq-muted">
          <IdCard size={28} strokeWidth={1.5} /> {tr('Add a photo', 'Ajouter une photo')}
        </span>
      )}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick(set)} />
    </label>
  );

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">{tr('ID document', "Pièce d'identité")}</h1>
      <Why>
        {tr(
          'We check that the wallet is really being opened by you. This step only happens once. In this demo, images are processed locally: never sent, never stored.',
          "Nous vérifions que le wallet est bien ouvert par vous. Cette étape n'a lieu qu'une fois. Dans cette démo, les images sont traitées localement : jamais envoyées, jamais stockées.",
        )}
      </Why>
      {phase === 'checking' ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <ScanFace size={36} strokeWidth={1.5} className="text-sq-orange" />
          <div className="font-semibold">{tr('Verifying…', 'Vérification en cours…')}</div>
          <Spinner className="text-sq-muted" />
        </Card>
      ) : phase === 'accepted' ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-sq-up text-white">
            <Check size={24} strokeWidth={2.5} />
          </span>
          <div className="font-semibold">{tr('ID document accepted', "Pièce d'identité acceptée")}</div>
          <div className="text-[13px] text-sq-muted">{tr('Identity verified (simulated)', 'Identité vérifiée (simulée)')} — {dateOnly(new Date().toISOString())}</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-sq-chip/60 p-1">
            {(
              [
                ['id-card', tr('Swiss ID card', "Carte d'identité suisse")],
                ['passport', tr('Passport', 'Passeport')],
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
                {slot(tr('Front', 'Recto'), front, setFront)}
                {slot(tr('Back', 'Verso'), back, setBack)}
              </div>
            ) : (
              slot(tr('Photo page', 'Page photo'), front, setFront)
            )}
            <Button variant="secondary" onClick={useDemo}>
              {tr('Use the demo document', 'Utiliser le document de démonstration')}
            </Button>
            <details className="text-[13px] text-sq-muted">
              <summary className="min-h-11 cursor-pointer py-2">{tr('Demo options', 'Options de démo')}</summary>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={simulateRefusal} onChange={(e) => setSimulateRefusal(e.target.checked)} className="size-4 accent-[#fa5b35]" />
                {tr('Simulate a rejection', 'Simuler un refus')}
              </label>
            </details>
          </Card>
          {phase === 'refused' && (
            <Notice tone="bad" title={tr('Document unreadable', 'Document illisible')}>
              {tr('The photo is blurry. Take a sharp photo, without glare.', 'La photo est floue. Reprenez une photo nette, sans reflet.')}
            </Notice>
          )}
          <Button onClick={submit} disabled={!ready}>
            {phase === 'refused' ? tr('Try again', 'Réessayer') : tr('Submit', 'Envoyer')}
          </Button>
          <p className="text-[12px] text-sq-muted">
            {tr('Simulated verification', 'Vérification simulée')} <MockBadge /> —{' '}
            {tr('in production: an approved video identification provider (retention and access to be defined).', 'en production : prestataire de vérification vidéo agréé (conservation et accès à définir).')}
          </p>
        </>
      )}
    </>
  );
}

// ───────────────── Recovery kit — no QR code, no cloud ─────────────────
function KitStep({
  result,
  name,
  clientId,
  walletPassword,
  pwContext,
  share2,
  dropShare2,
  onDone,
}: {
  result: { safeAddress: string; deployTx: string; code: string };
  name: string;
  clientId: string;
  walletPassword: string;
  pwContext: { firstName?: string; lastName?: string; birthDate?: string };
  share2: string | null;
  dropShare2: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">{tr('Your recovery kit', 'Votre kit de récupération')}</h1>
      <Why>
        {tr(
          'If you lose this device, this is your way back: any 2 of the 3 parts rebuild your backup key. Keep the paper code and the security key apart from this phone and from each other. Nothing is stored in a cloud.',
          "Si vous perdez cet appareil, c'est votre chemin de retour : 2 des 3 parties reconstituent votre clé de secours. Gardez le code papier et la clé de sécurité loin de ce téléphone et séparés l’un de l’autre. Rien n’est stocké dans un cloud.",
        )}
      </Why>
      <RecoveryKitSetup
        safeAddress={result.safeAddress}
        code={result.code}
        share2={share2}
        name={name}
        clientId={clientId}
        walletPassword={walletPassword}
        pwContext={pwContext}
        persist={(p) => cosigner.post(`/clients/${clientId}/recovery-kit/share2`, p)}
        onShare2Done={dropShare2}
        footer={(ready) => (
          <>
            <Notice tone="ok" title={tr('Your wallet is open on Ethereum', 'Votre wallet est ouvert sur Ethereum')}>
              <TxLink hash={result.deployTx} />
            </Notice>
            <Button disabled={!ready} onClick={onDone}>
              {ready ? tr('Open My Wall', 'Ouvrir My Wall') : tr('Print or copy the code, then protect part ②', 'Imprimez ou copiez le code, puis protégez la partie ②')}
            </Button>
          </>
        )}
      />
    </>
  );
}
