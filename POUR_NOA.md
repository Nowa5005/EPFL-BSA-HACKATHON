# 📩 Messages pour Noa

> Ce fichier contient tout ce que l'agent a besoin que **tu** fasses. Les entrées les plus récentes sont en bas.
> Tu n'as **jamais** besoin de lire ou modifier du code. Ne colle **jamais** de clé privée dans le chat.

---

## [BLOQUANT] Toutes les actions humaines prévues pour le projet (message groupé) — 14:35

**Ce que j'ai besoin que tu fasses :** surtout l'étape 1 (envoyer de l'ETH de test au « relayer ») ; les étapes 2 à 4 viendront plus tard, je te redirai quand.

### Étape 1 — BLOQUANT — Alimenter le relayer en ETH Sepolia (gratuit, ~5 min)
Le « relayer » est le compte de Swissquote qui paie les frais de transaction. Sans ETH de test, rien ne peut être envoyé sur la blockchain.

**Adresse à alimenter (copie-la exactement) :**
```
0xba45B64A7c1954aC12D6ceF82672150145d976a6
```

**Étapes exactes :**
1. Ouvre https://cloud.google.com/application/web3/faucet/ethereum/sepolia dans Chrome.
2. Connecte-toi avec un compte Google si on te le demande.
3. Vérifie que le réseau choisi est **Ethereum Sepolia**.
4. Colle l'adresse ci-dessus dans le champ « Wallet address ».
5. Clique sur **« Receive 0.05 Sepolia ETH »** (le texte du bouton peut varier légèrement).
6. Attends 1 minute. C'est fait ! (Tu peux vérifier sur https://sepolia.etherscan.io/address/0xba45B64A7c1954aC12D6ceF82672150145d976a6 : le solde doit être supérieur à 0.)

**Si le faucet Google refuse :** essaie https://sepolia-faucet.pk910.de (il « mine » dans ton navigateur pendant quelques minutes, puis clique « Claim rewards »), ou demande à un mentor du hackathon d'envoyer 0.05 Sepolia ETH à l'adresse ci-dessus.

**Comment me répondre :** tape simplement dans le terminal Claude Code : `relayer alimenté`

### Étape 2 — NON BLOQUANT (tu peux le faire dès maintenant) — Recevoir de l'USDC de test pour la « trésorerie Swissquote »
Pour la démo, le compte Swissquote (simulé) envoie de vrais USDC de test vers le wallet. Il faut donc remplir sa « trésorerie ».

**Adresse à alimenter (copie-la exactement) :**
```
0x8f5aC56Fe53A3af46EBb565a936bc094E2Ec3FA0
```
1. Ouvre https://faucet.circle.com
2. Choisis **USDC** puis le réseau **Ethereum Sepolia**.
3. Colle l'adresse ci-dessus et clique sur **« Send 10 USDC »** (ou le bouton équivalent).
4. Si le site le permet, **recommence plusieurs fois** (idéalement 3 à 6 fois, éventuellement plus tard dans la journée) : plus il y a d'USDC, plus la démo est confortable (on veut pouvoir montrer un envoi de plus de 50 USDC).

**Comment me répondre :** tape `usdc envoyé` (ce n'est pas grave si tu n'as pu le faire qu'une fois).

### Étape 3 — NON BLOQUANT (plus tard) — Tester Touch ID dans Chrome
Quand l'app web sera prête, il faudra ouvrir http://localhost:5173 dans Chrome et poser le doigt sur Touch ID quand on te le demande. (Je te redirai.)

### Étape 4 — NON BLOQUANT — `git push`
Si GitHub demande une connexion, je te mettrai les étapes ici.

**Si tu bloques, copie-colle ce prompt à Claude (dans le chat) :**
> Je fais un hackathon, mon agent Claude Code me demande d'envoyer de l'ETH de test (réseau Ethereum Sepolia) à l'adresse 0xba45B64A7c1954aC12D6ceF82672150145d976a6 en utilisant un « faucet » comme https://cloud.google.com/application/web3/faucet/ethereum/sepolia. Explique-moi pas à pas comme à une débutante sur Mac, et dis-moi quoi faire si le faucet refuse.

---

## [BLOQUANT] Rappel : le relayer n'a toujours pas d'ETH — 15:20

**Ce que j'ai besoin que tu fasses :** l'étape 1 du message ci-dessus (faucet ETH Sepolia vers `0xba45B64A7c1954aC12D6ceF82672150145d976a6`).
Tout le reste est prêt et testé sur une copie locale de la blockchain. Dès que le relayer a de l'ETH, je lance la démo sur le vrai Sepolia.
**Comment me répondre :** tape `relayer alimenté` dans le terminal Claude Code.

---

## [NON BLOQUANT] Comment lancer la démo — 15:20

1. Ouvre l'app **Terminal** sur ton Mac, puis tape : `cd ~/EPFL-BSA-HACKATHON` et appuie sur Entrée.
2. Tape : `npm run dev` et appuie sur Entrée. Attends que des lignes colorées s'affichent (≈ 10 secondes). **Laisse cette fenêtre ouverte.**
3. Ouvre **Chrome** et va sur **http://localhost:5173** — clique sur « Sign in » (utilisateur : alice).
4. Suis l'écran : « Create my wallet » → pose ton doigt sur **Touch ID** quand Chrome le demande → choisis un mot de passe → télécharge le kit et la sauvegarde.
5. Pour le reste de la démo, suis `docs/DEMO_SCRIPT.md` (onglet Admin : http://localhost:5173/admin — onglet Attaquant : http://localhost:5173/attacker).
   Pour repartir de zéro : ouvre un 2e Terminal, `cd ~/EPFL-BSA-HACKATHON` puis `npm run reset-demo`.

**Si tu bloques, copie-colle ce prompt à Claude (dans le chat) :**
> Je fais un hackathon. J'ai un projet Node.js dans le dossier ~/EPFL-BSA-HACKATHON sur mon Mac. On m'a dit de taper `npm run dev` dans le Terminal puis d'ouvrir http://localhost:5173 dans Chrome. <colle ici le message d'erreur exact>. Explique-moi pas à pas comme à une débutante sur Mac.

---

## ✅ Relayer alimenté — parcours complet réussi sur le vrai Sepolia — 15:15

Merci ! Création → signature → attaquant refusé → récupération → ancienne clé révoquée → nouvelle signature : **tout passe sur la vraie blockchain de test**. Les liens Etherscan sont dans le README (section « Proof on Sepolia »).

## [NON BLOQUANT] Encore 2 choses quand tu as un moment — 15:15
**1. USDC de test pour la trésorerie** (pour montrer les envois en USDC) :
1. Va sur https://faucet.circle.com, choisis **USDC** et **Ethereum Sepolia**.
2. Colle `0x8f5aC56Fe53A3af46EBb565a936bc094E2Ec3FA0` et clique « Send ». Recommence si le site le permet (idéal : ≥ 80 USDC au total, pour montrer un envoi de 60).
**Comment me répondre :** tape `usdc envoyé`.

**2. Tester Touch ID** : lance la démo (voir « Comment lancer la démo » plus haut), clique « Create my wallet » puis « Create passkey », et pose ton doigt. 
**Comment me répondre :** tape `touch id ok`, ou copie le message d'erreur affiché.

---

## ✅ USDC reçus — l'interface complète marche sur le vrai Sepolia — 15:50

La trésorerie a reçu 20 USDC. J'ai fait tourner **toute l'interface** sur la vraie blockchain de test avec un Touch ID simulé : création, envoi, contrôle renforcé + validation admin, refus sanction, dApps, attaquant, récupération. Tout passe (liens dans le README). La trésorerie a encore 19.5 USDC : le script de démo est adapté à ce montant.

La démo est **remise à zéro et lancée** : ouvre http://localhost:5173 (utilisateur `alice`). Un 2e client fictif `bruno` existe aussi.

## [NON BLOQUANT] Dernière vérification : Touch ID — 15:50
1. Dans Chrome, va sur http://localhost:5173 (recharge la page si elle était déjà ouverte).
2. « Sign in » → « Create my wallet » → « Create passkey » → pose ton doigt sur Touch ID.
3. Continue jusqu'au kit de récupération (télécharge les 2 fichiers et garde-les : ils servent pour la démo « Swissquote disparaît »).
**Comment me répondre :** tape `touch id ok`, ou copie-colle le message d'erreur affiché.

---

## ✅ Refonte « My Wall » terminée — 17:10

Tout ton cahier des charges est en place :
- **l'app Swissquote reconstituée**, avec la **languette « Mon wallet »** sur téléphone et le **bouton « Mon wallet »** sur ordinateur ;
- **My Wall en français**, avec les soldes en grand et le volet qui remonte ;
- **l'activation en 7 étapes** : pièce d'identité simulée, mot de passe de 15 caractères, 3 questions parmi 15, kit **sans QR code** ;
- **les justificatifs PDF**, aussi rangés dans **Swaplet → Documents** ;
- **les Informations** en 3 catégories ;
- **Clés et sécurité** : révélation 30 secondes, sauvegarde chiffrée.

J'ai tout vérifié dans un navigateur sur le vrai réseau de test, et le parcours complet `npm run e2e` passe toujours. Les captures sont dans `docs/design/screens/`, et le nouveau scénario de démo dans `docs/DEMO_SCRIPT.md`.

## [NON BLOQUANT] Comment lancer la démo (version My Wall) — 17:10
1. Ouvre **Terminal** et tape : `cd ~/EPFL-BSA-HACKATHON` puis Entrée.
2. Tape `npm run dev` puis Entrée. Attends ≈ 10 secondes. **Laisse la fenêtre ouverte.**
3. Dans **Chrome**, va sur **http://localhost:5173** et clique « Se connecter » (identifiant `alice`, n'importe quel mot de passe).
4. Pour voir la version téléphone : clic droit → « Inspecter » → icône téléphone en haut à gauche → choisis « iPhone 14 ». Puis **tire la languette « Mon wallet »** en bas de l'écran.
5. Suis l'activation : document de démonstration → **Touch ID** → mot de passe (ex. `Lac-Leman-2026-bleu!`) → 3 questions → kit (clique « Afficher » puis « Imprimer » ou « Copier », et « Enregistrer dans le cloud »).
   Pour repartir de zéro : 2e Terminal → `cd ~/EPFL-BSA-HACKATHON` → `npm run reset-demo`, puis recharge la page.

## [NON BLOQUANT] À tester toi-même : Touch ID — 17:10
Je n'ai pu tester Touch ID qu'en simulation. Fais l'étape 5 ci-dessus sur ton Mac.
**Comment me répondre :** tape `touch id ok`, ou copie-colle le message d'erreur affiché.

**Si tu bloques, copie-colle ce prompt à Claude (dans le chat) :**
> Je fais un hackathon. Sur mon Mac, j'ai lancé `npm run dev` dans le dossier ~/EPFL-BSA-HACKATHON, puis ouvert http://localhost:5173 dans Chrome. Quand je clique « Créer la passkey », il se passe ceci : <colle le message>. Explique-moi pas à pas comme à une débutante sur Mac.

---

## ✅ Nouvelles fonctionnalités et sécurité renforcée — 19:20

Ajouté (détail dans `docs/DEMO_SCRIPT.md`, rubrique « New features ») : aperçu complet avant signature (frais, soldes avant/après, autorisations), alerte et plafond pour les autorisations illimitées, applications autorisées et révocation, vérification du destinataire (adresses qui se ressemblent), dépenses planifiées et rappels, abonnements Gratuit / Plus / Pro (paiement de démonstration, aucun débit), échange de démonstration, personnalisation, masquage des montants, messagerie (ouvre ta propre messagerie, l’app n’envoie rien), code de secours, et l’interrupteur « Geler la co-signature ».

## [IMPORTANT, NON BLOQUANT] Ne supprime pas le fichier `.env` — 19:20
Les clés de Swissquote (relayer et co-signataire) sont maintenant **chiffrées**. Le mot de passe qui les déverrouille est dans le fichier caché `.env` à la racine du projet (il n’est jamais envoyé sur GitHub).
- Si ce fichier est supprimé, ces clés deviennent illisibles : le relayer (et ses ETH de test) serait perdu. Les wallets restent récupérables par la porte de sortie, mais la démo ne marcherait plus sans tout recréer.
- Si tu veux une copie de sécurité : copie le fichier `.env` sur une clé USB ou dans ton gestionnaire de mots de passe. Ne le colle jamais dans un chat.
**Comment me répondre :** rien à faire, sauf si tu veux que je t’aide à en faire une copie.

---

## ✅ Blocage « 1 ordinateur + 1 téléphone » à la connexion corrigé — 19:45
Si un wallet existe déjà pour ton client mais pas sur ton navigateur, My Wall ne tente plus une nouvelle activation (qui était refusée par la règle des appareils). Il affiche « Votre wallet existe déjà » avec deux choix : **Restaurer mon wallet sur cet appareil** (ne compte pas comme un appareil en plus) ou **Démo : recommencer l’activation à zéro**. La règle reste appliquée quand on lie un appareil supplémentaire (Paramètres). J’ai aussi remis toute la démo à zéro : connecte-toi avec `alice` et clique « Mon wallet ».

---

## ✅ « Client inconnu » à la création de la passkey corrigé — 20:10
Cause : la remise à zéro de la démo avait effacé ton client côté serveur, alors que ton navigateur te gardait connectée. My Wall ré-enregistre maintenant ton client automatiquement (au chargement de la page et juste avant de créer la passkey). Rien à faire : recharge la page et clique « Créer la passkey », Touch ID doit s’afficher.

---

## ✅ Serveurs protégés (connexion obligatoire, CORS, CSRF) — 22:50
Les 4 services n’acceptent plus n’importe quel appel : il faut être connecté, et un client ne peut agir que sur son propre compte. Rien à faire pour toi, la démo marche comme avant (connecte-toi avec `alice`).
- **Console Swissquote** (`/admin`) : elle demande maintenant une connexion. Identifiant `compliance`, n’importe quel mot de passe (compte de démonstration).
- **« Démo : recommencer l’activation à zéro »** : on te redemande ton mot de passe Swissquote (n’importe lequel en démo) avant d’effacer.
- `npm run reset-demo` marche toujours. Deux nouveaux secrets ont été ajoutés automatiquement dans le fichier caché `.env` : ne le supprime pas, ne le colle jamais dans un chat.

---

## ✅ Marchés réels, contenus, wallet masqué, conformité, version App — 23:40
Tout ce que tu as demandé dans le prompt « Accueil, marchés et wallet » est en place. L'interface est maintenant **en anglais par défaut** (bouton « English | Français » sur la page de connexion, et dans Settings → Language).
- **Trade / Watchlist / fiches / alertes** : vrais cours (Yahoo Finance, CoinGecko), avec l'heure et la mention « différé » ou « clôture ». Le compte de trading d'Alice reste une **démo fictive** (c'est indiqué).
- **News** : vrais articles (CNBC, MarketWatch, CoinDesk…). **Inspiration** : 7 articles pédagogiques sourcés.
- **Wallet** : les montants sont **masqués à chaque entrée** ; clique sur l'œil et valide avec Touch ID pour les voir.
- **Envoi** : choix « My own wallet » / « Someone else's wallet » (nom du bénéficiaire demandé ; plus d'infos dès 1 000 CHF). Mode démo Travel Rule clairement affiché.
- **Documents** : relevé fiscal annuel (PDF) et export CSV.

## [NON BLOQUANT] Voir la version « App » — 23:40
1. Lance la démo comme d'habitude (`npm run dev`).
2. Dans Chrome, va sur **http://localhost:5173/sq** : en bas à gauche, un petit bouton **« Web | App »** apparaît (il n'est visible que pour toi, en développement).
3. Clique **App** : tu vois l'application dans un cadre de téléphone (tu peux changer la taille). Clique **Web** pour revenir.
**Limite :** la vraie application iPhone / Android est préparée mais n'a pas pu être compilée sur ce Mac (il faudrait installer Xcode, gratuit mais ~15 Go, ou Android Studio). Dis-moi si tu veux le faire.
**Comment me répondre :** rien à faire, sauf si tu veux compiler l'app native.

---

## [NON BLOQUANT] Plan et estimation pour « SECURITY_GAPS_FIX » — 10.10.2026, 23:55
J'ai bien reçu le document et l'image de référence (copiée dans `docs/design/assets/mobile-reference.png`). Estimation (travail en parallèle par plusieurs agents, puis vérification et intégration par moi) :
- **N1–N3** (verrouillage biométrique au retour, fin du cloud → clé physique, audit de la récupération) : ≈ 3–4 h
- **Phase A** (serveurs en local, réceptions extérieures, jetons arnaque, contrôles avant envoi, page « About », mode urgence) : ≈ 2–3 h
- **Phase B** (contrat Guard + délais on-chain D1/D2, veto, sortie protégée, « Take full control ») : ≈ 4–6 h — la plus lourde
- **N4–N8** (CGU, thème jour/nuit, widgets, refonte mobile, harmonisation ordinateur) : ≈ 3–4 h
- **Phase C** (clé liée au matériel, Travel Rule IVMS101, succession, contact de confiance, code de contrainte, rotation de K2) : ≈ 4–5 h
- **Phase D** (multi-chaînes, Bitcoin) : documentation au minimum, code si le temps le permet
Le relayer a ≈ 0.047 ETH de test ; les frais Sepolia sont très bas en ce moment, ça suffit pour démarrer.
**Comment me répondre :** rien à faire pour l'instant.

## [NON BLOQUANT] ETH de test supplémentaire pour la phase B — 10.10.2026, 23:55
Chaque nouveau wallet recevra une petite « réserve de gas d'urgence ». Pour être tranquille, remets si possible **0.05 Sepolia ETH** sur le relayer (même adresse et même méthode que la première fois) :
```
0xba45B64A7c1954aC12D6ceF82672150145d976a6
```
**Comment me répondre :** tape `relayer alimenté` quand c'est fait. Je continue en attendant.
