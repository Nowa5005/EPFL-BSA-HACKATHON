// Inspiration: educational editorial content written for the My Wall / Swissquote prototype, in English and French.
// Every factual statement cites a source ([n] → sources[n-1]); every URL was opened and checked on 2026-10-10.
// No performance figures of real products, no promised returns, no recommendation.

export type Block = { h: string } | { p: string } | { ul: string[] };
type T = { en: string; fr: string };

export interface EditorialArticle {
  id: string;
  theme: 'diversification' | 'etf' | 'fees' | 'volatility' | 'security' | 'orders' | 'stablecoins';
  themeLabel: T;
  title: T;
  intro: T;
  readMin: number;
  updated: string; // YYYY-MM-DD
  body: { en: Block[]; fr: Block[] };
  sources: { title: string; publisher: string; url: string; lang?: string }[];
}

export const EDITORIAL_LABEL: T = {
  en: 'Editorial — My Wall / Swissquote prototype content, not investment advice.',
  fr: 'Éditorial — contenu du prototype My Wall / Swissquote, pas un conseil en investissement.',
};

const UPDATED = '2026-10-10';

export const INSPIRATION: EditorialArticle[] = [
  {
    id: 'diversification',
    theme: 'diversification',
    themeLabel: { en: 'Diversification', fr: 'Diversification' },
    title: { en: 'Diversification: not putting all your eggs in one basket', fr: 'Diversifier : ne pas mettre tous ses œufs dans le même panier' },
    intro: {
      en: 'Spreading money across different investments is one of the oldest ideas in investing. What it can do, what it cannot do, and how allocation and rebalancing fit in.',
      fr: 'Répartir son argent entre plusieurs placements est l’une des plus anciennes idées de l’investissement. Ce qu’elle permet, ce qu’elle ne permet pas, et le rôle de l’allocation et du rééquilibrage.',
    },
    readMin: 4,
    updated: UPDATED,
    body: {
      en: [
        { p: 'Diversification is the practice of spreading money among different investments to reduce risk [1]. The idea is simple: if one holding does badly, it weighs less on the whole portfolio when it is only one part of it.' },
        { h: 'What it can — and cannot — do' },
        { p: 'Diversification reduces the risk of major losses that can result from over-emphasising a single security [2]. It is not a guarantee: it cannot ensure that your investments won’t suffer if the market as a whole drops, but it can improve the chances that you lose less [3]. Investment risk can be managed, but it cannot be eliminated [4].' },
        { h: 'Asset allocation' },
        { p: 'Asset allocation means dividing a portfolio among different asset categories, such as stocks, bonds and cash [1]. How you split them depends on your goals, your time horizon and how much fluctuation you can tolerate.' },
        { h: 'Rebalancing' },
        { p: 'Over time, some parts of a portfolio grow faster than others, so the mix drifts. Rebalancing is bringing the portfolio back to its original allocation mix [1] — making regular adjustments so that you still hit your target allocation [2].' },
        { h: 'Questions to ask yourself' },
        { ul: ['Is most of my money tied to a single company, sector, country or currency?', 'Which allocation did I choose, and why?', 'When did I last check whether my portfolio still matches it?'] },
      ],
      fr: [
        { p: 'Diversifier, c’est répartir son argent entre différents placements afin de réduire le risque [1]. L’idée est simple : si un placement se comporte mal, il pèse moins sur l’ensemble lorsqu’il n’en représente qu’une partie.' },
        { h: 'Ce qu’elle permet — et ce qu’elle ne permet pas' },
        { p: 'La diversification réduit le risque de pertes importantes dues à une concentration excessive sur un seul titre [2]. Ce n’est pas une garantie : elle ne peut pas empêcher vos placements de souffrir si l’ensemble du marché baisse, mais elle peut améliorer les chances de perdre moins [3]. Le risque d’investissement se gère, mais ne peut pas être éliminé [4].' },
        { h: 'L’allocation d’actifs' },
        { p: 'L’allocation d’actifs consiste à répartir un portefeuille entre différentes catégories, comme les actions, les obligations et les liquidités [1]. La répartition dépend de vos objectifs, de votre horizon de placement et des fluctuations que vous êtes prêt à supporter.' },
        { h: 'Le rééquilibrage' },
        { p: 'Avec le temps, certaines parties du portefeuille progressent plus vite que d’autres et la répartition dérive. Rééquilibrer, c’est ramener le portefeuille à sa répartition d’origine [1], par des ajustements réguliers pour rester sur l’allocation visée [2].' },
        { h: 'Questions à se poser' },
        { ul: ['La majeure partie de mon argent dépend-elle d’une seule entreprise, d’un secteur, d’un pays ou d’une monnaie ?', 'Quelle allocation ai-je choisie, et pourquoi ?', 'Quand ai-je vérifié pour la dernière fois que mon portefeuille y correspond encore ?'] },
      ],
    },
    sources: [
      { title: 'Beginners’ Guide to Asset Allocation, Diversification, and Rebalancing', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset' },
      { title: 'Asset Allocation and Diversification', publisher: 'FINRA', url: 'https://www.finra.org/investors/investing/investing-basics/asset-allocation-diversification' },
      { title: 'Diversify Your Investments', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/diversify-your-investments' },
      { title: 'Risk', publisher: 'FINRA', url: 'https://www.finra.org/investors/investing/investing-basics/risk' },
    ],
  },
  {
    id: 'etf-basics',
    theme: 'etf',
    themeLabel: { en: 'ETFs', fr: 'ETF' },
    title: { en: 'ETFs explained: a fund that trades like a share', fr: 'Les ETF expliqués : un fonds qui s’échange comme une action' },
    intro: {
      en: 'Exchange-traded funds pool many investors’ money and are traded on an exchange during the day. How they work, what they cost and what applies in Switzerland.',
      fr: 'Les fonds négociés en bourse regroupent l’argent de nombreux investisseurs et s’échangent en bourse pendant la journée. Fonctionnement, coûts et spécificités suisses.',
    },
    readMin: 5,
    updated: UPDATED,
    body: {
      en: [
        { p: 'An exchange-traded fund (ETF) pools money from many investors and invests it in stocks, bonds, money-market instruments or other assets [1]. Unlike a classic fund, its shares can be traded on the market at the market price whenever the market is open, minus any fees [1].' },
        { h: 'Index ETFs' },
        { p: 'Many ETFs follow an index. For an index-based ETF, the manager seeks to track an underlying securities index and achieve returns that closely correspond to that index [2] — which also means the ETF goes down when its index goes down.' },
        { h: 'What it costs' },
        { ul: ['Ongoing fund costs, expressed as a percentage of the fund’s average net assets: the expense ratio [3].', 'Brokerage commissions, which ETF investors may pay with each purchase or sale [3].', 'The bid-ask spread: the bid price is lower than the ask price, and the difference between the two is the spread [3].'] },
        { h: 'In Switzerland' },
        { p: 'ETFs are listed and traded on the Swiss Stock Exchange (SIX), which highlights diversification with a single transaction as one of their features [4]. A foreign fund needs FINMA authorisation before it can be offered in Switzerland to non-qualified investors [5]. Checking that a fund is authorised for distribution in Switzerland is a useful first step.' },
        { h: 'Before buying an ETF' },
        { ul: ['What exactly does it hold, and which index does it track?', 'What is its expense ratio, and what trading costs apply?', 'In which currency is it traded, and in which currencies are its holdings?'] },
      ],
      fr: [
        { p: 'Un fonds négocié en bourse (ETF) regroupe l’argent de nombreux investisseurs et l’investit dans des actions, des obligations, des instruments du marché monétaire ou d’autres actifs [1]. Contrairement à un fonds classique, ses parts s’échangent sur le marché, au prix du marché, tant que la bourse est ouverte, frais en sus [1].' },
        { h: 'Les ETF indiciels' },
        { p: 'Beaucoup d’ETF suivent un indice. Pour un ETF indiciel, le gestionnaire cherche à répliquer un indice et à obtenir des rendements proches de ceux de cet indice [2] — ce qui signifie aussi que l’ETF baisse quand son indice baisse.' },
        { h: 'Ce que ça coûte' },
        { ul: ['Les frais courants du fonds, exprimés en pourcentage de ses actifs nets moyens : le ratio de frais (expense ratio, souvent appelé TER en Europe) [3].', 'Les commissions de courtage, que l’investisseur peut payer à chaque achat ou vente [3].', 'L’écart acheteur-vendeur (spread) : le prix offert à l’achat est inférieur au prix demandé à la vente, et la différence constitue le spread [3].'] },
        { h: 'En Suisse' },
        { p: 'Les ETF sont cotés et négociés à la Bourse suisse (SIX), qui met notamment en avant la diversification en une seule transaction [4]. Un fonds étranger doit être autorisé par la FINMA avant de pouvoir être proposé en Suisse à des investisseurs non qualifiés [5]. Vérifier qu’un fonds est autorisé à la distribution en Suisse est un bon premier réflexe.' },
        { h: 'Avant d’acheter un ETF' },
        { ul: ['Que détient-il exactement, et quel indice suit-il ?', 'Quel est son ratio de frais et quels coûts de transaction s’appliquent ?', 'Dans quelle monnaie se négocie-t-il, et dans quelles monnaies sont ses placements ?'] },
      ],
    },
    sources: [
      { title: 'Exchange-Traded Funds (ETFs)', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/investing-basics/investment-products/mutual-funds-and-exchange-traded-2' },
      { title: 'Updated Investor Bulletin: Exchange-Traded Funds (ETFs)', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-24' },
      { title: 'Mutual Fund and ETF Fees and Expenses – Investor Bulletin', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/mutual-fund-and-etf-fees-and-expenses-investor-bulletin' },
      { title: 'Exchange Traded Funds', publisher: 'SIX Swiss Exchange', url: 'https://www.six-group.com/en/market-data/etf.html' },
      { title: 'Foreign collective investment schemes', publisher: 'FINMA', url: 'https://www.finma.ch/en/authorisation/asset-management/foreign-collective-investment-schemes/' },
    ],
  },
  {
    id: 'fees',
    theme: 'fees',
    themeLabel: { en: 'Fees', fr: 'Frais' },
    title: { en: 'Small fees, big effect: reading the cost of investing', fr: 'Petits frais, grand effet : lire le coût d’un placement' },
    intro: {
      en: 'Fees look tiny next to market movements, but they are charged year after year. The main kinds of costs, and the Swiss transfer stamp tax on securities trades.',
      fr: 'Les frais semblent minimes à côté des mouvements du marché, mais ils s’appliquent année après année. Les principaux coûts, et le droit de timbre de négociation suisse.',
    },
    readMin: 4,
    updated: UPDATED,
    body: {
      en: [
        { p: 'Ongoing fees may seem small, but over time they can have a major impact on an investment portfolio [1]. The U.S. SEC illustrates this with a hypothetical $100,000 investment growing 4 % a year for 20 years: with a 0.25 % annual fee it ends at about $208,000, with 0.50 % at about $198,000 and with 1.00 % at about $179,000 [1]. These are illustrative figures from the SEC, not a forecast for any product.' },
        { h: 'The usual costs' },
        { ul: ['Fund running costs, expressed as an annual percentage of assets (the expense ratio) [2].', 'Brokerage commissions on each purchase or sale [2].', 'The bid-ask spread, the difference between the buying and the selling price [2].'] },
        { h: 'Swiss transfer stamp tax' },
        { p: 'In Switzerland, the transfer stamp tax covers purchases and sales of Swiss and foreign securities by Swiss securities dealers [3]. It amounts to 1.5 ‰ (0.15 %) for Swiss securities and 3.0 ‰ (0.3 %) for foreign securities, and the dealer owes half of the duty for each party to the trade [4].' },
        { h: 'A simple habit' },
        { p: 'Before investing, add up all the costs you will pay: on entry, every year, and on exit. Comparing total costs is more informative than comparing a single fee.' },
      ],
      fr: [
        { p: 'Les frais courants peuvent paraître faibles, mais avec le temps ils peuvent peser lourdement sur un portefeuille [1]. La SEC américaine l’illustre avec un placement hypothétique de 100 000 $ progressant de 4 % par an pendant 20 ans : avec 0,25 % de frais annuels, il atteint environ 208 000 $, avec 0,50 % environ 198 000 $ et avec 1,00 % environ 179 000 $ [1]. Ce sont des chiffres d’illustration de la SEC, pas une prévision pour un produit.' },
        { h: 'Les coûts habituels' },
        { ul: ['Les frais de fonctionnement d’un fonds, exprimés en pourcentage annuel des actifs (ratio de frais) [2].', 'Les commissions de courtage à chaque achat ou vente [2].', 'L’écart acheteur-vendeur (spread), différence entre prix d’achat et prix de vente [2].'] },
        { h: 'Le droit de timbre de négociation suisse' },
        { p: 'En Suisse, le droit de timbre de négociation porte sur les achats et ventes de titres suisses et étrangers effectués par des négociants en valeurs mobilières suisses [3]. Il s’élève à 1,5 ‰ (0,15 %) pour les titres suisses et à 3,0 ‰ (0,3 %) pour les titres étrangers, le négociant devant une demi-taxe pour chaque partie à la transaction [4].' },
        { h: 'Une habitude simple' },
        { p: 'Avant d’investir, additionnez tous les coûts : à l’entrée, chaque année et à la sortie. Comparer le coût total est plus parlant que comparer un seul frais.' },
      ],
    },
    sources: [
      { title: 'How Fees and Expenses Affect Your Investment Portfolio – Investor Bulletin', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/updated' },
      { title: 'Mutual Fund and ETF Fees and Expenses – Investor Bulletin', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/mutual-fund-and-etf-fees-and-expenses-investor-bulletin' },
      { title: 'Stamp duty', publisher: 'Swiss Federal Tax Administration (ESTV)', url: 'https://www.estv.admin.ch/en/stamp-duty' },
      { title: 'Umsatzabgabe kurz erklärt', publisher: 'Swiss Federal Tax Administration (ESTV)', url: 'https://www.estv.admin.ch/de/umsatzabgabe-kurz-erklaert', lang: 'de' },
    ],
  },
  {
    id: 'volatility',
    theme: 'volatility',
    themeLabel: { en: 'Volatility', fr: 'Volatilité' },
    title: { en: 'Volatility: why prices move, and how to live with it', fr: 'La volatilité : pourquoi les prix bougent, et comment vivre avec' },
    intro: {
      en: 'Prices go up and down, sometimes sharply. What volatility measures, how it is calculated, and why your time horizon matters.',
      fr: 'Les cours montent et descendent, parfois brutalement. Ce que mesure la volatilité, comment elle se calcule et pourquoi votre horizon compte.',
    },
    readMin: 4,
    updated: UPDATED,
    body: {
      en: [
        { p: 'Price volatility is a measure of the level of uncertainty in markets or for an individual instrument [1]. Historical volatility is calculated by measuring the standard deviation of prices of a security over a given period [1].' },
        { h: 'A Swiss example: the VSMI' },
        { p: 'SIX publishes the VSMI, launched in 2005, which measures the implied volatility of SMI options — in other words, the fluctuation the options market is pricing in [1].' },
        { h: 'Volatility is a form of risk' },
        { p: 'Even when a company is not in danger of failing, its share price may fluctuate up or down [2]. Large-company shares as a group have lost money on average about one year in three [2]. Higher volatility means a wider range of possible outcomes, including over short periods.' },
        { h: 'Time horizon' },
        { p: 'An investor with a longer time horizon may be more comfortable with a more volatile investment, because they can wait out slow cycles and short-term drops [3]. Goals tied to a sound long-term plan typically survive short-term ups and downs [4]. Money you need soon is usually less suited to volatile investments.' },
        { h: 'In this app' },
        { p: 'Charts in Trade show how an instrument actually moved over the period you select. Alerts can notify you, inside the app, when a price moves by a percentage you choose — useful to stay informed without watching the screen.' },
      ],
      fr: [
        { p: 'La volatilité des prix mesure le niveau d’incertitude sur les marchés ou pour un instrument donné [1]. La volatilité historique se calcule en mesurant l’écart-type des prix d’un titre sur une période donnée [1].' },
        { h: 'Un exemple suisse : le VSMI' },
        { p: 'SIX publie le VSMI, lancé en 2005, qui mesure la volatilité implicite des options sur le SMI — autrement dit, la fluctuation anticipée par le marché des options [1].' },
        { h: 'La volatilité est une forme de risque' },
        { p: 'Même lorsqu’une entreprise n’est pas menacée de faillite, son cours peut fluctuer à la hausse comme à la baisse [2]. Les actions des grandes entreprises, prises ensemble, ont en moyenne perdu de l’argent environ une année sur trois [2]. Une volatilité plus élevée signifie un éventail de résultats plus large, y compris sur de courtes périodes.' },
        { h: 'L’horizon de placement' },
        { p: 'Un investisseur qui a un horizon long peut accepter plus facilement un placement plus volatil, car il peut attendre la fin des cycles lents et des baisses de court terme [3]. Des objectifs adossés à un plan solide de long terme résistent généralement aux hauts et bas de court terme [4]. L’argent dont vous aurez bientôt besoin se prête en général moins aux placements volatils.' },
        { h: 'Dans cette application' },
        { p: 'Les graphiques de Trade montrent comment un instrument a réellement évolué sur la période choisie. Les alertes peuvent vous prévenir, dans l’application, lorsqu’un cours varie du pourcentage que vous fixez — pratique pour rester informé sans surveiller l’écran.' },
      ],
    },
    sources: [
      { title: 'VSMI Volatility Indices', publisher: 'SIX', url: 'https://www.six-group.com/en/market-data/indices/global/strategy/vsmi-volatility.html' },
      { title: 'What is Risk?', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/investing-basics/what-risk' },
      { title: 'Beginners’ Guide to Asset Allocation, Diversification, and Rebalancing', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset' },
      { title: 'Investor Tips for Turbulent Markets', publisher: 'FINRA', url: 'https://www.finra.org/investors/insights/tips-turbulent-market' },
    ],
  },
  {
    id: 'wallet-security',
    theme: 'security',
    themeLabel: { en: 'Security', fr: 'Sécurité' },
    title: { en: 'Self-custody: keeping your crypto wallet safe', fr: 'Self-custody : protéger son wallet crypto' },
    intro: {
      en: 'With a self-custody wallet, you hold the keys. That brings control — and responsibility. The essential rules, and how a multi-signature wallet like My Wall spreads the risk.',
      fr: 'Avec un wallet en self-custody, c’est vous qui détenez les clés. Cela donne le contrôle — et la responsabilité. Les règles essentielles, et comment un wallet multisignature comme My Wall répartit le risque.',
    },
    readMin: 5,
    updated: UPDATED,
    body: {
      en: [
        { h: 'Your recovery phrase is the master key' },
        { p: 'Wallets often give you a seed (recovery) phrase to write down somewhere safe; it may be the only way to recover the wallet [1]. Never share your recovery phrase or private keys, for any reason: anyone who has them can access your accounts and drain every asset [2]. No legitimate service, support agent or website will ever ask you for them [2].' },
        { h: 'Transactions cannot be undone' },
        { p: 'A transaction sent on Ethereum is irreversible [2]. Check the recipient address and the amount before signing — a mistake or a scam cannot be reversed by a bank afterwards.' },
        { h: 'Beware of fake support' },
        { p: 'A common scam is impersonating the support staff of popular wallets [2]. Swissquote, for its part, states that it will never ask you to reveal your credentials or to install remote-access software such as AnyDesk [3].' },
        { h: 'Multi-signature: more than one key' },
        { p: 'A Safe smart account can have several owners, and you specify how many of them must approve a transaction before it is executed [4]. This threshold is the number of confirmations a transaction needs [4]. My Wall uses this model with three keys and a threshold of two: your device key, the Swissquote co-signer and a recovery key — so no single key can move funds alone.' },
        { h: 'Checklist' },
        { ul: ['Keep your recovery material offline and never type it into a website or a chat.', 'Verify the address and amount on every signature request.', 'Treat urgency, unexpected “support” contacts and remote-access requests as red flags.'] },
      ],
      fr: [
        { h: 'La phrase de récupération est la clé maîtresse' },
        { p: 'Les wallets fournissent souvent une phrase de récupération (seed) à noter en lieu sûr ; c’est parfois le seul moyen de récupérer le wallet [1]. Ne partagez jamais, sous aucun prétexte, votre phrase de récupération ni vos clés privées : quiconque les détient peut accéder à vos comptes et vider tous vos actifs [2]. Aucun service, agent de support ou site légitime ne vous les demandera [2].' },
        { h: 'Une transaction ne s’annule pas' },
        { p: 'Une transaction envoyée sur Ethereum est irréversible [2]. Vérifiez l’adresse du destinataire et le montant avant de signer : une erreur ou une arnaque ne peut pas être annulée après coup par une banque.' },
        { h: 'Méfiez-vous du faux support' },
        { p: 'Une arnaque fréquente consiste à se faire passer pour le support de wallets connus [2]. Swissquote indique de son côté qu’elle ne vous demandera jamais de révéler vos identifiants ni d’installer un logiciel d’accès à distance comme AnyDesk [3].' },
        { h: 'Multisignature : plus d’une clé' },
        { p: 'Un compte Safe peut avoir plusieurs propriétaires, et l’on fixe combien d’entre eux doivent approuver une transaction avant son exécution [4]. Ce seuil correspond au nombre de confirmations nécessaires [4]. My Wall applique ce modèle avec trois clés et un seuil de deux : la clé de votre appareil, le co-signataire Swissquote et une clé de récupération — aucune clé ne peut donc déplacer les fonds seule.' },
        { h: 'Check-list' },
        { ul: ['Gardez vos éléments de récupération hors ligne et ne les saisissez jamais sur un site ou dans une discussion.', 'Vérifiez l’adresse et le montant à chaque demande de signature.', 'L’urgence, un « support » qui vous contacte spontanément et les demandes d’accès à distance sont des signaux d’alerte.'] },
      ],
    },
    sources: [
      { title: 'Ethereum wallets', publisher: 'ethereum.org', url: 'https://ethereum.org/wallets/' },
      { title: 'Ethereum security and scam prevention', publisher: 'ethereum.org', url: 'https://ethereum.org/security/' },
      { title: 'Phishing: Tips to Identify and Avoid Scams', publisher: 'Swissquote', url: 'https://www.swissquote.com/en-ch/private/help/account-security/phishing' },
      { title: 'Glossary (Safe smart account, threshold)', publisher: 'Safe Docs', url: 'https://docs.safe.global/home/glossary' },
    ],
  },
  {
    id: 'order-types',
    theme: 'orders',
    themeLabel: { en: 'How markets work', fr: 'Fonctionnement des marchés' },
    title: { en: 'Market, limit, stop: choosing how your order is executed', fr: 'Au marché, à cours limité, stop : choisir comment son ordre s’exécute' },
    intro: {
      en: 'The order type decides whether you control the price or the execution. The three basic orders, the spread, and trading hours on the Swiss exchange.',
      fr: 'Le type d’ordre détermine si vous maîtrisez le prix ou l’exécution. Les trois ordres de base, le spread et les horaires de la Bourse suisse.',
    },
    readMin: 4,
    updated: UPDATED,
    body: {
      en: [
        { h: 'Market order' },
        { p: 'A market order is an order to buy or sell immediately. It guarantees that the order will be executed, but not the execution price [1].' },
        { h: 'Limit order' },
        { p: 'A limit order is an order to buy or sell at a specific price or better [1]. You control the price, but the order may not be executed if the market never reaches it.' },
        { h: 'Stop order' },
        { p: 'A stop order (or stop-loss) becomes an order to buy or sell once the price reaches a specified level [1]. When the stop price is reached, it becomes a market order [1] — so the final execution price can differ from the stop price in a fast market.' },
        { h: 'The spread' },
        { p: 'At any moment there is a bid price (what buyers offer) and an ask price (what sellers want). The bid is lower than the ask, and the difference is the spread [2] — a cost you pay implicitly when you buy at the ask and later sell at the bid.' },
        { h: 'Trading hours on SIX' },
        { p: 'On the Swiss Stock Exchange, the shares and investment funds segments trade from 09:00 to 17:30, with a closing auction from 17:20 to 17:30; ETFs, ETSFs and ETPs have a closing auction from 17:30 to 17:35 [3]. Outside these hours, prices shown for Swiss shares are the last ones from the regular session.' },
      ],
      fr: [
        { h: 'Ordre au marché' },
        { p: 'Un ordre au marché est un ordre d’achat ou de vente immédiat. Il garantit l’exécution, mais pas le prix d’exécution [1].' },
        { h: 'Ordre à cours limité' },
        { p: 'Un ordre à cours limité est un ordre d’achat ou de vente à un prix donné ou meilleur [1]. Vous maîtrisez le prix, mais l’ordre peut ne pas être exécuté si le marché n’atteint jamais ce niveau.' },
        { h: 'Ordre stop' },
        { p: 'Un ordre stop (ou stop-loss) devient un ordre d’achat ou de vente dès que le cours atteint un niveau fixé [1]. Une fois ce niveau atteint, il devient un ordre au marché [1] : dans un marché rapide, le prix d’exécution peut donc différer du prix stop.' },
        { h: 'Le spread' },
        { p: 'À chaque instant, il existe un prix acheteur (bid) et un prix vendeur (ask). Le bid est inférieur à l’ask, et la différence constitue le spread [2] — un coût implicite lorsque vous achetez à l’ask puis revendez au bid.' },
        { h: 'Horaires de SIX' },
        { p: 'À la Bourse suisse, les segments actions et fonds de placement se négocient de 09:00 à 17:30, avec une enchère de clôture de 17:20 à 17:30 ; pour les ETF, ETSF et ETP, l’enchère de clôture a lieu de 17:30 à 17:35 [3]. En dehors de ces horaires, les cours affichés pour les actions suisses sont les derniers de la séance ordinaire.' },
      ],
    },
    sources: [
      { title: 'Types of Orders', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work/types-orders' },
      { title: 'Mutual Fund and ETF Fees and Expenses – Investor Bulletin', publisher: 'Investor.gov (U.S. SEC)', url: 'https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/mutual-fund-and-etf-fees-and-expenses-investor-bulletin' },
      { title: 'Trading Hours', publisher: 'SIX Swiss Exchange', url: 'https://www.six-group.com/en/products-services/the-swiss-stock-exchange/trading/trading-provisions/trading-hours.html' },
    ],
  },
  {
    id: 'stablecoins',
    theme: 'stablecoins',
    themeLabel: { en: 'Stablecoins', fr: 'Stablecoins' },
    title: { en: 'Stablecoins: stable by design, not risk-free', fr: 'Les stablecoins : stables par conception, pas sans risque' },
    intro: {
      en: 'Stablecoins such as USDC aim to keep a fixed value against a currency. How they work, and the risks regulators point out.',
      fr: 'Les stablecoins comme l’USDC visent une valeur fixe par rapport à une monnaie. Leur fonctionnement, et les risques signalés par les régulateurs.',
    },
    readMin: 5,
    updated: UPDATED,
    body: {
      en: [
        { p: 'Stablecoins are tokens designed to stay at a fixed value, even when the price of ETH changes [1]. They promise to always be worth a fixed amount of a fiat currency, for example one dollar [2].' },
        { h: 'USDC, the stablecoin in My Wall' },
        { p: 'USDC is pegged to the US dollar and issued by Circle [1]. Circle describes it as a regulated digital currency that can be redeemed 1:1 for US dollars [3]. In this prototype, My Wall uses test USDC on the Sepolia test network, which has no monetary value.' },
        { h: 'Why “stable” is not “risk-free”' },
        { ul: ['Stablecoins trade on secondary markets at an exchange rate that can deviate from par [2].', 'Research by the BIS finds that par convertibility is resilient to small shocks but can fail under large negative shocks to the value of reserve assets [4].', 'The holder depends on the issuer and on the quality of the reserves or guarantees behind the token.'] },
        { h: 'The Swiss regulator’s view' },
        { p: 'In July 2024, FINMA published guidance on stablecoins [5]. It notes that various Swiss stablecoin issuers rely on default guarantees from banks, often without a FINMA banking licence, and that this creates risks for both stablecoin holders and the guaranteeing banks [5]. FINMA also highlights increased risks of money laundering, terrorist financing and sanctions circumvention [5].' },
      ],
      fr: [
        { p: 'Les stablecoins sont des jetons conçus pour garder une valeur fixe, même lorsque le prix de l’ETH varie [1]. Ils promettent de toujours valoir un montant fixe d’une monnaie officielle, par exemple un dollar [2].' },
        { h: 'L’USDC, le stablecoin de My Wall' },
        { p: 'L’USDC est arrimé au dollar américain et émis par Circle [1]. Circle le présente comme une monnaie numérique réglementée échangeable 1:1 contre des dollars américains [3]. Dans ce prototype, My Wall utilise de l’USDC de test sur le réseau de test Sepolia, sans valeur monétaire.' },
        { h: 'Pourquoi « stable » ne veut pas dire « sans risque »' },
        { ul: ['Les stablecoins s’échangent sur des marchés secondaires à un taux qui peut s’écarter de la parité [2].', 'Une étude de la BRI montre que la convertibilité au pair résiste aux petits chocs mais peut céder face à de fortes baisses de valeur des actifs de réserve [4].', 'Le détenteur dépend de l’émetteur et de la qualité des réserves ou des garanties derrière le jeton.'] },
        { h: 'Le point de vue du régulateur suisse' },
        { p: 'En juillet 2024, la FINMA a publié une communication sur les stablecoins [5]. Elle relève que plusieurs émetteurs suisses recourent à des garanties de défaillance bancaires, souvent sans licence bancaire FINMA, ce qui crée des risques pour les détenteurs comme pour les banques garantes [5]. La FINMA souligne aussi des risques accrus de blanchiment d’argent, de financement du terrorisme et de contournement des sanctions [5].' },
      ],
    },
    sources: [
      { title: 'Stablecoins explained', publisher: 'ethereum.org', url: 'https://ethereum.org/stablecoins/' },
      { title: 'III. The next-generation monetary and financial system (Annual Economic Report 2025)', publisher: 'Bank for International Settlements (BIS)', url: 'https://www.bis.org/publications/aer-2025/next-generation-monetary-financial-system' },
      { title: 'USDC', publisher: 'Circle', url: 'https://www.circle.com/usdc' },
      { title: 'Public information and stablecoin runs (Working Paper 1164)', publisher: 'Bank for International Settlements (BIS)', url: 'https://www.bis.org/publications/working-paper-1164-public-information-and-stablecoin-runs' },
      { title: 'FINMA publishes guidance on stablecoins', publisher: 'FINMA', url: 'https://www.finma.ch/en/news/2024/07/20240726-m-am-06-24-stablecoins/' },
    ],
  },
];
