# Owner's spec (verbatim, French) — "Accueil, marchés et wallet"

## 1. Préparation et règles communes
- Lis les instructions du dépôt, le README, les scripts de validation et les services concernés avant toute modification.
- Examine notamment `/sq`, `/sq/markets`, l'accueil, My Wall, l'écran de déverrouillage et l'écran Security.
- Réutilise les routes, fournisseurs et intégrations existants lorsqu'ils conviennent. Préserve les changements préexistants dans le dépôt.
- Prends les décisions courantes de manière autonome. Demande une clarification uniquement pour un blocage réel.
- Chaque contrôle présenté comme interactif doit avoir une action cohérente. Aucun lien vide, bouton décoratif ou message de réussite fictif.
- Sépare explicitement données réelles, estimations et démonstrations. Ne remplace jamais une panne par des valeurs inventées présentées comme réelles.
- N'exécute aucun ordre financier, paiement, transfert ou envoi de notification externe pendant le développement et les tests.
Implémente dans le produit existant. Conserve son architecture, ses composants et son identité visuelle. Ne refonds pas le design : limite les changements visuels aux corrections et fonctionnalités décrites ici.

## 2. Logos et en-têtes responsive
### Interface Swissquote
Sur `/sq` et `/sq/markets`, pour une largeur inférieure à 768 px :
- Utilise le logo fourni : `apps/web/public/brand/swissquote-logo.png`.
- Place-le bien visiblement en haut à gauche de l'en-tête, aligné verticalement avec les boutons ronds de recherche et de compte à droite.
- Vise une hauteur d'environ 44 px sur mobile, avec un minimum de 36 px à 360 px de largeur. Conserve les proportions originales et une marge autour.
- N'ajoute ni déformation, ni ombre, ni recadrage. Empêche le logo de disparaître, de se comprimer ou d'être coupé.
### My Wall et déverrouillage
- Dans l'en-tête mobile de My Wall, affiche le logo prévu par le projet accompagné de « My Wall ».
- Sur l'écran de déverrouillage, affiche le logo centré, avec une hauteur de 56 px et ses proportions conservées.
- Vérifie les largeurs 360, 390 et 430 px, ainsi que tablette et ordinateur.
- Mets à jour les captures concernées dans `docs/design/screens/`.
Cette correction des logos ne doit modifier aucun autre comportement.

## 3. Données réelles de marché — Trade et composants partagés
Remplace les cours, variations et graphiques fictifs de la partie Trade par des données provenant d'un fournisseur fiable. Utilise une intégration existante si possible ; sinon, choisis un fournisseur adapté aux instruments affichés et documente sa configuration.
Pour chaque instrument : identifiant exact, place de cotation lorsque pertinente et devise ; cours, variation et heure de dernière mise à jour ; préciser si la donnée est en temps réel, différée ou correspond à la dernière clôture ; historique réel pour les graphiques, les variations doivent correspondre à la période affichée ; respecter les horaires de marché, les jours de fermeture et les fuseaux horaires.
Partage cette couche de données entre Trade, Watchlist, les fiches d'instruments, les alertes et les widgets du wallet afin d'éviter des valeurs contradictoires.
Prévois une actualisation et un cache adaptés aux limites du fournisseur, ainsi que les états de chargement, d'erreur, d'indisponibilité et de données périmées. Affiche la fraîcheur des données en cache.
Garde les clés API côté serveur, dans les variables d'environnement, hors navigateur et hors Git. Si une clé indispensable manque, prépare l'intégration complète et indique précisément la configuration nécessaire. Ne déclare pas l'intégration opérationnelle sans avoir vérifié la récupération de données réelles.
N'invente jamais les soldes, positions ou performances d'un utilisateur pour compléter les données de marché.

## 4. Accueil : navigation et actions fonctionnelles
Fais l'inventaire des boutons, cartes, liens, filtres et onglets de l'accueil, puis rends leurs actions fonctionnelles :
- Un clic sur un actif ouvre sa fiche et son graphique avec les bonnes données.
- Les boutons de période changent réellement l'historique affiché.
- La recherche retrouve de vrais instruments.
- Les liens vers Trade, le wallet, le portefeuille et les autres sections ouvrent les bonnes destinations.
- Les filtres et onglets modifient effectivement le contenu.
- Les actions d'achat et de vente ouvrent le parcours existant avec le bon instrument présélectionné, sans exécuter d'ordre automatiquement.
Si une fonctionnalité n'est pas disponible, désactive son contrôle avec une explication explicite.

## 5. News et Inspiration : contenu et lecture
### News
Affiche des articles réels sur les marchés, entreprises, économie et crypto, provenant de sources fiables et identifiables, via une intégration ou un flux autorisé. Chaque carte : une image utilisable légalement, avec attribution si nécessaire ; le titre et un court résumé ; la source et la date de publication ; un lien vers l'article original. N'invente ni article, ni citation, ni source. Sans image disponible, utilise un visuel de remplacement clairement adapté, sans le présenter comme une photographie de l'événement.
### Inspiration
Crée des contenus pédagogiques utiles : diversification, ETF, frais, volatilité, sécurité des wallets et fonctionnement des marchés. Identifie les contenus créés comme éditoriaux de l'application. Source les affirmations factuelles. N'invente aucune performance et ne promets aucun rendement. Chaque carte comprend une image ou illustration, un titre, une introduction et un thème. Fournis un contenu développé à l'ouverture, avec les sources utiles.
### Vue de lecture commune
Au clic sur une carte News ou Inspiration : ouvre une vue occupant tout l'espace principal ; sur mobile, une vue plein écran. Permets de faire défiler le contenu intégral de cette vue. Affiche l'image, le titre, la source ou l'auteur éditorial, la date et le contenu disponible. Ajoute un bouton de retour et conserve la position de défilement de la liste au retour. Gère correctement le focus, la navigation au clavier et la fermeture.
Pour News, reproduis le texte intégral uniquement lorsque les droits du fournisseur le permettent. Sinon, affiche un résumé original utile avec un bouton « Lire l'article original ». Ne contourne pas les paywalls.

## 6. Watchlist : suivi d'instruments
Implémente l'ajout, la suppression, la recherche et la persistance des instruments suivis. Si l'utilisateur n'a aucune liste, propose une sélection de découverte clairement identifiée : indices, actions, ETF et cryptomonnaies connus. Ne présente pas cette sélection comme un choix déjà effectué par l'utilisateur. Pour chaque instrument : nom, symbole, devise, cours réel, variation, heure de mise à jour et caractère différé éventuel. Au clic, ouvre une fiche détaillée occupant l'espace principal, avec un graphique réel, des périodes sélectionnables, les informations sur l'instrument et les actions de suivi ou de création d'alerte.

## 7. Alerts : création et évaluation
Permets de créer, modifier, activer, désactiver et supprimer : une alerte de cours au-dessus ou en dessous d'un seuil ; une alerte de variation en pourcentage sur une période définie ; un rappel à une date et une heure précises. Affiche l'instrument, la condition, le statut et la date du dernier déclenchement lorsqu'elle existe. Au clic, ouvre une vue détaillée défilable avec la règle et l'historique disponible. Sans alertes existantes, propose des exemples crédibles à activer, marqués « Exemple — inactive ». Ne fabrique pas d'historique ou de déclenchement utilisateur. Évalue les règles avec les données disponibles et évite les notifications répétées pour un même franchissement. Précise si la surveillance fonctionne seulement lorsque l'application est ouverte. Ne promets pas une exécution en arrière-plan sans infrastructure correspondante.

## 8. Wallet : données masquées par défaut
À chaque nouvelle entrée dans le wallet, masque par défaut toutes les données financières personnelles : solde total, quantités détenues, valeurs des positions, performances personnelles et montants des transactions affichés.
- Propose un contrôle explicite pour les révéler après authentification biométrique via le mécanisme disponible.
- Permets de les masquer à nouveau immédiatement.
- Ne persiste pas un état « visible » qui révélerait automatiquement les données lors d'une prochaine entrée. Réutilise le cycle de verrouillage existant et documente le comportement choisi.
- Applique le masquage aux cartes, listes, graphiques personnels, axes, info-bulles et libellés accessibles ; un graphique ne doit pas permettre de déduire les fonds masqués.
- Les cours publics du marché peuvent rester visibles, mais les quantités et valorisations personnelles doivent rester cachées.
Respecte les garanties réelles de la plateforme : WebAuthn avec vérification utilisateur ne garantit pas toujours l'utilisation de la biométrie. Utilise l'authentification disponible sans prétendre détecter une biométrie si ce n'est pas possible. Sans méthode compatible, garde les données masquées et explique comment en configurer une.

## 9. Security : corriger l'interrupteur de gel
Corrige l'interrupteur « Freeze co-signing » / « Geler la signature » dans l'écran Security : le cercle doit rester à l'intérieur de la piste dans les deux états, sans dépasser le cadre lorsqu'il est activé. Vérifie les dimensions, l'alignement, la translation et le comportement au redimensionnement. Réutilise le style actuel et les conventions de l'interrupteur existant. Préserve l'authentification, la persistance et le refus réel de co-signature lorsque le wallet est gelé. Cette correction est visuelle et ne doit pas affaiblir la protection.

## 10. Widget : liste défilable des cryptos détenues
Ajoute dans le wallet un widget permettant de parcourir toutes les cryptomonnaies effectivement détenues, avec défilement adapté à l'espace disponible. Pour chaque actif, lorsque les fonds sont déverrouillés : nom, symbole et réseau si nécessaire ; quantité détenue ; valeur totale de la position dans la devise du portefeuille ; prix de marché à l'unité ; une flèche et un pourcentage indiquant la hausse ou la baisse sur une période explicitement indiquée, par exemple 24 h. Les flèches reflètent la variation du prix de marché, pas un rendement personnel inventé. Ne repose pas uniquement sur la couleur pour communiquer la direction. Prévois les valeurs stables, les prix indisponibles et les petits soldes. Un clic sur une ligne ouvre le détail du bon actif. Réutilise les soldes réels du wallet et le fournisseur de marché partagé. Respecte le masquage par défaut.

## 11. Widget : courbes du portefeuille et des actifs
Ajoute un widget graphique avec deux niveaux : 1. Vue globale : évolution de la valeur totale du wallet dans sa devise de référence. 2. Vue par actif : évolution de la valeur de chaque position, accessible depuis un sélecteur ou la liste des cryptos.
Propose les périodes adaptées aux historiques disponibles, par exemple 24 h, 7 j, 1 mois et 1 an. Les contrôles doivent changer réellement les données. Affiche les dates et valeurs dans les info-bulles après déverrouillage.
Construis l'historique personnel à partir des positions historiques et des prix correspondants, ou d'instantanés de portefeuille réellement enregistrés. Ne multiplie pas simplement les quantités actuelles par des prix historiques en présentant le résultat comme l'histoire réelle du portefeuille.
Si l'historique personnel manque, affiche un état explicite et commence à enregistrer des instantanés selon les mécanismes du projet. Tu peux proposer séparément une courbe du prix de marché d'un actif, clairement identifiée comme telle.
Distingue évolution de valorisation et rendement : les dépôts, retraits et transferts modifient la valeur du wallet sans représenter un gain ou une perte de marché. Ne présente un rendement que si les flux sont correctement pris en compte.
Respecte le masquage des données personnelles, le responsive et les états de chargement ou d'historique insuffisant.

## 12. Démonstration et états de l'interface
Tu peux fournir des données fictives plausibles pour les démonstrations et tests, mais identifie ce mode explicitement. Les articles sourcés et les cours affichés comme réels doivent être vérifiables. Pour chaque section, prévois les états : chargement, contenu disponible, absence de contenu, erreur et données périmées. Rends les cartes et commandes accessibles au clavier et fonctionnelles sur ordinateur et mobile.

## 13. Sécurité serveur : CORS, CSRF et routes de reset
Audite tous les serveurs et endpoints exposés au navigateur, notamment les routes de reset, les opérations sensibles et le co-signataire.
- Remplace le CORS ouvert par une liste explicite d'origines autorisées, configurable par environnement. Ne reflète pas automatiquement l'origine reçue et n'utilise pas de wildcard avec credentials.
- Autorise uniquement les méthodes et en-têtes nécessaires. Gère correctement les requêtes preflight et refuse les origines non autorisées sur les opérations sensibles.
- Une configuration CORS ne remplace pas l'authentification ni la protection CSRF : une requête malveillante peut être envoyée même si le navigateur empêche de lire sa réponse.
- Exige une authentification et une autorisation côté serveur pour chaque opération sensible. Pour les sessions par cookie, utilise une protection CSRF adaptée et des cookies Secure, HttpOnly et SameSite appropriés.
- Aucun reset ni changement d'état ne doit être déclenchable par GET. Protège les resets par une réauthentification adaptée ; désactive les routes de reset de démonstration en production.
- Préserve les appels légitimes entre les services avec une authentification dédiée. Ne traite pas un en-tête Origin comme une preuve d'identité pour les clients non navigateur.
- Teste une origine autorisée, une origine hostile, un appel non authentifié, une tentative CSRF et les routes de reset. Vérifie que le refus survient avant tout changement d'état.

## 14. Langue : anglais par défaut
L'interface doit être en anglais par défaut, y compris lors de la première visite. Cette consigne remplace les exemples de libellés français dans les sections précédentes : adapte-les en anglais naturel.
- Applique ce choix à l'accueil, Trade, News, Inspiration, Watchlist, Alerts, My Wall, Security, aux formulaires, validations, états vides, info-bulles, notifications et exports générés.
- Réutilise le système d'internationalisation existant. Si un sélecteur de langue existe, conserve la possibilité de choisir le français et persiste le choix explicite.
- N'impose pas le français selon la langue du navigateur ou la localisation suisse.
- Conserve les devises et fuseaux horaires appropriés ; une interface anglaise ne signifie pas remplacer CHF par USD.
- Ne présente pas un article source français comme traduit si son contenu ne l'est pas. Indique sa langue lorsque nécessaire.

## 15. Transferts à des tiers et Travel Rule
Dans le parcours d'envoi, distingue explicitement « My own wallet » et « Someone else's wallet ». Pour un tiers, ajoute les champs relatifs au bénéficiaire et les vérifications nécessaires avant confirmation.
La demande de nom au-dessus d'environ 1 000 CHF est une hypothèse du brief, pas une règle de conformité suisse suffisante à elle seule. Vérifie les exigences applicables au type d'établissement, au transfert et au destinataire à partir des sources officielles FINMA et du cadre légal en vigueur. Ne confonds pas un seuil d'identification avec l'ensemble des obligations Travel Rule.
Références de départ : FINMA, Payments on the blockchain : https://www.finma.ch/en/news/2019/08/20190826-mm-kryptogwg/ ; FINMA, révision de l'ordonnance anti-blanchiment et seuil de 1 000 CHF pour certaines opérations liées : https://www.finma.ch/news/2022/11/20221102-mm-gwv-finma/
Pour la démonstration produit, prévois un seuil configurable de collecte renforcée initialisé à 1 000 CHF, déclenché à partir de ce montant inclus, sans permettre que ce seuil désactive des obligations plus strictes applicables. Au minimum, demande le nom complet du bénéficiaire dans ce parcours. Explique que collecter un nom ne suffit pas à attester la conformité.
Calcule la contre-valeur CHF avec un cours réel horodaté et vérifie la règle côté serveur. Si le cours manque, ne considère pas automatiquement l'opération comme inférieure au seuil. Revalide le bénéficiaire, les informations et la contre-valeur avant signature. Prends en compte les opérations liées lorsque le cadre applicable l'exige.
Conçois les contrôles de conformité comme une politique serveur configurable et auditable. Si les informations ou l'intégration de transmission nécessaires sont absentes, ne présente pas le transfert comme conforme et bloque les opérations réelles soumises à cette exigence. Un mode démo doit être identifié explicitement.
Protège les données personnelles : accès restreint, absence dans les logs publics ou sur la blockchain, conservation documentée. Ne prétends pas fournir une intégration Travel Rule réelle si seule la collecte locale est implémentée.

## 16. Vérification d'un wallet externe du client
Permets au client de connecter un wallet externe compatible, par exemple MetaMask, puis de prouver le contrôle de son adresse en signant un message, sans transaction ni frais réseau.
- Génère le challenge côté serveur : domaine, URI, adresse, réseau, nonce aléatoire, date de création et expiration. Utilise un standard adapté tel que Sign-In with Ethereum pour les wallets EVM.
- Affiche un message lisible expliquant la preuve demandée. Ne demande jamais de seed phrase, clé privée, approbation de token ou signature de transaction pour cette vérification.
- Vérifie la signature côté serveur et lie le résultat au client authentifié et à l'adresse précise. Consomme le nonce une seule fois et empêche le rejeu.
- Gère le refus, l'expiration, le changement de compte ou de réseau et la révocation du lien. Prends en charge la validation des signatures de comptes contractuels si ces wallets sont acceptés.
- Conserve la date et la méthode de vérification. Présente le résultat comme une preuve de contrôle de l'adresse à cet instant, pas comme une preuve autonome d'identité ni une attestation de conformité réglementaire.

## 17. Relevé annuel et export CSV
Ajoute une section de documents permettant de choisir une année et de télécharger un relevé annuel destiné à aider la déclaration fiscale suisse, ainsi qu'un export CSV de l'historique.
### Relevé annuel
Présente, pour le 31 décembre de l'année choisie : les actifs, réseaux, quantités réellement détenues à la date de référence, cours de valorisation CHF, source, date du cours et total de la fortune crypto couverte par l'application.
Vérifie les conventions et cours fiscaux officiels suisses applicables. Privilégie les valeurs publiées par l'autorité fiscale lorsqu'elles existent ; sinon, documente la méthode de remplacement et indique les valeurs manquantes ou estimées. Ne présente pas automatiquement le dernier cours du marché comme le cours fiscal officiel.
Définis explicitement la date de coupure et le fuseau Europe/Zurich. Reconstruis les soldes historiques à partir des transactions ou instantanés fiables, jamais à partir du seul solde actuel. Signale un historique incomplet et le périmètre des wallets couverts. N'invente pas une valeur nulle pour une donnée absente.
Le document doit être lisible, imprimable et téléchargeable, avec identification du compte, année, méthode et limites. Il s'agit d'un relevé d'aide à la déclaration, sans prétendre être une attestation fiscale officielle Swissquote si ce statut n'existe pas.
### Historique CSV
Exporte toutes les transactions de la période choisie, au-delà de la pagination visible : date et fuseau, type, réseau, actif, quantité, sens, frais avec devise, adresses publiques concernées, hash de transaction, statut et contre-valeur CHF lorsqu'elle est disponible, avec sa méthode.
Utilise un encodage UTF-8, des colonnes stables, des dates explicites et une précision adaptée aux cryptos. Échappe correctement les champs et protège contre les formules injectées dans les tableurs. N'exporte jamais de secrets ni les données personnelles de bénéficiaires sans nécessité.
Exige une authentification pour les exports contenant des données financières personnelles. Si les fonds sont masqués, exige leur déverrouillage avant téléchargement. Teste les soldes de fin d'année, les changements de fuseau, les historiques incomplets et l'exhaustivité du CSV.

## 18. QR code de réception
Dans l'écran Receive, affiche un QR code de l'adresse publique de réception du wallet sélectionné, avec réseau, adresse lisible et bouton de copie.
- Encode uniquement l'adresse publique par défaut. Si un format d'URI de paiement standard est utilisé, documente sa compatibilité et le réseau inclus.
- N'encode jamais de clé privée, phrase de récupération, code de secours, secret de session ou keystore. L'interdiction des QR de clés ne concerne pas les adresses publiques de réception.
- Mets à jour le QR lorsque le wallet ou le réseau change. Évite toute ambiguïté de réseau et indique les actifs compatibles.
- Vérifie le décodage du QR, la correspondance exacte de l'adresse, la lisibilité mobile et les fonctions de copie ou téléchargement.

## 19. Supprimer les taux crypto fixes
Complète la couche de données de marché de la section 3 pour toutes les valorisations crypto et conversions CHF du wallet. Supprime notamment les constantes du type « 1 ETH = 2 900 CHF » des parcours réels.
Utilise des cours réellement récupérés, horodatés et actualisés selon les limites du fournisseur. Distingue un cours indicatif de valorisation d'une cotation exécutable pour un échange. Les calculs de portefeuille, widgets, seuils et aperçus doivent utiliser des données cohérentes avec leur usage.
Sans cours récent, affiche l'indisponibilité ou la dernière valeur connue avec sa date ; n'invente pas de taux. Les taux fixes sont autorisés uniquement dans des fixtures de test ou un mode démo explicitement identifié. Pour le relevé fiscal, utilise les valeurs historiques adaptées de la section 17, pas le cours actuel.

## 20. Deux versions visualisables : Web et App
Je veux conserver la version web et disposer en plus d'une version application mobile que je puisse lancer et visualiser. Ajoute un switch de prévisualisation « Web / App » accessible facilement pour moi, dans un espace de développement ou de démonstration discret.
### Version Web
Conserve le site et ses parcours sur ordinateur, tablette et navigateur mobile. Le switch ne doit pas casser ses routes, ses données ou ses fonctionnalités.
### Version App
Crée une cible application mobile distincte, en réutilisant autant que possible les services, types, composants et fonctionnalités du projet. Choisis la solution adaptée à l'architecture existante : par exemple une application hybride avec Capacitor si le projet web s'y prête, ou une cible mobile existante si elle est déjà présente.
Ne considère pas une simple réduction de la largeur du navigateur comme une application livrée. Il faut une cible app réellement lançable, avec une configuration, une commande de démarrage et un aperçu utilisable.
Adapte les parcours à l'usage mobile : zones sûres de l'écran, navigation, retour, clavier, défilement, tailles des commandes et authentification compatible avec la plateforme. Préserve les fonctionnalités demandées dans ce prompt, notamment les marchés, contenus, watchlists, alertes, wallet et masquage des fonds.
### Switch de visualisation
- « Web » affiche ou ouvre la version web.
- « App » ouvre la prévisualisation de la version application, avec une présentation mobile permettant de parcourir les écrans et de tester les interactions.
- Identifie clairement le mode actif et permets de revenir facilement à l'autre version.
- Si l'aperçu intégré utilise un cadre de téléphone dans le navigateur, indique qu'il s'agit d'un aperçu. Relie-le aux écrans réellement utilisés par la cible app ; ne crée pas une maquette parallèle déconnectée du produit.
- Fournis également un moyen de lancer l'application dans un simulateur ou sur un appareil compatible, selon les outils disponibles.
- Les deux versions doivent utiliser les mêmes services et règles métier. Ne crée pas des données utilisateur contradictoires entre les deux.
Le switch est un outil de prévisualisation pour le propriétaire du projet ; il ne doit pas ajouter un choix technique inutile au parcours des clients en production.
### Configuration, sécurité et validation
Adapte les origines autorisées, sessions, redirections, liens profonds et intégrations de wallets au contexte mobile, sans rouvrir CORS à tous les sites. Aucun secret ne doit être embarqué dans l'application. N'utilise pas la disponibilité d'une API navigateur comme preuve qu'elle fonctionne également dans une WebView native : vérifie notamment les passkeys, la biométrie et la connexion à un wallet externe.
Documente les commandes pour lancer Web, ouvrir l'aperçu App et lancer la cible mobile. Prépare les configurations nécessaires pour iOS et Android lorsque la solution choisie les prend en charge.
Teste le switch et les principaux parcours dans les deux versions. Si le SDK, le simulateur, la signature de développement ou un appareil manque, termine les éléments réalisables, indique exactement le prérequis restant et distingue l'aperçu fonctionnel d'une compilation mobile effectivement vérifiée.
Ne publie rien sur un store et ne déploie pas.

## 21. Vérifications et livraison
Exécute les vérifications pertinentes du dépôt, notamment typecheck, tests et `npm run e2e`. Ajoute des tests ciblés pour les comportements importants et les régressions, sans tests superficiels qui reproduisent l'implémentation. Mets à jour les captures dans `docs/design/screens/` et documente les fournisseurs, variables d'environnement, sources, délais des données, limites de surveillance et méthode de construction de l'historique du portefeuille. Aucun secret, fichier `.env`, clé API ou donnée privée dans le commit. Pas de push, pas de déploiement. Ne prétends pas qu'un contrôle a réussi s'il n'a pas été exécuté.
