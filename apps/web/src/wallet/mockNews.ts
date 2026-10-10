// FICTITIOUS content for the "Marché crypto" and "Mises à jour" information categories (demo only).

import { tr } from '../lib/i18n';

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  source: string;
  publishedAt: string;
  assets: ('ETH' | 'USDC')[];
}

export const MARKET_NEWS: NewsItem[] = [
  {
    id: 'n1',
    title: tr('Ethereum: network upgrade cuts layer-2 fees further', "Ethereum : la mise à jour réseau réduit encore les frais sur les couches 2"),
    summary: tr('Average fees on the main layer-2 networks fell this week, according to several explorers.', 'Les frais moyens observés sur les principaux réseaux de couche 2 ont baissé cette semaine selon plusieurs explorateurs.'),
    body: tr('Demo content. Transaction fees on layer-2 networks (rollups) remain low after the latest protocol upgrade. For My Wall, this would make Swissquote’s fee sponsoring even cheaper.', "Contenu de démonstration. Les frais de transaction sur les réseaux de couche 2 (rollups) restent bas après la dernière mise à jour du protocole. Pour My Wall, cela rendrait le parrainage des frais par Swissquote encore moins coûteux."),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-10T07:30:00Z',
    assets: ['ETH'],
  },
  {
    id: 'n2',
    title: tr('USDC: circulation grows in Europe', 'USDC : la circulation progresse en Europe'),
    summary: tr('The supply of dollar stablecoins keeps growing, driven by cross-border payments.', "L'offre de stablecoins en dollars poursuit sa croissance, portée par les paiements transfrontaliers."),
    body: tr('Demo content. Regulated stablecoins are gaining ground for international payments. Swiss providers are closely following the neighbouring MiCA framework.', 'Contenu de démonstration. Les stablecoins régulés gagnent du terrain pour les paiements internationaux. Les prestataires suisses suivent de près le cadre MiCA voisin.'),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-09T15:10:00Z',
    assets: ['USDC'],
  },
  {
    id: 'n3',
    title: tr('Self-custody: multi-key wallets go mainstream', 'Self-custody : les wallets à plusieurs clés se généralisent'),
    summary: tr('Multi-signature smart accounts appeal to savers who want to stay in control without risking everything.', 'Les smart accounts à signatures multiples séduisent les épargnants qui veulent garder le contrôle sans tout risquer.'),
    body: tr('Demo content. “2-of-3” wallets combine customer autonomy with a safety net: losing a single key is no longer enough to lose everything.', "Contenu de démonstration. Les wallets « 2 sur 3 » combinent l'autonomie du client et un filet de sécurité : une seule clé perdue ne suffit plus à tout perdre."),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-08T09:00:00Z',
    assets: ['ETH', 'USDC'],
  },
  {
    id: 'n4',
    title: tr('Ether dips slightly after a week of gains', 'Ether recule légèrement après une semaine de hausse'),
    summary: tr('Moderate profit-taking on ether; volumes remain average.', "Prise de bénéfices modérée sur l'ether ; les volumes restent dans la moyenne."),
    body: tr('Demo content. No real market data.', 'Contenu de démonstration. Aucune donnée de marché réelle.'),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-07T17:45:00Z',
    assets: ['ETH'],
  },
  {
    id: 'n5',
    title: tr('Travel Rule: automatic wallet checks are gaining ground', 'Travel Rule : les vérifications automatiques de wallets progressent'),
    summary: tr('Signed ownership proofs are gradually replacing screenshots and “Satoshi tests”.', "Les preuves de propriété signées remplacent peu à peu les captures d'écran et les « tests Satoshi »."),
    body: tr('Demo content. My Wall records an EIP-1271 proof at creation, so transfers between the account and the wallet need no manual check.', 'Contenu de démonstration. My Wall enregistre une preuve EIP-1271 dès la création, ce qui évite toute vérification manuelle pour les virements entre le compte et le wallet.'),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-06T11:20:00Z',
    assets: ['USDC'],
  },
  {
    id: 'n6',
    title: tr('Phishing: beware of unlimited spending approvals', 'Phishing : attention aux autorisations de dépense illimitées'),
    summary: tr('Fake apps often ask for an unlimited “approve”. Always check what you sign.', 'Les fausses applications demandent souvent un « approve » illimité. Vérifiez toujours ce que vous signez.'),
    body: tr('Demo content. My Wall shows a red alert and requires stronger checks for any unlimited approval.', 'Contenu de démonstration. My Wall affiche une alerte rouge et demande des contrôles renforcés pour toute autorisation illimitée.'),
    source: tr('Demo newsroom', 'Rédaction démo'),
    publishedAt: '2026-10-05T08:00:00Z',
    assets: ['ETH', 'USDC'],
  },
];

export interface ReleaseItem {
  id: string;
  title: string;
  date: string;
  body: string;
  action?: { label: string; to: string };
}

export const RELEASES: ReleaseItem[] = [
  {
    id: 'act-kit',
    title: tr('Print your recovery kit', 'Imprimez votre kit de récupération'),
    date: '2026-10-10T08:00:00Z',
    body: tr('Your paper recovery code is part ① of your backup key. Print it and keep it away from your phone.', 'Votre code de récupération papier est la partie ① de votre clé de secours. Imprimez-le et rangez-le hors de votre téléphone.'),
    action: { label: tr('Open Keys & security', 'Ouvrir Clés et sécurité'), to: '/wallet/security' },
  },
  {
    id: 'act-backup',
    title: tr('Download an encrypted backup of your key', 'Téléchargez une sauvegarde chiffrée de votre clé'),
    date: '2026-10-10T08:00:00Z',
    body: tr('An encrypted backup of the device key also lets you use the exit door if Swissquote ever disappeared.', "Une sauvegarde chiffrée de la clé de l'appareil vous permet aussi d'utiliser la porte de sortie si Swissquote disparaissait."),
    action: { label: tr('Create the backup', 'Créer la sauvegarde'), to: '/wallet/security' },
  },
  {
    id: 'v0.3.0',
    title: 'v0.3.0 — 10.10.2026',
    date: '2026-10-10T06:00:00Z',
    body: tr('PDF receipts, Swaplet → Documents, information in 3 categories, new My Wall interface. Fix: automatic resync of the fee relayer.', "Justificatifs PDF, Swaplet → Documents, informations en 3 catégories, nouvelle interface My Wall. Correctif : resynchronisation automatique du relais de frais."),
  },
  {
    id: 'v0.2.0',
    title: 'v0.2.0 — 09.10.2026',
    date: '2026-10-09T06:00:00Z',
    body: tr('Guided recovery with a security delay and one-tap cancellation; risky attempts are refused.', 'Récupération guidée avec délai de sécurité et annulation en un geste ; refus des tentatives à risque.'),
  },
  {
    id: 'v0.1.0',
    title: 'v0.1.0 — 08.10.2026',
    date: '2026-10-08T06:00:00Z',
    body: tr('First release: 2-of-3 wallet, fees paid by Swissquote, compliance checks.', 'Première version : wallet 2 sur 3, frais offerts par Swissquote, contrôles de conformité.'),
  },
];
