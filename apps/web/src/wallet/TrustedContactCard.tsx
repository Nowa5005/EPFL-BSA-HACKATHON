// #14 — Security → "Trusted contact": a person the client trusts receives a 4th part of the recovery key
// (2-of-4: ① paper · ② security key · ③ partner · ④ contact). Adding one replaces the recovery kit (new key K3′
// rotated on-chain, so every old part is retired) — see RecoveryKitCard with `contactName`.

import { useEffect, useState } from 'react';
import { UserRoundCheck } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { Button, Card, dateOnly, Field, inputCls, Notice, Spinner, Why } from '../components/ui';
import { RecoveryKitCard } from './RecoveryKitCard';

type Contact = { status: 'none' | 'invited' | 'accepted' | 'outdated'; name?: string; createdAt?: string; acceptedAt?: string | null; method?: 'security-key' | 'offline-password' | null; inviteExpiresAt?: string | null };

export function TrustedContactCard() {
  const { session } = useLocal();
  const clientId = session!.clientId;
  const [ct, setCt] = useState<Contact | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => cosigner.get<Contact>(`/clients/${clientId}/trusted-contact`).then(setCt).catch(() => setCt({ status: 'none' }));
  useEffect(() => {
    void load();
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    if (!confirm(tr('Remove your trusted contact? Their part stays valid until you replace your recovery kit.', 'Retirer votre contact de confiance ? Sa partie reste valable jusqu’au remplacement de votre kit de récupération.'))) return;
    setBusy(true);
    setErr('');
    try {
      await cosigner.post(`/clients/${clientId}/trusted-contact/remove`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (adding)
    return (
      <div className="space-y-2">
        <RecoveryKitCard
          contactName={adding}
          onFinished={() => {
            setAdding(null);
            void load();
          }}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setAdding(null);
            void load();
          }}
        >
          {tr('Close', 'Fermer')}
        </Button>
      </div>
    );

  return (
    <Card className="space-y-3" id="trusted-contact">
      <div className="flex items-center gap-2">
        <UserRoundCheck size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Trusted contact', 'Contact de confiance')}</h2>
      </div>
      <p className="text-[13px] text-sq-muted">
        {tr(
          'Optional. A person you trust (family member, friend) keeps a 4th part of your backup key. If you lose your device, your paper code AND your security key, the recovery partner and your trusted contact together can still restore your access. On their own, neither can do anything.',
          'Facultatif. Une personne de confiance (proche, ami) garde une 4e partie de votre clé de secours. Si vous perdez votre appareil, votre code papier ET votre clé de sécurité, le partenaire de récupération et votre contact de confiance ensemble peuvent encore rétablir votre accès. Seul, aucun des deux ne peut rien faire.',
        )}
      </p>
      {ct === null ? (
        <Spinner className="text-sq-muted" />
      ) : ct.status === 'none' || ct.status === 'outdated' ? (
        <>
          {ct.status === 'outdated' && (
            <Notice tone="warn" title={tr(`${ct.name}’s part is no longer valid`, `La partie de ${ct.name} n’est plus valable`)}>
              {tr('Your recovery kit was replaced since: add your trusted contact again.', 'Votre kit de récupération a été remplacé depuis : ajoutez à nouveau votre contact de confiance.')}
            </Notice>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) setAdding(name.trim());
            }}
          >
            <Field label={tr('Name of your trusted contact', 'Nom de votre contact de confiance')}>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoComplete="off" />
            </Field>
            <Why>
              {tr(
                'Adding a contact replaces your recovery kit: a new backup key is created and split in 4, then swapped on the blockchain (Touch ID). You will get a new paper code and protect part ② again; your old parts become useless. Then you send the invitation link to your contact.',
                'Ajouter un contact remplace votre kit de récupération : une nouvelle clé de secours est créée et découpée en 4, puis remplacée sur la blockchain (Touch ID). Vous recevrez un nouveau code papier et protégerez à nouveau la partie ② ; vos anciennes parties deviennent inutiles. Ensuite, vous envoyez le lien d’invitation à votre contact.',
              )}
            </Why>
            <Button type="submit" variant="secondary" disabled={name.trim().length < 2}>
              {tr('Add a trusted contact', 'Ajouter un contact de confiance')}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-[14px]" data-testid="trusted-contact-status">
            <b>{ct.name}</b> —{' '}
            {ct.status === 'accepted'
              ? tr(`protected their part ${ct.method === 'security-key' ? 'with their passkey' : 'in an offline file'} (${dateOnly(ct.acceptedAt!)})`, `a protégé sa partie ${ct.method === 'security-key' ? 'avec sa passkey' : 'dans un fichier hors ligne'} (${dateOnly(ct.acceptedAt!)})`)
              : tr(`invitation sent, not accepted yet (expires ${dateOnly(ct.inviteExpiresAt ?? ct.createdAt!)})`, `invitation envoyée, pas encore acceptée (expire le ${dateOnly(ct.inviteExpiresAt ?? ct.createdAt!)})`)}
          </p>
          <p className="text-[12px] text-sq-muted">
            {tr(
              'To help you, your contact opens their link again: their passkey (or passphrase file) shows a code they read to you, which you type in “I lost my device”.',
              'Pour vous aider, votre contact rouvre son lien : sa passkey (ou son fichier protégé) affiche un code qu’il vous lit, et que vous saisissez dans « J’ai perdu mon appareil ».',
            )}
          </p>
          <Button variant="ghost" onClick={remove} disabled={busy}>
            {tr('Remove this trusted contact', 'Retirer ce contact de confiance')}
          </Button>
        </>
      )}
      {err && <Notice tone="bad">{err}</Notice>}
    </Card>
  );
}
