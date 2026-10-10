// Keys & security: three different things, three different exposures.
//  · public wallet address — always visible
//  · this device's private key (K1) — secret, revealed 30 s after re-authentication
//  · recovery code (share ①) — partial secret (1 of 3 parts), revealed 30 s after re-authentication
// Secrets live only in component state: never in history, notifications, console, activity log or clear storage.

import { useEffect, useState, type ReactNode } from 'react';
import { Download, Eye, EyeOff, FileCheck2, KeyRound, Fingerprint, Trash2, Upload, Wallet as WalletIcon } from 'lucide-react';
import { Wallet, getAddress, sha256, toUtf8Bytes } from 'ethers';
import { encodeRecoveryCode } from '@sq/shared';
import { getDevice, reauthenticate, revealPaperCode, saveDevice } from '../lib/device';
import { checkPassword } from '../lib/passwordPolicy';
import { useLocal } from '../lib/hooks';
import { Button, Card, CopyButton, cx, Field, MockBadge, Notice, SecretInput, Spinner, Why } from '../components/ui';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { BackupCodeCard, FreezeCard } from './SecurityExtras';
import { CosignerDecisions, YourGuarantees } from '../components/Refusal';
import { tr } from '../lib/i18n';

const REVEAL_SEC = 30;
type Secret = { kind: 'k1' | 'code'; value: string; until: number };

export default function Security() {
  const { device, session } = useLocal();
  const [secret, setSecret] = useState<Secret | null>(null);
  const [asking, setAsking] = useState<'k1' | 'code' | null>(null);

  // Auto re-mask: on expiry, when leaving the page (unmount) and when the app goes to the background.
  useEffect(() => {
    if (!secret) return;
    const t = setTimeout(() => setSecret(null), secret.until - Date.now());
    const onVis = () => document.visibilityState === 'hidden' && setSecret(null);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [secret]);
  useEffect(() => () => setSecret(null), []);

  const onAuthed = async (w: Wallet | { privateKey: string }, password: string) => {
    if (asking === 'k1') setSecret({ kind: 'k1', value: w.privateKey, until: Date.now() + REVEAL_SEC * 1000 });
    if (asking === 'code') {
      const share = await revealPaperCode(password);
      setSecret(share ? { kind: 'code', value: encodeRecoveryCode(share), until: Date.now() + REVEAL_SEC * 1000 } : null);
      if (!share) alert(tr('The recovery code is no longer stored on this device.', "Le code de récupération n'est plus conservé sur cet appareil."));
    }
    setAsking(null);
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{tr('Keys & security', 'Clés et sécurité')}</h1>
        <p className="mt-1 text-[14px] text-sq-muted">{tr('Your wallet doesn’t use a seed phrase: security relies on 3 keys, 2 of which are required.', "Votre wallet n'utilise pas de phrase secrète : la sécurité repose sur 3 clés, dont 2 sont nécessaires.")}</p>
      </div>

      <YourGuarantees />

      <FreezeCard clientId={session!.clientId} />

      <Card className="space-y-2">
        <SectionHead icon={<WalletIcon size={20} strokeWidth={1.75} />} title={tr('Public wallet address', 'Adresse publique du wallet')} tag={tr('Public', 'Publique')} />
        <p className="text-[13px] text-sq-muted">{tr('Used to receive funds. Sharing it is safe.', 'Sert à recevoir des fonds. La partager ne présente aucun risque.')}</p>
        <code className="block break-all rounded-[10px] bg-sq-bg p-3 font-mono text-[13px]">{device!.safeAddress}</code>
        <CopyButton value={device!.safeAddress!} />
      </Card>

      <SecretCard
        icon={<KeyRound size={20} strokeWidth={1.75} />}
        title={tr('This device’s private key', 'Clé privée de cet appareil')}
        tag="Secret"
        desc={tr('Lets you sign from this device (always together with Swissquote’s co-signing). Never share it.', 'Permet de signer depuis cet appareil (toujours avec la co-signature de Swissquote). Ne la communiquez jamais.')}
        extra={<p className="text-[12px] font-medium text-sq-warn">{tr('Testnet — no real value.', 'Réseau de test — aucune valeur réelle.')}</p>}
        secret={secret?.kind === 'k1' ? secret : null}
        onReveal={() => setAsking('k1')}
        onHide={() => setSecret(null)}
      />

      <SecretCard
        icon={<FileCheck2 size={20} strokeWidth={1.75} />}
        title={tr('Recovery code', 'Code de récupération')}
        tag={tr('Partial secret', 'Secret partiel')}
        desc={tr('Part ① of 3 of your backup key. On its own it can do nothing; combined with another part, it restores your access.', 'Partie ① sur 3 de votre clé de secours. Seul, il ne permet rien ; avec une autre partie, il restaure votre accès.')}
        secret={secret?.kind === 'code' ? secret : null}
        onReveal={() => setAsking('code')}
        onHide={() => setSecret(null)}
        unavailable={!device?.paperShareEnc}
        extra={
          device?.paperShareEnc ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-1.5 text-[13px] text-sq-down"
              onClick={() => {
                if (!confirm(tr('Delete the recovery code from this device? Make sure you have printed it.', 'Supprimer le code de récupération de cet appareil ? Assurez-vous de l’avoir imprimé.'))) return;
                const d = getDevice()!;
                saveDevice({ ...d, paperShareEnc: undefined });
                setSecret(null);
              }}
            >
              <Trash2 size={15} strokeWidth={1.75} /> {tr('Stop storing this code on this device', 'Ne plus conserver ce code sur cet appareil')}
            </button>
          ) : null
        }
      />

      {asking && <Reauth clientId={session!.clientId} onCancel={() => setAsking(null)} onDone={onAuthed} />}

      <BackupCodeCard clientId={session!.clientId} />

      <CosignerDecisions clientId={session!.clientId} />

      <BackupCard />
    </div>
  );
}

function SectionHead({ icon, title, tag }: { icon: ReactNode; title: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sq-ink-2">{icon}</span>
      <h2 className="flex-1 text-[16px] font-semibold">{title}</h2>
      <span className={cx('rounded-[4px] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide', tag === tr('Public', 'Publique') ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-bad-50 text-sq-down')}>{tag}</span>
    </div>
  );
}

function SecretCard({ icon, title, tag, desc, extra, secret, onReveal, onHide, unavailable }: { icon: ReactNode; title: string; tag: string; desc: string; extra?: ReactNode; secret: Secret | null; onReveal: () => void; onHide: () => void; unavailable?: boolean }) {
  const [left, setLeft] = useState(REVEAL_SEC);
  useEffect(() => {
    if (!secret) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((secret.until - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [secret]);
  return (
    <Card className="space-y-3">
      <SectionHead icon={icon} title={title} tag={tag} />
      <p className="text-[13px] text-sq-muted">{desc}</p>
      {secret ? (
        <div className="space-y-2">
          <code className="block select-all break-all rounded-[10px] border border-sq-line bg-white p-3 font-mono text-[14px] leading-relaxed">{secret.value}</code>
          <div className="h-1 overflow-hidden rounded-full bg-sq-line" aria-hidden>
            <div className="mw-countdown h-full bg-sq-orange" style={{ animationDuration: `${REVEAL_SEC}s` }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[13px] text-sq-muted" aria-live="polite">
              {tr(`Hidden automatically in ${left} s`, `Masquage automatique dans ${left} s`)}
            </span>
            <div className="flex-1" />
            <CopyButton value={secret.value} sensitive />
            <Button variant="secondary" className="min-h-10 w-auto px-3 text-[14px]" onClick={onHide}>
              <EyeOff size={16} strokeWidth={1.75} /> {tr('Hide now', 'Masquer maintenant')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <code className="flex-1 rounded-[10px] bg-sq-bg p-3 font-mono text-[14px] tracking-widest text-sq-muted" aria-label={tr('Hidden', 'Masqué')}>
            •••• •••• •••• •••• ••••
          </code>
          <Button variant="secondary" className="w-auto px-4" onClick={onReveal} disabled={unavailable}>
            <Eye size={18} strokeWidth={1.75} /> {tr('Show temporarily', 'Afficher temporairement')}
          </Button>
        </div>
      )}
      {unavailable && <p className="text-[12px] text-sq-muted">{tr('This code is no longer stored on this device (only your paper kit has it).', "Ce code n'est plus conservé sur cet appareil (seul votre kit papier le contient).")}</p>}
      {extra}
    </Card>
  );
}

function Reauth({ clientId, onCancel, onDone }: { clientId: string; onCancel: () => void; onDone: (w: any, password: string) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const w = await reauthenticate(pw, clientId);
      await onDone(w, pw);
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? tr('Touch ID cancelled.', 'Touch ID annulé.') : e.message);
    } finally {
      setBusy(false);
      setPw('');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
      <form
        className="mw-toast w-full max-w-sm space-y-4 rounded-[12px] bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) void go();
        }}
      >
        <h2 id="reauth-title" className="text-[18px] font-semibold">
          {tr('Confirm it’s really you', "Confirmez que c'est bien vous")}
        </h2>
        <Why>{tr('To show a secret, we ask for your password again, then Touch ID. It stays visible for 30 seconds.', 'Pour afficher un secret, nous redemandons votre mot de passe puis Touch ID. Il restera visible 30 secondes.')}</Why>
        <Field label={tr('Wallet password', 'Mot de passe du wallet')} error={err || undefined}>
          <SecretInput autoFocus value={pw} onChange={setPw} autoComplete="current-password" />
        </Field>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {tr('Cancel', 'Annuler')}
          </Button>
          <Button type="submit" disabled={!pw || busy}>
            {busy ? <Spinner /> : (
              <>
                <Fingerprint size={18} strokeWidth={1.75} /> {tr('Confirm', 'Confirmer')}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Encrypted backup of the device key (ethers keystore v3: scrypt + AES-128-CTR + MAC) ──
interface BackupFile {
  format: 'my-wall-device-key-backup';
  version: 1;
  safeAddress: string;
  address: string;
  createdAt: string;
  /** SHA-256 of `keystore` to detect a corrupted / altered file before trying the password. */
  sha256: string;
  keystore: string;
}

function BackupCard() {
  const { session } = useLocal();
  const name = session?.profile?.name?.split(' ') ?? [];
  const ctx = { firstName: name[0], lastName: name.slice(1).join(' '), birthDate: session?.profile?.birthDate };
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [progress, setProgress] = useState(0);
  const [exportMsg, setExportMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [ipw, setIpw] = useState('');
  const [importMsg, setImportMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const check = checkPassword(pw, ctx);

  const doExport = async (w: Wallet) => {
    setBusy('export');
    setExportMsg(null);
    try {
      const d = getDevice()!;
      const keystore = await w.encrypt(pw, (p) => setProgress(p));
      const body: BackupFile = { format: 'my-wall-device-key-backup', version: 1, safeAddress: d.safeAddress!, address: w.address, createdAt: new Date().toISOString(), sha256: sha256(toUtf8Bytes(keystore)), keystore };
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `my-wall-device-key-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setExportMsg({ tone: 'ok', text: tr('Encrypted backup downloaded. No secret in plain text in the file.', 'Sauvegarde chiffrée téléchargée. Aucun secret en clair dans le fichier.') });
      setPw('');
      setPw2('');
    } catch (e: any) {
      setExportMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!file) return;
    setBusy('import');
    setImportMsg(null);
    try {
      let b: BackupFile;
      try {
        b = JSON.parse(await file.text());
      } catch {
        throw new Error(tr('Unreadable file: this is not a My Wall backup.', "Fichier illisible : ce n'est pas une sauvegarde My Wall."));
      }
      if (b.format !== 'my-wall-device-key-backup' || typeof b.keystore !== 'string') throw new Error(tr('This file is not a My Wall backup.', "Ce fichier n'est pas une sauvegarde My Wall."));
      if (sha256(toUtf8Bytes(b.keystore)) !== b.sha256) throw new Error(tr('File altered or corrupted: its content has been modified. Use another copy of the backup.', 'Fichier altéré ou corrompu : son contenu a été modifié. Utilisez une autre copie de la sauvegarde.'));
      let w: Wallet | import('ethers').HDNodeWallet;
      try {
        w = await Wallet.fromEncryptedJson(b.keystore, ipw, (p) => setProgress(p));
      } catch {
        throw new Error(tr('Incorrect backup password.', 'Mot de passe de sauvegarde incorrect.'));
      }
      const d = getDevice()!;
      if (getAddress(w.address) !== getAddress(d.deviceAddress) || getAddress(b.safeAddress) !== getAddress(d.safeAddress!))
        throw new Error(tr(`Valid backup, but from another wallet or another device (address ${w.address.slice(0, 6)}…${w.address.slice(-4)}).`, `Sauvegarde valide, mais d'un autre wallet ou d'un autre appareil (adresse ${w.address.slice(0, 6)}…${w.address.slice(-4)}).`));
      setImportMsg({ tone: 'ok', text: tr(`Valid backup: it matches this device’s key (address ${w.address.slice(0, 6)}…${w.address.slice(-4)}).`, `Sauvegarde valide : elle correspond à la clé de cet appareil (adresse ${w.address.slice(0, 6)}…${w.address.slice(-4)}).`) });
    } catch (e: any) {
      setImportMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
      setIpw('');
    }
  };

  return (
    <Card className="space-y-4">
      <SectionHead icon={<Download size={20} strokeWidth={1.75} />} title={tr('Encrypted backup of the device key', "Sauvegarde chiffrée de la clé de l'appareil")} tag={tr('Encrypted', 'Chiffrée')} />
      <p className="text-[13px] text-sq-muted">
        {tr('JSON keystore v3 format (ethers: scrypt + AES-128-CTR + MAC). Useful for the exit door if Swissquote ever disappeared. Backups stay here, never in Swaplet.', 'Format keystore JSON v3 (ethers : scrypt + AES-128-CTR + MAC). Utile pour la porte de sortie si Swissquote disparaissait. Les sauvegardes restent ici, jamais dans Swaplet.')}
      </p>
      <Notice tone="warn">{tr('If you lose this password, the backup cannot be decrypted.', 'Si vous perdez ce mot de passe, la sauvegarde ne pourra pas être déchiffrée.')}</Notice>
      <Field label={tr('Backup password', 'Mot de passe de sauvegarde')} error={pw && !check.ok ? check.message : undefined}>
        <SecretInput value={pw} onChange={setPw} />
      </Field>
      <PasswordChecklist rules={check.rules} />
      <Field label={tr('Confirm the password', 'Confirmer le mot de passe')} error={pw2 && pw2 !== pw ? tr('The passwords don’t match.', 'Les mots de passe ne correspondent pas.') : undefined}>
        <SecretInput value={pw2} onChange={setPw2} />
      </Field>
      {busy === 'export' && <p className="num text-[13px] text-sq-muted">{tr('Encrypting…', 'Chiffrement…')} {Math.round(progress * 100)} %</p>}
      <Button onClick={() => setNeedReauth(true)} disabled={!check.ok || pw !== pw2 || !!busy}>
        <Download size={18} strokeWidth={1.75} /> {tr('Download an encrypted backup', 'Télécharger une sauvegarde chiffrée')}
      </Button>
      {exportMsg && <Notice tone={exportMsg.tone}>{exportMsg.text}</Notice>}
      {needReauth && (
        <Reauth
          clientId={session!.clientId}
          onCancel={() => setNeedReauth(false)}
          onDone={async (w) => {
            setNeedReauth(false);
            await doExport(w);
          }}
        />
      )}

      <div className="border-t border-sq-line pt-4">
        <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
          <Upload size={18} strokeWidth={1.75} /> {tr('Verify a backup', 'Vérifier une sauvegarde')}
        </h3>
        <div className="space-y-3">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-sq-line px-4 text-[14px] hover:bg-sq-bg/60">
            <Upload size={18} strokeWidth={1.75} className="text-sq-ink-2" />
            <span className="min-w-0 flex-1 truncate">{file ? file.name : tr('Choose a backup file (.json)', 'Choisir un fichier de sauvegarde (.json)')}</span>
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Field label={tr('Backup password', 'Mot de passe de la sauvegarde')}>
            <SecretInput value={ipw} onChange={setIpw} autoComplete="off" />
          </Field>
          {busy === 'import' && <p className="num text-[13px] text-sq-muted">{tr('Decrypting…', 'Déchiffrement…')} {Math.round(progress * 100)} %</p>}
          <Button variant="secondary" onClick={doImport} disabled={!file || !ipw || !!busy}>
            {tr('Decrypt and verify', 'Déchiffrer et vérifier')}
          </Button>
          {importMsg && <Notice tone={importMsg.tone}>{importMsg.text}</Notice>}
        </div>
      </div>
      <p className="text-[12px] text-sq-muted">
        {tr('Demo: the key is a real Sepolia testnet key', 'Démo : la clé est une vraie clé du réseau de test Sepolia')} <MockBadge label="Testnet" />
      </p>
    </Card>
  );
}
