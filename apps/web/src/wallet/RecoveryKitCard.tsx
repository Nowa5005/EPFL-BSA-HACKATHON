// Security → Recovery kit: status of the client's parts, and "Replace my recovery kit" (for wallets created before
// N2, "Replace cloud backup"). The replacement creates a NEW recovery key K3′ on this device, splits it (new paper
// code, new security-key part, new partner share) and swaps K3 → K3′ ON-CHAIN with device key + Swissquote.
// Every old part (paper code, former cloud backup file, old partner share) then rebuilds a key that owns nothing.

import { useEffect, useRef, useState } from 'react';
import { HardDrive, KeyRound, RefreshCw, Usb } from 'lucide-react';
import { Wallet, sha256, type HDNodeWallet } from 'ethers';
import { CONTACT_SHARE_ORDER, encodeRecoveryCode, invitationLink, sealInvitation, sealWithPassword, signSafeTx, splitRecoveryKey } from '@sq/shared';
import { cosigner, partner } from '../lib/api';
import { decryptDeviceKey, getDevice, passkeyAssertion, saveDevice } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { privacyLock } from '../lib/privacy';
import { tr } from '../lib/i18n';
import { Button, Card, CopyButton, dateOnly, Field, Notice, SecretInput, Spinner, TxLink, Why } from '../components/ui';
import { RecoveryKitSetup, type Share2Persist } from '../components/RecoveryKitSetup';

type Kit = { share2: null | { method: 'security-key' | 'offline-password'; storedAt: string } };
type Phase = 'idle' | 'auth' | 'kit' | 'confirming' | 'done';

/**
 * `contactName` (#14, from Security → Trusted contact): same replacement, but the new recovery key K3′ is split
 * 2-of-4 — ① paper · ② security key · ③ partner · ④ trusted contact — and the contact's part leaves this device only
 * encrypted for the invitation link (its key sits in the link's #fragment, never sent to Swissquote).
 */
export function RecoveryKitCard({ contactName, onFinished }: { contactName?: string; onFinished?: () => void } = {}) {
  const { device, session } = useLocal();
  const clientId = session!.clientId;
  const safeAddress = device!.safeAddress!;
  const [kit, setKit] = useState<Kit | null>(null);
  const [phase, setPhase] = useState<Phase>(contactName ? 'auth' : 'idle');
  const [inviteLink, setInviteLink] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [txHash, setTxHash] = useState('');
  const [partnerOk, setPartnerOk] = useState(true);
  // Secrets: memory only, dropped when the flow ends.
  const secrets = useRef<{ k1?: Wallet | HDNodeWallet; walletPw?: string; k3?: string; paper?: string; key?: string | null; partner?: string; contact?: string; part2?: Share2Persist; share2Commitment?: string } | null>(null);
  const load = () => cosigner.get(`/clients/${clientId}/recovery-kit`).then(setKit).catch(() => setKit({ share2: null }));
  useEffect(() => {
    void load();
    return () => {
      secrets.current = null;
    };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Writing the new code down by hand takes longer than the inactivity lock (N1): while this authenticated flow is
  // on screen, it counts as activity. Leaving the app (hidden / background / sleep) still locks immediately.
  useEffect(() => {
    if (phase !== 'kit' && phase !== 'confirming') return;
    privacyLock.activity();
    const t = setInterval(() => privacyLock.activity(), 5_000);
    return () => clearInterval(t);
  }, [phase]);

  const legacy = kit !== null && !kit.share2;
  const profile = session?.profile ?? {};
  const [first, ...rest] = String(profile.name ?? '').split(' ');

  const start = async () => {
    setBusy(true);
    setErr('');
    try {
      const k1 = await decryptDeviceKey(pw).catch(() => {
        throw new Error(tr('Incorrect password.', 'Mot de passe incorrect.'));
      });
      const k3 = Wallet.createRandom();
      const shares: Record<string, string> = contactName ? await splitRecoveryKey(k3.privateKey, CONTACT_SHARE_ORDER) : await splitRecoveryKey(k3.privateKey);
      secrets.current = { k1, walletPw: pw, k3: k3.address, paper: shares.paper, key: shares.key, partner: shares.partner, contact: shares.contact, share2Commitment: sha256(shares.key) };
      setCode(encodeRecoveryCode(shares.paper));
      setPhase('kit');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setPw('');
    }
  };

  const confirm = async () => {
    const s = secrets.current;
    if (!s?.k1 || !s.k3 || !s.paper || !s.partner || !s.part2) return;
    setBusy(true);
    setErr('');
    setPhase('confirming');
    try {
      // 1. The partner prepares the new share ③ (inactive until the on-chain swap is done).
      const st = await partner.post(`/shares/${clientId}/stage`, { share: s.partner, paperCommitment: sha256(s.paper), share2Commitment: s.share2Commitment, ...(s.contact ? { contactCommitment: sha256(s.contact) } : {}) });
      // #14: the contact's part, encrypted for the invitation link (valid only once K3′ is on-chain).
      let invite: { token: string; inviteKey: string } | null = null;
      if (contactName && s.contact) {
        const sealed = await sealInvitation(safeAddress, s.contact);
        const r = await cosigner.post(`/clients/${clientId}/trusted-contact/invitation`, { name: contactName, recoveryAddress: s.k3, iv: sealed.iv, ciphertext: sealed.ciphertext });
        invite = { token: r.token, inviteKey: sealed.inviteKey };
      }
      // 2. swapOwner(K3 → K3′): exact transaction from the co-signer, signed by the device key + passkey.
      const prep = await cosigner.post(`/clients/${clientId}/recovery-kit/rotation/prepare`, { newRecoveryAddress: s.k3 });
      const signatureK1 = await signSafeTx(s.k1, safeAddress, prep.safeTx);
      const webauthn = prep.authOptions ? await passkeyAssertion(prep.authOptions) : undefined;
      const r = await cosigner.post(`/clients/${clientId}/recovery-kit/rotation/submit`, { signatureK1, webauthn, share2: s.part2, partnerStageId: st.stageId });
      // 3. The device keeps its sealed copy of the NEW paper code.
      const d = getDevice();
      if (d) saveDevice({ ...d, paperShareEnc: await sealWithPassword(safeAddress, s.paper, s.walletPw!) });
      setTxHash(r.txHash);
      setPartnerOk(!!r.partnerCommitted);
      if (invite) {
        await cosigner.post(`/clients/${clientId}/trusted-contact/sent`).catch(() => undefined);
        setInviteLink(invitationLink(window.location.origin, invite.token, invite.inviteKey));
      }
      secrets.current = null;
      setCode('');
      setPhase('done');
      void load();
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? tr('Touch ID was cancelled. Nothing was changed.', 'Touch ID a été annulé. Rien n’a été modifié.') : e.message);
      setPhase('kit');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    secrets.current = null;
    setCode('');
    setErr('');
    setPhase('idle');
    onFinished?.();
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound size={20} strokeWidth={1.75} />
        <h2 className="text-[17px] font-semibold">{contactName ? tr(`Add ${contactName} as trusted contact`, `Ajouter ${contactName} comme contact de confiance`) : tr('Recovery kit', 'Kit de récupération')}</h2>
      </div>
      <p className="text-[13px] text-sq-muted">
        {tr(
          'Your backup key is split in 3 parts — ① paper code, ② physical security key, ③ independent partner. Any 2 restore your access. Nothing is stored in a cloud.',
          'Votre clé de secours est découpée en 3 parties — ① code papier, ② clé de sécurité physique, ③ partenaire indépendant. 2 parties suffisent pour retrouver l’accès. Rien n’est stocké dans un cloud.',
        )}
      </p>
      {kit === null ? (
        <Spinner className="text-sq-muted" />
      ) : kit.share2 ? (
        <p className="flex items-center gap-2 text-[14px]">
          {kit.share2.method === 'security-key' ? <Usb size={16} strokeWidth={1.75} /> : <HardDrive size={16} strokeWidth={1.75} />}
          {kit.share2.method === 'security-key' ? tr('Part ②: physical security key', 'Partie ② : clé de sécurité physique') : tr('Part ②: offline encrypted file', 'Partie ② : fichier chiffré hors ligne')}
          <span className="text-sq-muted">· {dateOnly(kit.share2.storedAt)}</span>
        </p>
      ) : (
        <Notice tone="warn" title={tr('Part ② is a former cloud backup', 'La partie ② est une ancienne sauvegarde cloud')}>
          {tr(
            'This wallet was created with a cloud backup file, which could be reached from a stolen phone. Replace it with a physical security key: the old file and the old paper code will become useless.',
            'Ce wallet a été créé avec un fichier de sauvegarde cloud, accessible depuis un téléphone volé. Remplacez-le par une clé de sécurité physique : l’ancien fichier et l’ancien code papier deviendront inutiles.',
          )}
        </Notice>
      )}

      {phase === 'idle' && (
        <Button variant={legacy ? 'primary' : 'secondary'} onClick={() => setPhase('auth')} disabled={kit === null}>
          <RefreshCw size={16} strokeWidth={1.75} /> {legacy ? tr('Replace cloud backup', 'Remplacer la sauvegarde cloud') : tr('Replace my recovery kit', 'Remplacer mon kit de récupération')}
        </Button>
      )}

      {phase === 'auth' && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw) void start();
          }}
        >
          {contactName && (
            <Why>
              {tr(
                `Your backup key will be split in 4 parts — ① paper code, ② security key, ③ partner, ④ ${contactName} — any 2 restore your access, so the partner and ${contactName} together can help you if you lose both your paper code and your security key. Neither of them alone can do anything.`,
                `Votre clé de secours sera découpée en 4 parties — ① code papier, ② clé de sécurité, ③ partenaire, ④ ${contactName} — 2 parties suffisent : le partenaire et ${contactName} ensemble pourront vous aider si vous perdez votre code papier et votre clé de sécurité. Aucun des deux ne peut rien faire seul.`,
              )}
            </Why>
          )}
          <Why>
            {tr(
              'A NEW backup key is created on this device and split again; the old one is then replaced on the blockchain (device key + Swissquote, with Touch ID). Every old part — paper code, backup file, partner share — becomes useless. Have your security key and something to write the new code with.',
              'Une NOUVELLE clé de secours est créée sur cet appareil et redécoupée ; l’ancienne est ensuite remplacée sur la blockchain (clé de l’appareil + Swissquote, avec Touch ID). Chaque ancienne partie — code papier, fichier de sauvegarde, part du partenaire — devient inutile. Préparez votre clé de sécurité et de quoi noter le nouveau code.',
            )}
          </Why>
          <Field label={tr('Wallet password', 'Mot de passe du wallet')} error={err || undefined}>
            <SecretInput autoFocus value={pw} onChange={setPw} autoComplete="current-password" />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={cancel}>
              {tr('Cancel', 'Annuler')}
            </Button>
            <Button type="submit" disabled={!pw || busy}>
              {busy ? <Spinner /> : tr('Continue', 'Continuer')}
            </Button>
          </div>
        </form>
      )}

      {(phase === 'kit' || phase === 'confirming') && secrets.current && (
        <div className="space-y-4">
          <Notice tone="info" title={tr('Your NEW recovery kit', 'Votre NOUVEAU kit de récupération')}>
            {tr('Nothing changes until you confirm at the bottom. Keep the old kit until then.', 'Rien ne change avant votre confirmation en bas. Gardez l’ancien kit jusque-là.')}
          </Notice>
          <RecoveryKitSetup
            safeAddress={safeAddress}
            code={code}
            share2={secrets.current.key ?? null}
            name={String(profile.name ?? clientId)}
            clientId={clientId}
            walletPassword={secrets.current.walletPw ?? ''}
            pwContext={{ firstName: profile.firstName ?? first, lastName: profile.lastName ?? rest.join(' '), birthDate: profile.birthDate }}
            persist={async (p) => {
              if (secrets.current) secrets.current.part2 = p; // sent with the on-chain confirmation
            }}
            onShare2Done={() => {
              if (secrets.current) secrets.current.key = null;
            }}
            footer={(ready) => (
              <>
                {err && <Notice tone="bad">{err}</Notice>}
                <Button disabled={!ready || busy} onClick={confirm}>
                  {busy ? <Spinner /> : tr('Confirm the replacement (Touch ID)', 'Confirmer le remplacement (Touch ID)')}
                </Button>
                <Button variant="ghost" onClick={cancel} disabled={busy}>
                  {tr('Cancel — keep my current kit', 'Annuler — garder mon kit actuel')}
                </Button>
              </>
            )}
          />
        </div>
      )}

      {phase === 'done' && (
        <Notice tone="ok" title={tr('Recovery kit replaced', 'Kit de récupération remplacé')}>
          {tr(
            'The new recovery key is on the blockchain. Destroy the old paper code and delete any old backup file: they no longer open anything.',
            'La nouvelle clé de secours est sur la blockchain. Détruisez l’ancien code papier et supprimez tout ancien fichier de sauvegarde : ils n’ouvrent plus rien.',
          )}{' '}
          <TxLink hash={txHash} />
          {inviteLink && (
            <div className="mt-3 space-y-2" data-testid="trusted-invite">
              <div className="font-medium">{tr(`Invitation for ${contactName}`, `Invitation pour ${contactName}`)}</div>
              <p>
                {tr(
                  `Send this link to ${contactName} yourself (in this prototype no e-mail is sent). It works once and expires in 7 days. The secret part of the link (after #) never reaches Swissquote: ${contactName} will protect their part with their own passkey or a passphrase.`,
                  `Envoyez vous-même ce lien à ${contactName} (ce prototype n’envoie aucun e-mail). Il ne sert qu’une fois et expire dans 7 jours. La partie secrète du lien (après #) n’atteint jamais Swissquote : ${contactName} protégera sa partie avec sa propre passkey ou une phrase secrète.`,
                )}
              </p>
              <code className="block break-all rounded-[10px] bg-sq-bg p-2 font-mono text-[12px]" data-testid="trusted-invite-link">
                {inviteLink}
              </code>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={inviteLink} sensitive />
                <a href={inviteLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-[14px] font-medium underline">
                  {tr('Open as the contact (demo)', 'Ouvrir comme le contact (démo)')}
                </a>
              </div>
            </div>
          )}
          {!partnerOk && (
            <div className="mt-2">
              {tr('The recovery partner could not be reached yet: ', 'Le partenaire de récupération n’a pas encore pu être joint : ')}
              <button type="button" className="underline" onClick={() => cosigner.post(`/clients/${clientId}/recovery-kit/partner-commit`).then((r) => setPartnerOk(!!r.partnerCommitted))}>
                {tr('retry', 'réessayer')}
              </button>
            </div>
          )}
        </Notice>
      )}
    </Card>
  );
}
