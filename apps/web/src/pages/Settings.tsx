import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Globe, KeyRound, Laptop, Smartphone, UserRound } from 'lucide-react';
import { explorerAddress } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { getLang, setLang, tr } from '../lib/i18n';
import { guessDeviceType, lock, registerPasskey, saveSession } from '../lib/device';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { Addr, Button, Card, cx, dateOnly, MockBadge, Notice, PageHeader, Why } from '../components/ui';
import { Personalization } from '../components/Personalization';
import { ExternalWallets } from '../components/ExternalWallets';

export default function Settings() {
  const nav = useNavigate();
  const { device, unlocked, session } = useLocal();
  const { data, reload } = useWalletData();
  const profile = usePoll(() => bank.get(`/clients/${device!.clientId}`), 30000, [device?.clientId]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const c = data?.client;
  const owners: string[] = data?.onchain?.owners ?? [];
  const idv = profile.data?.idVerification;

  const role = (o: string) => {
    const l = o.toLowerCase();
    if (l === c?.owners?.device?.toLowerCase()) return { name: tr('Device key', 'Clé de l’appareil'), who: l === device!.deviceAddress.toLowerCase() ? tr('this device (you)', 'cet appareil (vous)') : tr('your other device', 'votre autre appareil'), icon: Smartphone };
    if (l === c?.owners?.cosigner?.toLowerCase()) return { name: tr('Swissquote co-signer', 'Co-signataire Swissquote'), who: tr('Swissquote (HSM in production)', 'Swissquote (HSM en production)'), icon: Building2 };
    if (l === c?.owners?.recovery?.toLowerCase()) return { name: tr('Recovery key', 'Clé de secours'), who: tr('in 3 parts: paper · cloud · partner', 'en 3 parties : papier · cloud · partenaire'), icon: KeyRound };
    return { name: tr('Unknown key', 'Clé inconnue'), who: '', icon: KeyRound };
  };

  const addDevice = async () => {
    setMsg(null);
    try {
      const other = guessDeviceType() === 'mobile' ? 'desktop' : 'mobile';
      await registerPasskey(device!.clientId, other);
      setMsg({ tone: 'ok', text: tr(`Second device (${other === 'mobile' ? 'mobile' : 'computer'}) linked.`, `Deuxième appareil (${other === 'mobile' ? 'mobile' : 'ordinateur'}) lié.`) });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Touch ID cancelled.', 'Touch ID annulé.') : e.message });
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <PageHeader title={tr('Settings', 'Paramètres')} back="/wallet/more" />

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <UserRound size={20} strokeWidth={1.75} /> {tr('Profile', 'Profil')}
        </h2>
        <dl className="divide-y divide-sq-line text-[14px]">
          <Row k={tr('Name', 'Nom')} v={session?.profile?.name} />
          <Row k={tr('Swissquote client', 'Client Swissquote')} v={session?.clientId} />
          <Row k="Email" v={profile.data?.email} />
          <Row
            k={tr('Identity', 'Identité')}
            v={idv?.status === 'accepted' ? tr(`Identity verified (simulated) — ${dateOnly(idv.date)}`, `Identité vérifiée (simulée) — ${dateOnly(idv.date)}`) : idv?.status === 'refused' ? tr('Document refused — please redo', 'Document refusé — à reprendre') : tr('Swissquote KYC (document check not done)', 'KYC Swissquote (vérification du document non faite)')}
          />
        </dl>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{tr('Who can move your funds', 'Qui peut déplacer vos fonds')}</h2>
          <span className="rounded-[4px] bg-sq-chip px-1.5 py-0.5 text-[12px] font-medium">
            {tr(`${data?.onchain?.threshold ?? 2} of ${owners.length || 3}, on the blockchain`, `${data?.onchain?.threshold ?? 2} sur ${owners.length || 3}, sur la blockchain`)}
          </span>
        </div>
        {owners.map((o) => {
          const r = role(o);
          return (
            <div key={o} className="flex items-center gap-3 text-[14px]">
              <r.icon size={20} strokeWidth={1.75} className="text-sq-ink-2" />
              <div className="flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-[12px] text-sq-muted">{r.who}</div>
              </div>
              <a href={explorerAddress(o)} target="_blank" rel="noreferrer" className="text-sq-muted hover:underline">
                <Addr a={o} />
              </a>
            </div>
          );
        })}
        <p className="text-[12px] text-sq-muted">{tr('Two keys are always required. Swissquote holds only one: it can refuse to co-sign, but never move your funds on its own.', 'Deux clés sont toujours nécessaires. Swissquote n’en détient qu’une : il peut refuser de co-signer, jamais déplacer vos fonds seul.')}</p>
        <Link to="/wallet/security" className="flex min-h-11 items-center justify-between rounded-[10px] border border-sq-line px-3 text-[14px] font-medium">
          {tr('Keys and security', 'Clés et sécurité')} <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
        </Link>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-[16px] font-semibold">{tr('Linked devices (passkeys)', 'Appareils liés (passkeys)')}</h2>
        {(c?.devices ?? []).map((d: any) => (
          <div key={d.credentialId} className="flex items-center gap-3 text-[14px]">
            {d.deviceType === 'mobile' ? <Smartphone size={20} strokeWidth={1.75} /> : <Laptop size={20} strokeWidth={1.75} />}
            <div className="flex-1">
              <div className="font-medium">{d.label}</div>
              <div className="text-[12px] text-sq-muted">{tr(`since ${dateOnly(d.createdAt)}`, `depuis le ${dateOnly(d.createdAt)}`)}</div>
            </div>
            <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium', d.status === 'active' ? 'bg-sq-ok-50 text-sq-up' : d.status === 'revoked' ? 'bg-sq-bad-50 text-sq-down' : 'bg-sq-warn-50 text-sq-warn')}>
              {d.status === 'active' ? tr('Active', 'Actif') : d.status === 'revoked' ? tr('Revoked', 'Révoqué') : tr('Pending', 'En attente')}
            </span>
          </div>
        ))}
        <Why>{tr('At most 1 phone and 1 computer. Changing device requires the existing device, your password, an email code and an SMS confirmation — or the full recovery procedure.', 'Au maximum 1 téléphone et 1 ordinateur. Changer d’appareil demande l’appareil existant, votre mot de passe, un code par email et une confirmation par SMS — ou la procédure de récupération complète.')}</Why>
        <Button variant="secondary" onClick={addDevice}>
          {tr('Link another device', 'Lier un autre appareil')}
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-[16px] font-semibold">{tr('What Swissquote sees in your consolidated view', 'Ce que Swissquote voit dans votre vue consolidée')}</h2>
        {[
          ['full', tr('Full consolidated view', 'Vue consolidée complète'), tr('Balances and transactions appear in your Swissquote portfolio.', 'Soldes et transactions apparaissent dans votre portefeuille Swissquote.')],
          ['balance-only', tr('Balance only', 'Solde uniquement'), tr('Only the total value appears in your portfolio.', 'Seule la valeur totale apparaît dans votre portefeuille.')],
          ['none', tr('None', 'Aucune'), tr('Swissquote neither displays nor uses the wallet data (compliance checks still apply).', 'Swissquote n’affiche ni n’utilise les données du wallet (les contrôles de conformité restent appliqués).')],
        ].map(([v, t, d]) => (
          <label key={v} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-[10px] border p-3', c?.privacy === v ? 'border-sq-ink/40 bg-sq-bg' : 'border-sq-line')}>
            <input
              type="radio"
              name="privacy"
              checked={c?.privacy === v}
              onChange={async () => {
                await cosigner.post(`/clients/${device!.clientId}/privacy`, { privacy: v });
                void reload();
              }}
              className="mt-1 accent-[#fa5b35]"
            />
            <span>
              <span className="block text-[14px] font-medium">{t}</span>
              <span className="block text-[12px] text-sq-muted">{d}</span>
            </span>
          </label>
        ))}
        <p className="text-[12px] text-sq-muted">{tr('A public blockchain stays public: this setting controls the consolidated view and Swissquote’s use of the data, not visibility on the blockchain.', 'Une blockchain publique reste publique : ce réglage contrôle l’affichage consolidé et l’usage des données par Swissquote, pas la visibilité sur la blockchain.')}</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <Globe size={20} strokeWidth={1.75} /> {tr('Language', 'Langue')}
        </h2>
        <div role="radiogroup" aria-label={tr('Language', 'Langue')} className="grid grid-cols-2 gap-2">
          {([
            ['en', 'English'],
            ['fr', 'Français'],
          ] as const).map(([l, label]) => (
            <label key={l} lang={l} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border p-3 text-[14px] font-medium', getLang() === l ? 'border-sq-ink/40 bg-sq-bg' : 'border-sq-line')}>
              <input type="radio" name="lang" checked={getLang() === l} onChange={() => setLang(l)} className="accent-[#fa5b35]" />
              {label}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-sq-muted">{tr('Saved on this device. English is the default.', 'Enregistré sur cet appareil. L’anglais est la langue par défaut.')}</p>
      </Card>

      <ExternalWallets clientId={device!.clientId} />

      <Personalization clientId={device!.clientId} />

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{tr('Demo controls', 'Contrôles de démo')}</h2>
          <MockBadge label={tr('Demo', 'Démo')} />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            lock();
            nav('/wallet/unlock');
          }}
          disabled={!unlocked}
        >
          {tr('Lock My Wall', 'Verrouiller My Wall')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (!confirm(tr('Simulate losing this device? The encrypted key will be erased from this browser.', 'Simuler la perte de cet appareil ? La clé chiffrée sera effacée de ce navigateur.'))) return;
            // The recovery page wipes the local wallet on arrival (wiping here would trigger the route guard first).
            nav('/recover', { state: { wipeDevice: true } });
          }}
        >
          {tr('Simulate: I lost this device', 'Simuler : j’ai perdu cet appareil')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            saveSession(null);
            lock();
            nav('/login');
          }}
        >
          {tr('Sign out of Swissquote', 'Se déconnecter de Swissquote')}
        </Button>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-sq-muted">{k}</dt>
      <dd className="text-right font-medium">{v ?? '—'}</dd>
    </div>
  );
}
