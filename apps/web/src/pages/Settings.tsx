import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, KeyRound, Laptop, Smartphone, UserRound } from 'lucide-react';
import { explorerAddress } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { guessDeviceType, lock, registerPasskey, saveSession } from '../lib/device';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { Addr, Button, Card, cx, dateOnly, MockBadge, Notice, PageHeader, Why } from '../components/ui';

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
    if (l === c?.owners?.device?.toLowerCase()) return { name: 'Clé de l’appareil', who: l === device!.deviceAddress.toLowerCase() ? 'cet appareil (vous)' : 'votre autre appareil', icon: Smartphone };
    if (l === c?.owners?.cosigner?.toLowerCase()) return { name: 'Co-signataire Swissquote', who: 'Swissquote (HSM en production)', icon: Building2 };
    if (l === c?.owners?.recovery?.toLowerCase()) return { name: 'Clé de secours', who: 'en 3 parties : papier · cloud · partenaire', icon: KeyRound };
    return { name: 'Clé inconnue', who: '', icon: KeyRound };
  };

  const addDevice = async () => {
    setMsg(null);
    try {
      const other = guessDeviceType() === 'mobile' ? 'desktop' : 'mobile';
      await registerPasskey(device!.clientId, other);
      setMsg({ tone: 'ok', text: `Deuxième appareil (${other === 'mobile' ? 'mobile' : 'ordinateur'}) lié.` });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? 'Touch ID annulé.' : e.message });
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <PageHeader title="Paramètres" back="/wallet/more" />

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <UserRound size={20} strokeWidth={1.75} /> Profil
        </h2>
        <dl className="divide-y divide-sq-line text-[14px]">
          <Row k="Nom" v={session?.profile?.name} />
          <Row k="Client Swissquote" v={session?.clientId} />
          <Row k="Email" v={profile.data?.email} />
          <Row
            k="Identité"
            v={idv?.status === 'accepted' ? `Identité vérifiée (simulée) — ${dateOnly(idv.date)}` : idv?.status === 'refused' ? 'Document refusé — à reprendre' : 'KYC Swissquote (vérification du document non faite)'}
          />
        </dl>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Qui peut déplacer vos fonds</h2>
          <span className="rounded-[4px] bg-sq-chip px-1.5 py-0.5 text-[12px] font-medium">
            {data?.onchain?.threshold ?? 2} sur {owners.length || 3}, sur la blockchain
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
        <p className="text-[12px] text-sq-muted">Deux clés sont toujours nécessaires. Swissquote n’en détient qu’une : il peut refuser de co-signer, jamais déplacer vos fonds seul.</p>
        <Link to="/wallet/security" className="flex min-h-11 items-center justify-between rounded-[10px] border border-sq-line px-3 text-[14px] font-medium">
          Clés et sécurité <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
        </Link>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-[16px] font-semibold">Appareils liés (passkeys)</h2>
        {(c?.devices ?? []).map((d: any) => (
          <div key={d.credentialId} className="flex items-center gap-3 text-[14px]">
            {d.deviceType === 'mobile' ? <Smartphone size={20} strokeWidth={1.75} /> : <Laptop size={20} strokeWidth={1.75} />}
            <div className="flex-1">
              <div className="font-medium">{d.label}</div>
              <div className="text-[12px] text-sq-muted">depuis le {dateOnly(d.createdAt)}</div>
            </div>
            <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium', d.status === 'active' ? 'bg-sq-ok-50 text-sq-up' : d.status === 'revoked' ? 'bg-sq-bad-50 text-sq-down' : 'bg-sq-warn-50 text-sq-warn')}>
              {d.status === 'active' ? 'Actif' : d.status === 'revoked' ? 'Révoqué' : 'En attente'}
            </span>
          </div>
        ))}
        <Why>Au maximum 1 téléphone et 1 ordinateur. Changer d’appareil demande l’appareil existant, votre mot de passe, un code par email et une confirmation par SMS — ou la procédure de récupération complète.</Why>
        <Button variant="secondary" onClick={addDevice}>
          Lier un autre appareil
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-[16px] font-semibold">Ce que Swissquote voit dans votre vue consolidée</h2>
        {[
          ['full', 'Vue consolidée complète', 'Soldes et transactions apparaissent dans votre portefeuille Swissquote.'],
          ['balance-only', 'Solde uniquement', 'Seule la valeur totale apparaît dans votre portefeuille.'],
          ['none', 'Aucune', 'Swissquote n’affiche ni n’utilise les données du wallet (les contrôles de conformité restent appliqués).'],
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
        <p className="text-[12px] text-sq-muted">Une blockchain publique reste publique : ce réglage contrôle l’affichage consolidé et l’usage des données par Swissquote, pas la visibilité sur la blockchain.</p>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Contrôles de démo</h2>
          <MockBadge label="Démo" />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            lock();
            nav('/wallet/unlock');
          }}
          disabled={!unlocked}
        >
          Verrouiller My Wall
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (!confirm('Simuler la perte de cet appareil ? La clé chiffrée sera effacée de ce navigateur.')) return;
            // The recovery page wipes the local wallet on arrival (wiping here would trigger the route guard first).
            nav('/recover', { state: { wipeDevice: true } });
          }}
        >
          Simuler : j’ai perdu cet appareil
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            saveSession(null);
            lock();
            nav('/login');
          }}
        >
          Se déconnecter de Swissquote
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
