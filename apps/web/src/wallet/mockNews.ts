// FICTITIOUS content for the "Marché crypto" and "Mises à jour" information categories (demo only).

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
    title: "Ethereum : la mise à jour réseau réduit encore les frais sur les couches 2",
    summary: 'Les frais moyens observés sur les principaux réseaux de couche 2 ont baissé cette semaine selon plusieurs explorateurs.',
    body: "Contenu de démonstration. Les frais de transaction sur les réseaux de couche 2 (rollups) restent bas après la dernière mise à jour du protocole. Pour My Wall, cela rendrait le parrainage des frais par Swissquote encore moins coûteux.",
    source: 'Rédaction démo',
    publishedAt: '2026-10-10T07:30:00Z',
    assets: ['ETH'],
  },
  {
    id: 'n2',
    title: 'USDC : la circulation progresse en Europe',
    summary: "L'offre de stablecoins en dollars poursuit sa croissance, portée par les paiements transfrontaliers.",
    body: 'Contenu de démonstration. Les stablecoins régulés gagnent du terrain pour les paiements internationaux. Les prestataires suisses suivent de près le cadre MiCA voisin.',
    source: 'Rédaction démo',
    publishedAt: '2026-10-09T15:10:00Z',
    assets: ['USDC'],
  },
  {
    id: 'n3',
    title: 'Self-custody : les wallets à plusieurs clés se généralisent',
    summary: 'Les smart accounts à signatures multiples séduisent les épargnants qui veulent garder le contrôle sans tout risquer.',
    body: "Contenu de démonstration. Les wallets « 2 sur 3 » combinent l'autonomie du client et un filet de sécurité : une seule clé perdue ne suffit plus à tout perdre.",
    source: 'Rédaction démo',
    publishedAt: '2026-10-08T09:00:00Z',
    assets: ['ETH', 'USDC'],
  },
  {
    id: 'n4',
    title: 'Ether recule légèrement après une semaine de hausse',
    summary: "Prise de bénéfices modérée sur l'ether ; les volumes restent dans la moyenne.",
    body: 'Contenu de démonstration. Aucune donnée de marché réelle.',
    source: 'Rédaction démo',
    publishedAt: '2026-10-07T17:45:00Z',
    assets: ['ETH'],
  },
  {
    id: 'n5',
    title: 'Travel Rule : les vérifications automatiques de wallets progressent',
    summary: "Les preuves de propriété signées remplacent peu à peu les captures d'écran et les « tests Satoshi ».",
    body: 'Contenu de démonstration. My Wall enregistre une preuve EIP-1271 dès la création, ce qui évite toute vérification manuelle pour les virements entre le compte et le wallet.',
    source: 'Rédaction démo',
    publishedAt: '2026-10-06T11:20:00Z',
    assets: ['USDC'],
  },
  {
    id: 'n6',
    title: 'Phishing : attention aux autorisations de dépense illimitées',
    summary: 'Les fausses applications demandent souvent un « approve » illimité. Vérifiez toujours ce que vous signez.',
    body: 'Contenu de démonstration. My Wall affiche une alerte rouge et demande des contrôles renforcés pour toute autorisation illimitée.',
    source: 'Rédaction démo',
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
    title: 'Imprimez votre kit de récupération',
    date: '2026-10-10T08:00:00Z',
    body: 'Votre code de récupération papier est la partie ① de votre clé de secours. Imprimez-le et rangez-le hors de votre téléphone.',
    action: { label: 'Ouvrir Clés et sécurité', to: '/wallet/security' },
  },
  {
    id: 'act-backup',
    title: 'Téléchargez une sauvegarde chiffrée de votre clé',
    date: '2026-10-10T08:00:00Z',
    body: "Une sauvegarde chiffrée de la clé de l'appareil vous permet aussi d'utiliser la porte de sortie si Swissquote disparaissait.",
    action: { label: 'Créer la sauvegarde', to: '/wallet/security' },
  },
  {
    id: 'v0.3.0',
    title: 'v0.3.0 — 10.10.2026',
    date: '2026-10-10T06:00:00Z',
    body: "Justificatifs PDF, Swaplet → Documents, informations en 3 catégories, nouvelle interface My Wall. Correctif : resynchronisation automatique du relais de frais.",
  },
  {
    id: 'v0.2.0',
    title: 'v0.2.0 — 09.10.2026',
    date: '2026-10-09T06:00:00Z',
    body: 'Récupération guidée avec délai de sécurité et annulation en un geste ; refus des tentatives à risque.',
  },
  {
    id: 'v0.1.0',
    title: 'v0.1.0 — 08.10.2026',
    date: '2026-10-08T06:00:00Z',
    body: 'Première version : wallet 2 sur 3, frais offerts par Swissquote, contrôles de conformité.',
  },
];
