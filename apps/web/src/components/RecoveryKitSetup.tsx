// Recovery kit: the client's two parts of the recovery key K3 (2 of 3 needed) — no cloud anywhere.
//   ① paper code — printed / written, ideally engraved on a steel plate; home safe or bank safe-deposit box
//   ② physical security key (FIDO2 / YubiKey, or a second device) — the part is encrypted with a key that only
//      that authenticator can derive (WebAuthn PRF); Swissquote stores the unreadable ciphertext.
//      Fallback without a PRF-capable key: an offline encrypted file + a distinct backup password.
//   ③ independent recovery partner (unchanged)
// Used by onboarding (Recovery kit step) and by Security → "Replace my recovery kit".

import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Download, Eye, HardDrive, KeyRound, Printer, ShieldCheck, Usb } from 'lucide-react';
import { OFFLINE_NOTICE, encryptShareOffline, type SecurityKeyShare } from '@sq/shared';
import { checkPassword, type PasswordContext } from '../lib/passwordPolicy';
import { PrfUnsupportedError, prfSupport, protectShareWithSecurityKey, type PrfSupport } from '../lib/securityKey';
import { tr } from '../lib/i18n';
import { Button, Card, cx, dateOnly, Field, MockBadge, Notice, SecretInput, Spinner } from './ui';
import { PasswordChecklist } from './PasswordChecklist';

export type Share2Persist = { method: 'security-key'; record: SecurityKeyShare } | { method: 'offline-password' };

export function downloadJson(fileName: string, content: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function RecoveryKitSetup(props: {
  safeAddress: string;
  /** Paper code (share ①) as shown to the client. */
  code: string;
  /** Share ② in clear — memory only, the parent drops it once `onShare2Done` fired. */
  share2: string | null;
  name: string;
  clientId: string;
  walletPassword: string;
  pwContext: PasswordContext;
  /** Stores what Swissquote may keep (security-key ciphertext, or just the "offline file" choice). */
  persist: (p: Share2Persist) => Promise<void>;
  onShare2Done: () => void;
  footer: (ready: boolean) => ReactNode;
}) {
  const { safeAddress, code } = props;
  const [shownUntil, setShownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [codeSaved, setCodeSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [part2, setPart2] = useState<null | { method: 'security-key'; record: SecurityKeyShare } | { method: 'offline-password' }>(null);
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

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">① {tr('Paper recovery code', 'Code de récupération papier')}</h2>
          <span className="text-[12px] text-sq-muted">{tr('print or copy it by hand', 'à imprimer ou recopier')}</span>
        </div>
        <code data-testid="recovery-code" className={cx('block rounded-[10px] border border-sq-line p-3 font-mono text-[15px] leading-loose tracking-wider', !visible && 'select-none text-sq-muted')} aria-live="polite">
          {visible ? code : code.replace(/[0-9A-Z]/g, '•')}
        </code>
        {visible && (
          <div className="h-1 overflow-hidden rounded-full bg-sq-line" aria-hidden>
            <div className="mw-countdown h-full bg-sq-orange" style={{ animationDuration: '30s' }} key={shownUntil} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="px-2 text-[14px]" onClick={() => (visible ? setShownUntil(0) : setShownUntil(Date.now() + 30_000))}>
            <Eye size={16} strokeWidth={1.75} /> {visible ? tr(`Hide (${left} s)`, `Masquer (${left} s)`) : tr('Show', 'Afficher')}
          </Button>
          <Button
            variant="secondary"
            className="px-2 text-[14px]"
            onClick={() => {
              window.print();
              setCodeSaved(true);
            }}
          >
            <Printer size={16} strokeWidth={1.75} /> {tr('Print', 'Imprimer')}
          </Button>
          <Button
            variant="secondary"
            className="px-2 text-[14px]"
            onClick={async () => {
              await navigator.clipboard.writeText(code).catch(() => undefined);
              setCopied(true);
              setCodeSaved(true);
              setTimeout(() => navigator.clipboard.writeText('').catch(() => undefined), 30_000);
            }}
          >
            <Copy size={16} strokeWidth={1.75} /> {tr('Copy', 'Copier')}
          </Button>
        </div>
        {copied && <p className="text-[12px] text-sq-muted">{tr('Copied. The clipboard now holds sensitive data.', 'Copié. Le presse-papiers contient une donnée sensible.')}</p>}
        <p className="text-[12px] text-sq-muted">{tr('19 groups of 4 characters; each group contains a check character to catch typos.', '19 groupes de 4 caractères ; chaque groupe contient un caractère de contrôle pour repérer les fautes de frappe.')}</p>
        <p className="rounded-[10px] bg-sq-bg p-3 text-[13px] text-sq-ink-2">
          {tr(
            'Best: engrave or stamp it on a steel plate (survives fire and water). Keep it at home in a safe place or in a bank safe-deposit box — never with your phone, never as a photo, never in a cloud.',
            'Idéal : gravez-le ou frappez-le sur une plaque en acier (résiste au feu et à l’eau). Gardez-le chez vous en lieu sûr ou dans un coffre bancaire — jamais avec votre téléphone, jamais en photo, jamais dans un cloud.',
          )}
        </p>
      </Card>

      <Part2Card {...props} done={part2} onDone={(p) => setPart2(p)} />

      <Card className="space-y-1">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} strokeWidth={1.75} /> ③ {tr('Recovery partner', 'Partenaire de récupération')}
        </h2>
        <p className="text-[14px] text-sq-ink-2">
          {tr('Held by an independent Swiss trustee, released only after a video identity check.', "Conservée par un trustee suisse indépendant, libérée seulement après une vérification d'identité vidéo.")} <MockBadge />
        </p>
      </Card>

      {props.footer(codeSaved && !!part2)}

      {/* Printable kit (window.print): logo, name, date, code in large monospace, instructions — no QR. */}
      <div className="print-only">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/brand/swissquote-logo.png" width={48} height={48} alt="" />
          <div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>My Wall — {tr('Recovery kit', 'Kit de récupération')}</div>
            <div style={{ fontSize: 12, color: '#6f7480' }}>{tr('Prototype — test data', 'Prototype — données de test')}</div>
          </div>
        </div>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          {tr('Client:', 'Client :')} <b>{props.name}</b> · {tr('Date:', 'Date :')} {dateOnly(new Date().toISOString())}
          <br />
          {tr('Wallet:', 'Wallet :')} <span style={{ fontFamily: 'monospace' }}>{safeAddress}</span>
        </p>
        <div style={{ marginTop: 24, padding: 20, border: '2px solid #303137', borderRadius: 12, fontFamily: 'monospace', fontSize: 22, lineHeight: 1.8, letterSpacing: 2 }}>{code}</div>
        <ol style={{ marginTop: 24, fontSize: 13, lineHeight: 1.7 }}>
          <li>{tr('This code is part ① of your backup key. On its own, it cannot do anything.', 'Ce code est la partie ① de votre clé de secours. Seul, il ne permet rien.')}</li>
          <li>{tr('Engrave it on a steel plate if you can. Keep it at home in a safe place or in a bank safe-deposit box, away from your phone and from your security key.', 'Gravez-le sur une plaque en acier si possible. Gardez-le chez vous en lieu sûr ou dans un coffre bancaire, loin de votre téléphone et de votre clé de sécurité.')}</li>
          <li>{tr('If you lose your device: My Wall → “I lost my device”, then enter this code.', "En cas de perte d'appareil : My Wall → « J'ai perdu mon appareil », puis saisissez ce code.")}</li>
          <li>{tr('Never share it, by phone or email, never store it in a cloud. Swissquote will never ask you for it.', 'Ne le communiquez jamais, ni par téléphone ni par email, ne le stockez jamais dans un cloud. Swissquote ne vous le demandera jamais.')}</li>
        </ol>
      </div>
    </>
  );
}

function Part2Card({
  safeAddress,
  share2,
  name,
  clientId,
  walletPassword,
  pwContext,
  persist,
  onShare2Done,
  done,
  onDone,
}: Parameters<typeof RecoveryKitSetup>[0] & { done: Share2Persist | null; onDone: (p: Share2Persist) => void }) {
  const [support, setSupport] = useState<PrfSupport>('unknown');
  const [mode, setMode] = useState<'key' | 'file'>('key');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bpw, setBpw] = useState('');
  const [bpw2, setBpw2] = useState('');
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    void prfSupport().then((s) => {
      setSupport(s);
      if (s === 'unsupported') setMode('file');
    });
  }, []);
  const short = safeAddress.slice(2, 8);
  const pwCheck = checkPassword(bpw, pwContext);
  const sameAsWallet = bpw.length > 0 && bpw.normalize('NFKC').trim().toLowerCase() === walletPassword.normalize('NFKC').trim().toLowerCase();

  const registerKey = async () => {
    if (!share2) return;
    setBusy(true);
    setErr('');
    try {
      const record = await protectShareWithSecurityKey({ safeAddress, share: share2, clientId, userName: name || clientId });
      await persist({ method: 'security-key', record });
      onShare2Done();
      onDone({ method: 'security-key', record });
    } catch (e: any) {
      if (e instanceof PrfUnsupportedError) {
        setSupport('unsupported');
        setMode('file');
      }
      setErr(e?.name === 'NotAllowedError' ? tr('The security key was not used (cancelled or timed out). Try again.', 'La clé de sécurité n’a pas été utilisée (annulé ou délai dépassé). Réessayez.') : e.message);
    } finally {
      setBusy(false);
    }
  };

  const makeFile = async () => {
    if (!share2) return;
    setBusy(true);
    setErr('');
    try {
      const file = await encryptShareOffline(safeAddress, share2, bpw, { walletPassword, onProgress: setProgress });
      downloadJson(`my-wall-offline-backup-${short}.json`, file);
      await persist({ method: 'offline-password' });
      onShare2Done();
      onDone({ method: 'offline-password' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setBpw('');
      setBpw2('');
    }
  };

  if (done)
    return (
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold" data-testid="part2-done">
          {done.method === 'security-key' ? <Usb size={18} strokeWidth={1.75} /> : <HardDrive size={18} strokeWidth={1.75} />} ②{' '}
          {done.method === 'security-key' ? tr('Physical security key', 'Clé de sécurité physique') : tr('Offline backup file', 'Fichier de sauvegarde hors ligne')}
        </h2>
        {done.method === 'security-key' ? (
          <>
            <Notice tone="ok" title={tr('Part ② is locked to your security key', 'La partie ② est verrouillée par votre clé de sécurité')}>
              {tr(
                'Swissquote keeps only the encrypted part: unreadable without your key, present and touched. Keep the key away from your phone and from the paper code.',
                'Swissquote ne garde que la partie chiffrée : illisible sans votre clé, présente et touchée. Rangez la clé loin de votre téléphone et du code papier.',
              )}
            </Notice>
            <Button variant="secondary" onClick={() => downloadJson(`my-wall-security-key-part-${short}.json`, done.record)}>
              <Download size={16} strokeWidth={1.75} /> {tr('Download an offline copy (encrypted)', 'Télécharger une copie hors ligne (chiffrée)')}
            </Button>
            <p className="text-[12px] text-sq-muted">{tr('Optional: lets you recover even if Swissquote is unavailable. It is useless without the security key. Keep it offline — never upload it to a cloud.', 'Facultatif : permet de récupérer même si Swissquote est indisponible. Inutile sans la clé de sécurité. Gardez-la hors ligne — ne la téléversez jamais dans un cloud.')}</p>
          </>
        ) : (
          <Notice tone="ok" title={tr('Offline backup file downloaded', 'Fichier de sauvegarde hors ligne téléchargé')}>
            {tr(`${OFFLINE_NOTICE}. Copy it to a USB stick, then delete it from this computer's Downloads folder. You need it together with your backup password.`, 'Gardez-le hors ligne — ne le téléversez jamais dans un cloud. Copiez-le sur une clé USB, puis supprimez-le du dossier Téléchargements. Il faut aussi votre mot de passe de sauvegarde.')}
          </Notice>
        )}
      </Card>
    );

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound size={18} strokeWidth={1.75} /> ② {tr('Physical security key', 'Clé de sécurité physique')}
      </h2>
      {mode === 'key' ? (
        <>
          <p className="text-[14px] text-sq-ink-2">
            {tr(
              'Insert a FIDO2 security key (e.g. YubiKey) — or use your other phone or tablet when the browser offers it. Part ② is encrypted with a secret that never leaves that key: nobody can open it remotely, and a phone thief does not have it.',
              'Insérez une clé de sécurité FIDO2 (ex. YubiKey) — ou utilisez votre autre téléphone ou tablette si le navigateur le propose. La partie ② est chiffrée avec un secret qui ne quitte jamais cette clé : personne ne peut l’ouvrir à distance, et un voleur de téléphone ne l’a pas.',
            )}
          </p>
          {support === 'unknown' && <p className="text-[12px] text-sq-muted">{tr('Your browser does not say whether it supports the “PRF” feature; we will check when you touch the key.', 'Votre navigateur n’indique pas s’il prend en charge la fonction « PRF » ; nous vérifierons quand vous toucherez la clé.')}</p>}
          {err && <Notice tone="bad">{err}</Notice>}
          <Button onClick={registerKey} disabled={busy || !share2}>
            {busy ? (
              <>
                <Spinner /> {tr('Touch your security key…', 'Touchez votre clé de sécurité…')}
              </>
            ) : (
              <>
                <Usb size={18} strokeWidth={1.75} /> {tr('Register my security key', 'Enregistrer ma clé de sécurité')}
              </>
            )}
          </Button>
          <button type="button" className="min-h-11 w-full text-[14px] font-medium text-sq-ink-2 underline" onClick={() => setMode('file')}>
            {tr('I don’t have a security key', 'Je n’ai pas de clé de sécurité')}
          </button>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pwCheck.ok && !sameAsWallet && bpw === bpw2) void makeFile();
          }}
        >
          {support === 'unsupported' && (
            <Notice tone="warn" title={tr('Security key not available here', 'Clé de sécurité indisponible ici')}>
              {tr('This browser cannot protect a secret with a security key (WebAuthn PRF). Use the offline file below, or come back with Chrome, Edge or Safari and a FIDO2 key.', 'Ce navigateur ne peut pas protéger un secret avec une clé de sécurité (WebAuthn PRF). Utilisez le fichier hors ligne ci-dessous, ou revenez avec Chrome, Edge ou Safari et une clé FIDO2.')}
            </Notice>
          )}
          <p className="text-[14px] text-sq-ink-2">
            {tr(
              'Part ② is saved as an encrypted file for a USB stick, protected by a backup password — different from your wallet password. Keep offline — never upload to a cloud.',
              'La partie ② est enregistrée dans un fichier chiffré pour une clé USB, protégé par un mot de passe de sauvegarde — différent de votre mot de passe du wallet. À garder hors ligne — ne jamais téléverser dans un cloud.',
            )}
          </p>
          <Field label={tr('Backup password', 'Mot de passe de sauvegarde')} error={sameAsWallet ? tr('It must be different from your wallet password.', 'Il doit être différent de votre mot de passe du wallet.') : bpw.length > 0 && !pwCheck.ok ? pwCheck.message : undefined}>
            <SecretInput value={bpw} onChange={setBpw} autoComplete="new-password" />
          </Field>
          <PasswordChecklist rules={pwCheck.rules} />
          <Field label={tr('Confirm the backup password', 'Confirmez le mot de passe de sauvegarde')} error={bpw2 && bpw2 !== bpw ? tr('The two passwords do not match.', 'Les deux mots de passe ne correspondent pas.') : undefined}>
            <SecretInput value={bpw2} onChange={setBpw2} autoComplete="new-password" />
          </Field>
          {busy && <p className="num text-[13px] text-sq-muted">{tr('Encrypting…', 'Chiffrement…')} {Math.round(progress * 100)} %</p>}
          {err && <Notice tone="bad">{err}</Notice>}
          <Button type="submit" disabled={busy || !share2 || !pwCheck.ok || sameAsWallet || bpw !== bpw2}>
            <Download size={16} strokeWidth={1.75} /> {tr('Encrypt and download the offline file', 'Chiffrer et télécharger le fichier hors ligne')}
          </Button>
          {support !== 'unsupported' && (
            <button type="button" className="min-h-11 w-full text-[14px] font-medium text-sq-ink-2 underline" onClick={() => setMode('key')}>
              {tr('Use a security key instead (recommended)', 'Utiliser plutôt une clé de sécurité (recommandé)')}
            </button>
          )}
        </form>
      )}
    </Card>
  );
}
