// #10 — "About this prototype": the short version of docs/PRODUCTION_READINESS.md. Discreet page (footer link and
// Wallet → More); the screens themselves carry no extra badges.

import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { tr } from '../lib/i18n';
import { Card } from '../components/ui';

const REAL: [string, string][] = [
  ['Safe 2-of-3 smart accounts on Ethereum Sepolia: signatures, sending, key replacement', 'Comptes Safe 2 sur 3 sur Ethereum Sepolia : signatures, envois, remplacement de clé'],
  ['Passkeys (Touch ID / Face ID) bound to each transaction', 'Passkeys (Touch ID / Face ID) liées à chaque opération'],
  ['Co-signing rules, independent transaction checks, simulation before signing', 'Règles de co-signature, contrôle indépendant des opérations, simulation avant signature'],
  ['Incoming payments read from the blockchain, PDF receipts', 'Réceptions lues sur la blockchain, justificatifs PDF'],
  ['Market prices and news from public sources (Yahoo Finance, CoinGecko, publishers)', 'Cours et actualités de sources publiques (Yahoo Finance, CoinGecko, éditeurs)'],
];

// [element, what is simulated, production integration] — condensed from docs/PRODUCTION_READINESS.md
const SIMULATED: [string, string, string, string, string, string][] = [
  ['Identity check (KYC, liveness)', 'Vérification d’identité (KYC, liveness)', 'Outcome only, no real check', 'Résultat seulement, aucune vraie vérification', 'FINMA-approved video identification provider', 'Prestataire d’identification vidéo agréé FINMA'],
  ['Sanctions screening', 'Filtrage des sanctions', 'Short fixed list', 'Courte liste fixe', 'Sanctions & blockchain-analytics data provider', 'Fournisseur de données de sanctions et d’analyse blockchain'],
  ['Swissquote co-signing key', 'Clé de co-signature Swissquote', 'Encrypted file on a server', 'Fichier chiffré sur un serveur', 'Hardware security module (HSM)', 'Module matériel de sécurité (HSM)'],
  ['Recovery partner', 'Partenaire de récupération', 'Demo service run by us', 'Service de démo géré par nous', 'Independent Swiss fiduciary partner', 'Partenaire fiduciaire suisse indépendant'],
  ['Account, balances, treasury', 'Compte, soldes, trésorerie', 'Fictitious data, test tokens', 'Données fictives, jetons de test', 'Swissquote core banking', 'Système bancaire central Swissquote'],
  ['Travel Rule', 'Travel Rule', 'Data collected, not transmitted', 'Données collectées, non transmises', 'Travel Rule network (TRP / IVMS101)', 'Réseau Travel Rule (TRP / IVMS101)'],
  ['Emails, SMS, notifications', 'Emails, SMS, notifications', 'Shown in a demo inbox', 'Affichés dans une boîte de démo', 'Email / SMS gateway, mobile push', 'Passerelle email / SMS, notifications push'],
  ['Compliance console', 'Console conformité', 'Demo login', 'Connexion de démo', 'Back-office SSO, case management, audit storage', 'SSO back-office, gestion de dossiers, archivage d’audit'],
  ['Network fees (gas)', 'Frais de réseau (gas)', 'One test wallet pays', 'Un wallet de test paie', 'Paymaster / relayer with HSM key', 'Paymaster / relais avec clé en HSM'],
  ['Blockchain access', 'Accès à la blockchain', 'Free public nodes', 'Nœuds publics gratuits', 'Own nodes or contracted provider with SLA', 'Nœuds propres ou prestataire sous contrat avec SLA'],
  ['Orders, exchange, payments', 'Ordres, échange, paiements', 'Never executed or charged', 'Jamais exécutés ni facturés', 'Swissquote trading desk, payment provider', 'Desk de trading Swissquote, prestataire de paiement'],
  ['Mobile apps', 'Apps mobiles', 'Generated, not compiled', 'Générées, non compilées', 'Signed store builds', 'Versions signées sur les stores'],
];

export default function About() {
  const nav = useNavigate();
  return (
    <div className="mw-page mx-auto max-w-[760px] space-y-4 px-4 pb-10 pt-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} className="-ml-2 flex size-11 items-center justify-center rounded-full text-sq-ink hover:bg-sq-chip/60" aria-label={tr('Back', 'Retour')}>
          <ChevronLeft size={22} strokeWidth={1.75} />
        </button>
        <h1 className="text-[22px] font-semibold tracking-tight">{tr('About this prototype', 'À propos de ce prototype')}</h1>
      </div>
      <p className="text-[14px] text-sq-ink-2">
        {tr(
          'My Wall was built for the Swissquote Wallet Challenge (EPFL hackathon). It runs on the Ethereum Sepolia test network: tokens have no value. The custody core is real; services a bank would buy from regulated providers are simulated.',
          'My Wall a été réalisé pour le Swissquote Wallet Challenge (hackathon EPFL). Il fonctionne sur le réseau de test Ethereum Sepolia : les jetons n’ont aucune valeur. Le cœur de la garde est réel ; les services qu’une banque achèterait à des prestataires régulés sont simulés.',
        )}
      </p>

      <Card as="section" className="space-y-2">
        <h2 className="text-[16px] font-semibold">{tr('Real in this prototype', 'Réel dans ce prototype')}</h2>
        <ul className="list-disc space-y-1 pl-5 text-[14px]">
          {REAL.map(([en, fr]) => (
            <li key={en}>{tr(en, fr)}</li>
          ))}
        </ul>
      </Card>

      <Card as="section" className="space-y-2">
        <h2 className="text-[16px] font-semibold">{tr('Simulated, and what replaces it in production', 'Simulé, et ce qui le remplace en production')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]" data-testid="about-table">
            <thead>
              <tr className="border-b border-sq-line text-[12px] text-sq-muted">
                <th className="py-2 pr-3 font-medium">{tr('Element', 'Élément')}</th>
                <th className="py-2 pr-3 font-medium">{tr('Simulated', 'Simulé')}</th>
                <th className="py-2 font-medium">{tr('In production', 'En production')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sq-line">
              {SIMULATED.map((r) => (
                <tr key={r[0]}>
                  <td className="py-2 pr-3 font-medium">{tr(r[0], r[1])}</td>
                  <td className="py-2 pr-3 text-sq-ink-2">{tr(r[2], r[3])}</td>
                  <td className="py-2 text-sq-ink-2">{tr(r[4], r[5])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-sq-muted">
          {tr('Full matrix with risks and effort: docs/PRODUCTION_READINESS.md in the repository. Real vs Mock table: README.', 'Matrice complète avec risques et effort : docs/PRODUCTION_READINESS.md dans le dépôt. Tableau Réel / Mock : README.')}
        </p>
      </Card>

      <p className="text-[13px] text-sq-muted">
        {tr('Swissquote services unreachable? ', 'Services Swissquote injoignables ? ')}
        <Link to="/emergency" className="underline underline-offset-2">
          {tr('Emergency mode', 'Mode urgence')}
        </Link>
      </p>
    </div>
  );
}
