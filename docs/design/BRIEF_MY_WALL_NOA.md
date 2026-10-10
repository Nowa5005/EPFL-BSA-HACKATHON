# Brief pour Claude — refonte du prototype Swissquote « My Wall »

## 1. Ta mission et le livrable attendu

Claude, reprends le prototype de wallet déjà réalisé et produis un **nouveau document `.md` complet, structuré et directement exploitable pour refaire la démo**. Le wallet précédemment nommé **SQ Wallet** s’appelle désormais **My Wall**. Remplace l’ancien nom dans les écrans, titres, navigation, messages et documents générés.

L’objectif est de présenter un parcours crédible : l’utilisateur commence dans une reproduction virtuelle de l’interface Swissquote, ouvre son wallet, puis retrouve un espace qui prolonge naturellement le même univers visuel. La démo doit fonctionner aussi bien sur ordinateur que sur téléphone, avec des compositions adaptées à chaque écran.

Ne te limite pas à reformuler ce brief : décris les écrans, leur hiérarchie, les composants, les états, les interactions, les règles de validation et les critères de réussite. Conserve les fonctionnalités pertinentes du prototype existant, tout en appliquant les changements demandés ici. Si le prototype ou ses spécifications ne sont pas accessibles, identifie précisément les éléments à vérifier au lieu d’inventer ce qu’ils contiennent.

### Livrables demandés dans ton nouveau `.md`

1. Vision du produit et périmètre de la démonstration.
2. Direction artistique issue des deux références ci-dessous.
3. Plan des écrans et des parcours.
4. Spécifications ordinateur et téléphone pour chaque écran.
5. Création de compte, vérification d’identité, déverrouillage et récupération.
6. Gestion des clés et export chiffré.
7. Transactions, animations de confirmation et justificatifs.
8. Informations, documents et organisation des widgets.
9. Scénario de démonstration complet.
10. Ordre de réalisation et checklist de validation.

## 2. Références visuelles à utiliser

Ces deux images doivent rester incluses dans le document et accompagner le fichier lors de son transfert. Elles sont la référence prioritaire pour la direction artistique. Les valeurs de couleurs et de rayons proposées plus bas sont des points de départ à ajuster visuellement, pas une charte officielle.

### Référence A — interface Swissquote

![Application Swissquote — référence de composition, couleurs et navigation](assets/swissquote-application.png)

À observer : fond très clair légèrement froid, surfaces blanches, texte gris foncé, touches orange, listes de valeurs financières, variations vertes et rouges, icônes au trait, onglet actif souligné en orange, filtres compacts, chevrons discrets et navigation inférieure sobre. L’image représente principalement une page de marchés ; la page d’accueil ou de menu de la démo devra donc être une extrapolation cohérente, explicitement présentée comme telle.

### Référence B — logo fourni

![Logo Swissquote fourni — symbole blanc sur disque orange](assets/swissquote-logo.png)

Utilise le fichier fourni, sans redessiner approximativement le symbole, modifier ses proportions ou ajouter des effets décoratifs. Préserve la lisibilité et les marges autour du logo.

## 3. Identité du produit et direction artistique

### 3.1 Nom et textes

- Nom du wallet : **My Wall**.
- Point d’entrée mobile : **Mon wallet**, sur une languette en bas de l’écran Swissquote.
- Point d’entrée ordinateur : bouton **Mon wallet**, près de l’icône de compte.
- À l’intérieur du wallet, utiliser « My Wall » comme titre et « Mon wallet » comme libellé fonctionnel lorsque nécessaire.
- Interface et messages de la démo en français, avec une terminologie cohérente.

### 3.2 Atmosphère visuelle

Le résultat doit être sobre, sérieux, financier et directement reconnaissable comme un prolongement de la référence Swissquote. Éviter les grosses illustrations, les effets ludiques, les dégradés décoratifs, les cartes disproportionnées et les interfaces entièrement composées de capsules.

Palette de départ à vérifier sur les images : orange proche de `#FF5A32`, blanc, fond gris très clair légèrement bleuté, texte anthracite, gris secondaire. Réserver le vert et le rouge aux états ou variations qui le justifient ; toujours accompagner la couleur d’un texte, d’un signe ou d’une icône.

Utiliser une police sans empattement lisible, des montants bien alignés et une hiérarchie claire entre solde, devise, libellé et information secondaire. Les soldes sont les éléments les plus visibles du wallet, pas les illustrations.

### 3.3 Icônes et émoticônes

Supprimer les émojis colorés et les gros pictogrammes ludiques. Le souhait de conserver des « émoticônes » doit se traduire par de petits symboles d’état et des icônes sobres : coche, flèche, cadenas, document, information, compte, transfert. Utiliser un ensemble homogène d’icônes vectorielles au trait, adapté au style de Swissquote.

La confirmation de transaction constitue une exception précise : **un disque orange avec une petite coche blanche**, animé brièvement.

### 3.4 Arrondis, boutons et navigation

Ne pas mettre de grands arrondis partout. Reprendre le degré d’arrondi visible dans la capture : cartes légèrement arrondies, badges financiers plus rectangulaires, filtres éventuellement en capsule lorsque la référence le justifie. Définir quelques rayons cohérents, puis les ajuster par comparaison avec l’image.

Reprendre les boutons orange, les soulignements d’onglet, les chevrons et les transitions latérales discrètes. Chaque changement de page doit rester compréhensible. Sur ordinateur, les interactions de glissement disposent aussi de commandes explicites utilisables avec une souris et un clavier.

## 4. Architecture des écrans

Prévoir au minimum les espaces suivants :

| Espace | Fonction |
|---|---|
| Interface Swissquote reconstituée | Point de départ de la démo et accès à My Wall |
| Création / activation | Identité, mot de passe, questions et préparation du wallet |
| Déverrouillage | Accès sécurisé au wallet déjà configuré |
| Vue principale My Wall | Soldes, devises, actions et widgets |
| Transactions | Historique, statuts, filtres et détails |
| Informations | Transactions, marché crypto et mises à jour |
| Clés et sécurité | Révélation temporaire, copie et export chiffré |
| Swaplet — Documents | Classement et téléchargement des justificatifs |
| Paramètres | Préférences et sécurité du compte |

Le terme **Swaplet** est conservé pour l’espace demandé. Son articulation avec le prototype existant est à vérifier : ne pas le renommer ou le supprimer sans raison. Créer dans cet espace une rubrique **Documents**, reliée aux transactions de My Wall.

## 5. Parcours Swissquote → My Wall

### 5.1 Reconstitution virtuelle de Swissquote

Recréer dans le prototype une interface de départ inspirée fidèlement de la capture : structure des onglets, listes de marchés, navigation, recherche, compte, couleurs et densité visuelle. Réutiliser le logo fourni là où il est pertinent, sans prétendre que son emplacement est visible sur la capture.

Prévoir une page de menu ou d’accueil de démonstration cohérente avec cette référence. Les contenus financiers doivent être des données de démonstration identifiées comme telles. La démo doit permettre de comprendre le passage de l’application au wallet sans rupture graphique.

### 5.2 Sur téléphone

1. Afficher une petite languette **Mon wallet** en bas de l’interface Swissquote, sans masquer les éléments essentiels de la navigation.
2. L’utilisateur tire la languette vers le haut.
3. Un panneau de wallet apparaît avec une animation verticale courte et fluide.
4. Demander le déverrouillage ou proposer la création / activation si nécessaire.
5. Après validation, afficher My Wall dans la même continuité visuelle.

La languette doit aussi être activable par un toucher simple pour que le glissement ne soit pas obligatoire. Respecter les zones de sécurité du téléphone et éviter les conflits entre le geste d’ouverture, le défilement et les gestes du système.

### 5.3 Sur ordinateur

Placer un bouton **Mon wallet** à côté de l’icône de compte. Au clic, ouvrir la page My Wall et son étape de déverrouillage. Garder une navigation claire permettant de revenir à l’interface Swissquote.

### 5.4 Déverrouillage

Le parcours courant demande le code ou le mot de passe de déverrouillage prévu pour le wallet. Une importation par clé ou phrase de récupération doit être un parcours distinct, explicitement choisi ; ne pas demander une clé privée à chaque ouverture.

Dans la démo, utiliser des identifiants et des clés fictifs. Prévoir les états : formulaire vide, saisie incorrecte, validation en cours, réussite et nouvelle tentative.

## 6. Mise en page adaptative : ordinateur et téléphone

### 6.1 Principe général

Détecter l’espace disponible et les capacités d’interaction pour choisir la composition adaptée. Ne pas se limiter à réduire une page ordinateur ou à étirer une page mobile. Prévoir également les dimensions intermédiaires et le changement d’orientation.

Les mêmes informations et fonctionnalités doivent exister sur les deux versions. Leur disposition, leur densité et leur navigation peuvent changer pour conserver une expérience cohérente.

### 6.2 Soldes et devises en haut

Sur les deux supports, afficher les devises et soldes en grand dans la partie supérieure : total du portefeuille, devise de référence, actifs principaux, quantités et contre-valeurs clairement distinguées.

Sur ordinateur, répartir les actifs principaux horizontalement dans un espace supérieur lisible. Sur téléphone, afficher le solde principal et des actifs facilement consultables, sans texte minuscule ni débordement horizontal de toute la page. Les actions principales restent immédiatement accessibles.

### 6.3 Volet de contenu qui remonte

Sous les soldes, placer le reste du wallet dans un volet qui semble remonter lors du défilement. Sur téléphone, le volet peut être manipulé par glissement, avec une poignée discrète ; sur ordinateur, le même effet se produit naturellement avec la molette, le pavé tactile ou le clavier.

Prévoir un état initial où les soldes dominent, puis un état développé où les transactions et widgets prennent davantage de place. Conserver un rappel compact du solde lorsque le volet couvre la zone supérieure. Le contenu doit rester entièrement accessible sans geste complexe ni blocage du défilement.

### 6.4 Répartition des widgets

| Élément | Ordinateur | Téléphone |
|---|---|---|
| Soldes et devises | Zone supérieure large, actifs répartis horizontalement | Solde dominant, actifs compacts et consultables |
| Actions principales | Groupe visible près des soldes | Actions immédiatement accessibles sous le solde |
| Transactions | Panneau principal large ou tableau lisible | Liste compacte, détail sur écran dédié |
| Informations | Plusieurs colonnes équilibrées par catégorie | Onglets ou filtres, puis cartes compactes |
| Documents | Liste structurée avec filtres et aperçu | Liste simple, détail et téléchargement accessibles |
| Sécurité | Panneau secondaire ou espace dédié | Écran dédié, sans surcharger l’accueil |

Sur ordinateur, éviter une unique colonne interminable. Utiliser une grille avec un panneau principal et des panneaux secondaires adaptés aux informations. Sur téléphone, organiser le contenu par priorité et catégorie, sans reproduire toutes les cartes ordinateur les unes sous les autres sans hiérarchie.

## 7. Création de compte et vérification d’identité

Ajouter une demande de **carte d’identité** lors de la création du compte ou de la première activation du wallet. Distinguer cette vérification initiale du déverrouillage quotidien : un compte déjà vérifié ne doit pas devoir transmettre sa carte à chaque ouverture.

Prévoir les étapes : explication de la demande, ajout du document, recto / verso si nécessaire, aperçu, envoi, vérification en cours, acceptation et refus avec motif compréhensible. Afficher le statut de vérification dans le profil.

Pour la démonstration, simuler le contrôle avec des documents fictifs et ne pas collecter de véritables pièces d’identité. Dans le `.md`, distinguer explicitement les états simulés de la future intégration de vérification d’identité, dont le service, la conservation et les accès devront être définis avant une utilisation réelle.

## 8. Mot de passe : règles précises

Remplacer le minimum actuel de huit caractères par **quinze caractères minimum**. Proposition concrète à implémenter dans la démo et à rendre explicite dans le `.md` :

- Au moins **15 caractères** au total.
- Au moins **5 lettres**, dont **1 majuscule et 1 minuscule**.
- Au moins **2 chiffres**.
- Au moins **1 caractère spécial**.
- Ne pas contenir le prénom ou le nom de la personne, après normalisation de la casse et des accents.
- Ne pas contenir sa date de naissance dans les formats courants, avec ou sans séparateurs : `JJMMAAAA`, `AAAAMMJJ`, `JJMMAA`, ainsi que les variantes avec `/`, `-` ou `.`.
- Autoriser les mots de passe longs, le collage et les gestionnaires de mots de passe.

Ces nombres sont une proposition destinée à préciser la demande ; les conserver comme règles définies de la démo sauf instruction contraire. Ne pas présenter cette composition comme une garantie suffisante de sécurité.

Afficher la checklist des exigences pendant la saisie, un bouton afficher / masquer, une confirmation du mot de passe et des erreurs précises. Exemple : « Utilisez au moins 15 caractères, dont 5 lettres, 2 chiffres et 1 caractère spécial. »

Les vérifications de données personnelles utilisent les informations du compte, sans afficher ces informations sensibles dans les messages d’erreur. Dans une version réelle, les contrôles doivent également être appliqués côté serveur lorsque l’architecture le nécessite, avec stockage sécurisé, limitation des tentatives et protection des sessions. Ne pas inventer de mécanisme cryptographique maison.

## 9. Questions de récupération : 3 choix parmi 15

Créer **trois emplacements**, chacun avec une liste des mêmes quinze questions. Lorsqu’une question est choisie dans un emplacement, elle disparaît des choix des deux autres. Si le choix est changé ou retiré, la question redevient disponible ailleurs. Les trois questions doivent donc toujours être distinctes.

Les trois questions du prototype précédent ne sont pas jointes à ce brief. La liste suivante est une proposition dans un style personnel et mémoriel ; la rapprocher de leur ton si elles sont accessibles.

1. Quel surnom utilisiez-vous pendant votre enfance ?
2. Quel était le nom de votre premier animal de compagnie ?
3. Quel était le nom de votre école primaire ?
4. Dans quelle rue habitiez-vous pendant votre enfance ?
5. Quel était le prénom de votre premier meilleur ami ?
6. Quel était le nom de votre premier professeur marquant ?
7. Quelle destination avez-vous visitée lors de vos premières vacances dont vous vous souvenez ?
8. Quel était le titre de votre livre préféré pendant votre enfance ?
9. Quel était le premier concert auquel vous avez assisté ?
10. Quel était le nom de votre premier club sportif ou de loisirs ?
11. Quel plat aimiez-vous particulièrement pendant votre enfance ?
12. Quel était le modèle de votre premier vélo ?
13. Quel était le premier film que vous avez vu au cinéma ?
14. Quel était le nom du lieu où vous avez exercé votre premier emploi ?
15. Quel endroit fréquentiez-vous le plus après l’école ?

Prévoir trois réponses obligatoires, masquées par défaut, avec validation claire et sans divulgation dans les journaux. Définir une normalisation cohérente des réponses afin d’éviter les échecs dus à des espaces accidentels.

Ces questions sont conservées conformément à la demande, mais **ne doivent pas constituer à elles seules un mécanisme réel de récupération du wallet ou de ses clés**. Le `.md` doit prévoir un contrôle supplémentaire adapté à l’architecture retenue et préciser ce qu’il est possible de récupérer : accès au compte, accès à un fichier chiffré ou contrôle du wallet. Ne pas promettre la récupération de clés perdues sans mécanisme prévu.

## 10. Clés : masquées, consultables et exportables, sans QR code

### 10.1 Règle absolue

**Aucun QR code pour les clés, la phrase de récupération ou leur export.** Les clés doivent être gérées sous forme de texte masqué ou dans un fichier chiffré.

### 10.2 Consultation temporaire

- Masquer les clés par défaut.
- Bouton **Afficher temporairement**.
- Demander une nouvelle authentification avant de révéler un secret.
- Révéler pendant **30 secondes**, avec compte à rebours visible.
- Proposer **Masquer maintenant**.
- Remasquer à expiration, au départ de la page ou lorsque l’application passe en arrière-plan.
- Ne pas enregistrer les secrets dans les historiques, les notifications ou les journaux.

Distinguer clairement adresse publique, clé privée et éventuelle phrase de récupération. Ne pas utiliser le terme générique « clé » partout si les conséquences diffèrent.

### 10.3 Copie

Prévoir **Copier** après authentification, avec un message discret confirmant la copie. Indiquer que le presse-papiers contient temporairement une donnée sensible. Une tentative d’effacement après délai peut être prévue, sans promettre son succès sur toutes les plateformes.

### 10.4 Fichier chiffré

Prévoir **Télécharger une sauvegarde chiffrée** et un parcours **Importer / déchiffrer une sauvegarde**. L’utilisateur choisit un mot de passe de sauvegarde, le confirme, télécharge le fichier, puis peut démontrer son déchiffrement avec ce mot de passe.

Spécifier qu’une version réelle utilise un format documenté, un chiffrement authentifié et une dérivation de clé éprouvée, via des bibliothèques adaptées. Le fichier ne contient aucun secret en clair. Expliquer que la perte du mot de passe de sauvegarde peut empêcher son déchiffrement.

La démo utilise uniquement de faux secrets et doit annoncer clairement si le chiffrement est simulé. Si le chiffrement est réellement implémenté, vérifier l’importation, le mauvais mot de passe et un fichier altéré. Ne pas afficher un bouton d’export prétendument sécurisé qui télécharge en réalité du texte brut.

## 11. Transactions et confirmation animée

### 11.1 Exemple demandé : réception d’USDC

Lorsqu’une réception d’USDC est confirmée :

1. Mettre à jour le solde et l’historique.
2. Faire apparaître une animation brève : **disque orange, petite coche blanche**.
3. Afficher un texte, par exemple « Réception confirmée — 250 USDC ».
4. Sous la confirmation, proposer **Voir le justificatif** et **Télécharger**.
5. Classer automatiquement le justificatif dans les documents de transactions et dans **Swaplet → Documents**.

Les 250 USDC constituent une donnée de démonstration. La confirmation peut prendre la forme d’une couche légère dans l’écran ou d’un panneau intégré, sans imposer une fenêtre modale qui bloque tout le parcours.

Distinguer transaction détectée, en attente, confirmée et échouée. Ne déclencher la coche de réussite qu’à la confirmation définie pour le réseau ou à son équivalent simulé dans la démo. Prévoir une animation réduite pour les personnes qui ont désactivé les mouvements.

### 11.2 Contenu du justificatif

Créer un justificatif téléchargeable, idéalement en PDF, avec :

- Référence unique du document et de la transaction.
- Type : réception, envoi ou échange.
- Statut et réseau utilisé.
- Actif, montant et frais éventuels, distinctement indiqués.
- Date, heure et fuseau horaire.
- Adresse d’origine et adresse de destination.
- Nom du destinataire ou de l’émetteur uniquement lorsqu’il est connu.
- Motif ou note uniquement lorsqu’il a été renseigné ; sinon « Non renseigné ».
- Identifiant de transaction et accès à ses détails lorsque disponible.
- Contre-valeur indicative et devise de référence si pertinente, clairement identifiées.

Ne pas inventer un nom, un motif ou une identité à partir d’une adresse blockchain. Ne jamais inclure de clé privée ni de phrase de récupération dans un justificatif.

### 11.3 Classement automatique

Associer chaque justificatif à sa transaction. Organiser les documents par année et mois, avec des filtres par actif, type et date. Utiliser un nom compréhensible, par exemple `2026-10-10_reception_USDC_reference.pdf`.

La transaction et Swaplet donnent accès au même document, sans duplications incohérentes. Une confirmation répétée ne doit pas créer plusieurs justificatifs identiques.

## 12. Swaplet — espace Documents

Créer une rubrique dédiée aux documents de transactions : liste, recherche, filtres, aperçu et téléchargement. Une ligne affiche au minimum la date, le type, l’actif, le montant et la référence.

Sur ordinateur : liste structurée et, si utile, aperçu latéral. Sur téléphone : liste compacte et ouverture du détail dans une vue dédiée. Prévoir les états vide, chargement, document disponible et téléchargement impossible, avec possibilité de réessayer.

Cet espace ne doit pas mélanger justificatifs de transactions et sauvegardes de clés. Les sauvegardes de clés restent dans l’espace de sécurité.

## 13. Refonte de la partie Informations

Remplacer la section générale peu précise par trois catégories stables, clairement identifiées. Éviter une succession aléatoire de contenus ou un carrousel qui change sans action de l’utilisateur.

### A. Mes transactions

Événements propres au wallet : réception, envoi, échange, confirmation, échec, frais et justificatif disponible. Chaque information est datée et renvoie à la transaction concernée.

### B. Marché crypto

Actualités et événements sur le marché global : tendances, événements de réseau et informations concernant les actifs suivis. Afficher titre, résumé, source, date de publication et actifs concernés. Les contenus de démonstration sont identifiés comme fictifs ; ne pas les présenter comme des nouvelles en direct.

### C. Mises à jour de My Wall

Notes de version : numéro de version, date, nouvelles fonctionnalités, correctifs et éventuelle action attendue. Distinguer les annonces informatives des actions nécessaires.

### Organisation et interactions

Sur ordinateur, répartir les catégories dans des panneaux équilibrés ou une grille avec filtres, pour éviter une longue pile de cartes. Sur téléphone, proposer des onglets ou filtres fixes, avec une liste compacte dans chaque catégorie.

Permettre de consulter le détail, filtrer et distinguer lu / non lu. Conserver les filtres lors du retour depuis un détail. Les éléments liés à une action attendue apparaissent clairement, sans mélanger marché général et alertes personnelles.

## 14. Qualité de l’expérience

- Aucun widget essentiel coupé, aucun chevauchement avec la navigation.
- Aucun défilement horizontal involontaire de la page.
- Montants, devises et statuts lisibles sur les deux supports.
- Boutons et zones tactiles suffisamment accessibles.
- Navigation au clavier, focus visible et libellés compréhensibles.
- Couleurs toujours accompagnées d’un signe ou d’un texte explicatif.
- États vides, erreurs, chargements et confirmations conçus visuellement.
- Animations courtes, discrètes et compatibles avec la réduction des mouvements.
- Données fictives cohérentes d’un écran à l’autre.
- Possibilité de réinitialiser la démo pour rejouer le parcours.

## 15. Scénario de démonstration à construire

### Parcours principal sur téléphone

1. Ouvrir l’interface Swissquote reconstituée.
2. Montrer la languette « Mon wallet » et la tirer vers le haut.
3. Présenter l’activation : identité fictive, mot de passe conforme et choix de trois questions distinctes.
4. Accéder à My Wall ; montrer les soldes et devises en haut.
5. Faire remonter le volet pour consulter les widgets.
6. Simuler une réception d’USDC, d’abord en attente puis confirmée.
7. Montrer le disque orange avec coche blanche et le solde mis à jour.
8. Ouvrir le justificatif et le retrouver dans Swaplet → Documents.
9. Consulter les trois catégories d’informations.
10. Afficher temporairement une clé fictive, la masquer et démontrer l’export chiffré ou son état clairement simulé.

### Parcours principal sur ordinateur

Reprendre les mêmes étapes à partir du bouton « Mon wallet » près du compte. Montrer la disposition en plusieurs zones, les devises en grand et le volet qui remonte au défilement. Vérifier que toutes les fonctions disponibles sur téléphone le sont aussi sur ordinateur.

### Cas supplémentaires

Montrer un mot de passe trop court, une question déjà sélectionnée indisponible ailleurs, une erreur de déverrouillage, l’expiration de la révélation des clés, un mauvais mot de passe de sauvegarde et une transaction en attente sans coche de réussite.

## 16. Ordre de réalisation

1. Examiner le prototype existant et les deux références ; relever les éléments à conserver et les écarts.
2. Renommer le produit en My Wall et définir les styles visuels cohérents.
3. Reconstituer l’interface Swissquote et les points d’entrée du wallet.
4. Concevoir les compositions téléphone, ordinateur et intermédiaires.
5. Organiser les soldes, le volet, les widgets et la navigation.
6. Définir les parcours d’identité, de mot de passe, de récupération et de déverrouillage.
7. Refaire la gestion des clés, sans QR code.
8. Définir les transactions, leurs statuts et l’animation de confirmation.
9. Créer les justificatifs et leur classement dans Swaplet.
10. Refaire la partie Informations avec les trois catégories.
11. Préparer les données fictives et les parcours de démonstration.
12. Vérifier les critères ci-dessous et documenter les limites restantes.

## 17. Critères d’acceptation

- [ ] Le nouveau `.md` est complet, ordonné et inclut les deux images.
- [ ] Le produit s’appelle My Wall dans toute l’interface.
- [ ] Le logo fourni, la palette, les boutons, les icônes et les arrondis suivent les références.
- [ ] Les gros émojis ont disparu ; les petits symboles d’état restent sobres et cohérents.
- [ ] La démo commence dans une interface Swissquote reconstituée.
- [ ] La languette mobile ouvre le wallet par glissement et par toucher.
- [ ] Le bouton ordinateur se trouve près de l’icône de compte.
- [ ] Les deux supports possèdent des compositions adaptées et les mêmes fonctions.
- [ ] Les devises et soldes dominent le haut de l’écran.
- [ ] Le volet de contenu remonte et reste entièrement accessible.
- [ ] L’ordinateur présente plusieurs zones équilibrées, sans longue colonne unique.
- [ ] La création / activation inclut une vérification d’identité simulée clairement.
- [ ] Le mot de passe impose 15 caractères et les règles détaillées de composition et de données personnelles.
- [ ] Trois questions distinctes peuvent être choisies parmi quinze, sans doublons.
- [ ] Les questions seules ne promettent pas une récupération réelle des clés.
- [ ] Aucun QR code n’est utilisé pour les clés ou leur sauvegarde.
- [ ] Les secrets sont masqués, révélés temporairement puis remasqués automatiquement.
- [ ] La copie et l’export chiffré disposent de parcours et d’états explicites.
- [ ] Une réception confirmée déclenche le disque orange avec coche blanche.
- [ ] Chaque transaction confirmée possède un justificatif cohérent et téléchargeable.
- [ ] Le justificatif est retrouvé dans la transaction et dans Swaplet → Documents.
- [ ] Les informations sont réparties entre transactions, marché crypto et mises à jour.
- [ ] Les interactions fonctionnent au toucher, à la souris et au clavier selon le support.
- [ ] Les données sensibles et financières de démonstration sont fictives.
- [ ] La démo peut être réinitialisée et rejouée sans incohérence.

## 18. Points à expliciter sans bloquer la refonte

Dans ton document, indiquer les hypothèses lorsque le prototype ne permet pas de trancher : rôle exact de Swaplet, nature des clés, modèle de conservation du wallet, fonctionnement réel ou simulé du chiffrement, service de vérification d’identité et règles de confirmation des réseaux.

**Priorité finale : une démo cohérente de bout en bout, visuellement proche de Swissquote, qui permet de passer naturellement de l’application à My Wall, sur téléphone comme sur ordinateur.**
