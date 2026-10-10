# ★ NOUVELLES CONSIGNES DE NOA — PRIORITAIRES (complément de SECURITY_GAPS_FIX.md, verbatim)

Ces consignes s'ajoutent au reste du document. En cas de contradiction, elles priment. Ordre d'exécution global : N1 → N2 → N3 (sécurité et récupération), puis Phases A et B (§2–3), puis N4 → N8 (CGU et visuel), puis Phases C et D (§4–5). N9 s'applique à tout. Le compte rendu final (§6) doit aussi couvrir N1 à N8.

## N1 — Accès aux données : biométrie à chaque retour, plus de masquage manuel
Supprimer le bouton qui masque les montants (l'œil « masquer/afficher les chiffres », l'option correspondante dans les préférences, et tout masquage par défaut des montants une fois le wallet ouvert).
Dès que le wallet est déverrouillé, les montants s'affichent en clair, sans action supplémentaire.
À chaque fois que l'utilisateur quitte l'application (app en arrière-plan, onglet caché via visibilitychange, retour après mise en veille, ou plus de 60 s d'inactivité en démo), les données sont immédiatement cachées derrière un écran de confidentialité (logo + « My Wall is locked », sans aucun chiffre visible, y compris dans l'aperçu des apps récentes). Touch ID / Face ID (passkey) est exigé pour les réafficher. Repli : mot de passe du wallet si la biométrie échoue ou n'est pas disponible.
Ne change pas la règle de déverrouillage initial (mot de passe + passkey) ni la sécurité des signatures.
Contradiction résolue : la consigne « conserver le masquage par défaut » de la refonte mobile (N7) est remplacée par N1. Les données sont cachées tant que l'utilisateur n'est pas authentifié, puis affichées en clair. Graphiques, info-bulles, widgets et aperçus suivent ce même état verrouillé/déverrouillé.
Tests : quitter l'onglet puis revenir → écran verrouillé, biométrie demandée, aucun montant dans le DOM tant que l'app est verrouillée.

## N2 — Aucune sauvegarde cloud : la part ② devient une clé de sécurité physique
Supprimer toute notion de cloud : écran « Save to cloud », fichier de sauvegarde cloud, textes, docs, scripts (escape-hatch compris) et tests. Le cloud est jugé trop exposé (accessible depuis un téléphone volé).
Nouveau schéma de la clé de secours K3 (Shamir 2 sur 3, bibliothèque existante) :
- Part ① — Code papier ou plaque métal : le code texte actuel, imprimé, avec la recommandation de le graver sur une plaque en acier (résiste au feu et à l'eau) et de le garder chez soi ou dans un coffre bancaire.
- Part ② — Clé de sécurité physique (FIDO2, type YubiKey) ou second appareil du client : la part est chiffrée (AES-GCM, WebCrypto) avec une clé dérivée de l'extension WebAuthn PRF / hmac-secret de cette clé physique. Le chiffré est conservé par Swissquote, qui ne peut rien en faire sans la clé physique du client ; une copie hors ligne est aussi téléchargeable. Déchiffrer exige la présence physique de la clé et un toucher. Rien n'est en clair nulle part, et aucun cloud n'est utilisé.
- Part ③ — Partenaire de récupération indépendant : inchangé.
- Optionnel (déjà prévu au #14) : contact de confiance, ce qui fait passer à 2 sur 4.
Repli si aucune clé physique n'est disponible pendant la démo : second appareil du client (passkey d'un autre téléphone, si PRF est supporté). Sinon, fichier chiffré hors ligne sur clé USB, protégé par un mot de passe de sauvegarde distinct et fort (mêmes règles que le mot de passe du wallet), avec la mention « Keep offline — never upload to a cloud ». Pas d'autre repli.
Mets à jour : l'onboarding (étape « Recovery kit »), /recover (code papier + clé physique, ou code papier + partenaire), la sortie protégée, D2, le contact de confiance, escape-hatch, l'e2e (avec un authentificateur WebAuthn virtuel qui supporte PRF), le README, THREAT_MODEL et DEMO_SCRIPT.
Wallets existants : parcours « Replace cloud backup » (reconstruction de K3 avec l'ancienne part, nouvelle découpe, invalidation de l'ancienne part cloud).
Dans le compte rendu, explique pourquoi c'est plus sûr : une clé physique ne se pirate pas à distance, un voleur du téléphone ne l'a pas, et Swissquote ne détient qu'un chiffré illisible.

## N3 — Régler TOUS les problèmes de récupération
Fais un audit complet de chaque parcours de récupération et corrige tout ce que tu trouves. Écris une matrice de tests dans docs/RECOVERY_TEST_MATRIX.md et automatise-la au maximum. Vérifie au minimum :
- appareil perdu / volé / remplacé ; nouvel appareil avec ou sans l'ancien ; récupération lancée deux fois ; récupération annulée puis relancée ; session expirée pendant le délai ; page rechargée ou fermée en plein parcours (reprise sans perte) ;
- code papier mal tapé (message de checksum clair), clé physique absente ou mauvaise clé, partenaire indisponible, questions mal répondues, liveness refusée ;
- limite d'appareils après récupération (l'ancien appareil est bien retiré, le nouveau bien ajouté) ; ancienne passkey révoquée côté serveur ET ancienne K1 révoquée on-chain ;
- passkeys qui s'écrasent sur un même Mac (même user.id) : utilise un identifiant de passkey unique par appareil ou par récupération, et corrige la limite connue ;
- wallet qui existe sur le serveur mais pas sur l'appareil (proposer la restauration, jamais une nouvelle activation qui écraserait) ; après reset-demo ; client inconnu du co-signataire ;
- récupération quand Swissquote est en panne (Emergency mode) et quand Swissquote a disparu (D2) ;
- récupération pendant qu'une transaction ou une mise en file D1 est en attente ; veto pendant une récupération ;
- après la récupération : soldes, historique, justificatifs, contacts, abonnements, limites et autorisations retrouvés ; nouveau kit de récupération proposé (code papier régénéré si l'ancien a été exposé) ;
- messages d'erreur humains à chaque étape, avec quoi faire ensuite. Chaque problème trouvé est corrigé, testé et listé dans le compte rendu (problème → correction).

## N4 — Conditions générales d'utilisation (CGU)
Rédige des CGU de My Wall (en anglais, comme le reste de l'interface ; version française en annexe dans la doc), basées sur l'activité réelle du service : nature non-custodial (Swissquote détient 1 clé sur 3 et ne peut pas déplacer les fonds seul) ; responsabilités du client (code papier, clé physique, mot de passe) ; rôle du co-signataire (règles, refus motivés, délais de réponse) ; frais et abonnements, frais de réseau offerts et quotas ; conformité (sanctions, Travel Rule, vérification des wallets) ; récupération, délais de sécurité (D1/D2/D3), sortie protégée, « Take full control » ; succession, confidentialité et données ; risques crypto, testnet, et mention « prototype — not legal advice, to be reviewed by Swissquote Legal ».
Les CGU sont versionnées (ex. v1.0 — 10.10.2026) et stockées côté serveur (sq-bank).
Acceptation obligatoire à la première ouverture du wallet : écran dédié, résumé en 5 points + texte complet défilable, case « I have read and accept », bouton actif seulement après la case cochée. L'acceptation est horodatée et enregistrée (version, date, appareil), et visible dans Settings.
Mises à jour des CGU : chaque nouvelle version apparaît dans Information → My Wall updates, avec un résumé des changements (diff lisible). Si le changement est substantiel, une nouvelle acceptation est exigée à la prochaine ouverture. Sinon, c'est une simple information. Ajoute une seconde version de démo (v1.1) publiable depuis la console admin pour le montrer.
Les CGU acceptées sont consultables et téléchargeables en PDF (Swaplet → Documents, catégorie « Legal »).

## N5 — Thème jour / nuit / automatique
Trois options dans Settings : System (par défaut) / Light / Dark. Le choix manuel est conservé (try/catch sur le stockage local).
System suit le thème du téléphone ou de l'ordinateur (prefers-color-scheme) et change immédiatement quand le système change, sans rechargement. Sur l'app native, utilise le mécanisme natif équivalent.
Deux palettes réellement conçues à partir des tokens existants (pas une inversion des couleurs) : fonds, surfaces et cartes, textes, bordures, champs, boutons, badges hausse/baisse, graphiques, écrans de verrouillage, PDF (restent clairs). L'orange reste l'accent dans les deux modes. Contrastes AA vérifiés.
S'applique à tout le site : l'interface Swissquote reconstituée, My Wall, la console admin, téléphone et ordinateur.

## N6 — Widgets personnalisables
Sur l'accueil My Wall, l'utilisateur peut choisir, masquer, réordonner ses widgets (soldes, actions rapides, transactions récentes, compte Swissquote, informations, sécurité, paiements planifiés, frais offerts, autorisations, etc.).
Mode « Customize » : glisser-déposer sur ordinateur, poignées tactiles sur téléphone, et boutons monter/descendre accessibles au clavier et aux lecteurs d'écran. Bouton « Reset to default ».
Les widgets soldes et actions principales restent toujours présents (ils peuvent être déplacés, pas supprimés).
La disposition est enregistrée par client côté serveur (préférences existantes), avec un repli local. Mises en page séparées pour téléphone et ordinateur.

## N7 — Refonte visuelle de l'application téléphone (70 % existant / 30 % référence)
Image de référence : docs/design/assets/mobile-reference.png. Si elle est absente, ajoute une entrée NON BLOQUANTE dans POUR_NOA.md pour la demander, et travaille d'ici là avec la description ci-dessous.
Périmètre : uniquement le visuel et l'ergonomie mobile. Le ratio 70/30 est une direction artistique : l'identité de My Wall (logo Swissquote, orange, palette, contenus) reste dominante, avec une présentation mobile plus fluide, moderne et soignée.
À conserver absolument : identité, logos, palette, contenus ; toutes les fonctionnalités, données et actions ; parcours, routes, règles métier et protections de sécurité ; intégrations et données réelles. On intervient seulement sur les espacements, la typographie, les formes, la hiérarchie, les alignements, la navigation visuelle et le confort tactile. Aucune fonctionnalité supprimée.
Ciblage : le style mobile s'applique dans l'app native (Capacitor) et quand l'appareil est réellement mobile ou tactile (pointer: coarse + largeur < 768 px, ce qui inclut le mode appareil de Chrome DevTools pour la démo). Réduire la largeur d'une fenêtre d'ordinateur ne doit pas basculer dans le style mobile. Isole les styles dans des fichiers ou classes dédiés à la cible mobile.
Ce que montre la référence (wallet mobile sombre, une colonne compacte) : en-tête minimal (action à gauche, petit logo centré, menu à droite) ; grande carte arrondie du solde total (libellé discret, montant très lisible) ; deux boutons arrondis côte à côte dans cette carte (actions principales) ; section « wallets » (titre à gauche, petites commandes à droite) ; liste verticale défilable de cartes d'actifs arrondies (icône et nom à gauche, prix unitaire et variation en dessous, quantité et valeur de la position à droite) ; touches de couleur propres à chaque actif, discrètes et fondues dans les surfaces ; champ de recherche arrondi près du bas de la liste ; barre de navigation inférieure avec icônes et courts libellés, l'onglet actif en couleur d'accent ; surfaces douces, informations groupées, actions à portée du pouce.
À reprendre : la hiérarchie solde → actions → liste d'actifs ; les cartes arrondies et les espacements réguliers ; les boutons tactiles confortables (≥ 44 px) ; l'alignement clair entre infos de l'actif et montants détenus ; une navigation inférieure lisible ; des accents colorés subtils et une séparation douce des blocs.
À ne pas copier : le logo, les textes, les actifs, les chiffres ou la couleur verte de la référence. L'accent reste l'orange de My Wall. Pas d'œil de visibilité dans la carte du solde (N1 prime).
Partout dans l'app mobile, pas seulement sur l'accueil. Les fonctions secondaires restent accessibles sans surcharger les écrans. Pas d'effets excessifs : dégradés forts, transparences gênantes, ombres lourdes, animations décoratives. Contraste et lisibilité préservés.
Contraintes mobiles : zones sûres (encoche, barre système, indicateur d'accueil), clavier, gestes de retour ; vérification à 360, 390 et 430 px ; la barre du bas et la recherche ne masquent jamais les dernières cartes, et tout reste accessible par défilement ; navigation au clavier, lecteurs d'écran, contrastes, réduction des animations ; modes clair et sombre (N5) ; verrouillage par biométrie (N1).
Règle d'implémentation : dans l'application existante, avec ses vrais composants et ses vraies données, sans maquette parallèle. Ne modifie ni les règles métier ni les services pour cette adaptation.

## N8 — Harmonisation légère de la version ordinateur
La version ordinateur garde sa structure, ses dimensions, sa navigation, sa disposition et ses fonctionnalités. Ne pas y transposer les cartes mobiles ni la barre inférieure.
On harmonise seulement : les couleurs associées à chaque actif ou produit (un même actif a la même couleur identifiable sur téléphone et ordinateur, avec des nuances pour les modes clair et sombre) ; la couleur d'accent et les états sélectionnés ; les badges, icônes et indicateurs de hausse/baisse ; quelques bordures et surfaces si nécessaire.
Les changements restent discrets et servent uniquement à éviter que les deux versions paraissent dépareillées.

## N9 — Vérification et livraison (pour N1 à N8)
Vérifie : les principaux écrans en modes clair et sombre, sur téléphone et ordinateur ; le changement automatique du thème système ; le verrouillage et la biométrie au retour dans l'app ; les boutons, la navigation, la recherche, le défilement et la personnalisation des widgets ; l'accès à toutes les fonctionnalités existantes ; l'acceptation des CGU et leur mise à jour ; la récupération complète (N3) ; l'absence de régression sur ordinateur, avec une harmonisation visuelle limitée.
Captures dans docs/design/screens/ : téléphone en mode jour et en mode nuit (360/390/430) ; ordinateur avant/après, montrant que la disposition reste identique et que seuls les détails nécessaires ont changé.
Lance typecheck, tests, e2e et le parcours de DEMO_SCRIPT.md dans le navigateur. Commite après chaque point N.
Dans le compte rendu, explique brièvement ce qui a été conservé du modèle existant et ce qui est inspiré de la référence mobile.
