# SECURITY_GAPS_FIX — Résoudre pour de vrai les failles et situations non couvertes de My Wall

> **À l'agent Claude Code.** Ce document complète `CLAUDE_CODE_BRIEF.md` et `MY_WALL_REDESIGN.md`. Le protocole `POUR_NOA.md` reste valable.
> Noa a relevé une liste de problèmes numérotés. Tu traites les problèmes **2 à 23, SAUF le 18 (gel ordonné par une autorité) et le 22 (comptes joints, entreprises, procurations)**. Ne travaille pas sur le 18 ni sur le 22, même partiellement.
>
> Pour chaque problème : choisis la meilleure solution réaliste, **implémente-la en vrai** quand c'est faisable, sinon documente-la précisément. À la fin, explique tout à Noa dans un **compte rendu en français simple** (§6).

---

## 0. Règles absolues

1. **Avant toute chose**, vérifie que le travail en cours compile et que les tests passent (`npm run typecheck`, `npm test`, `npm run e2e`), puis **commite-le**. Ensuite, **un commit par problème résolu**, avec un message clair.
2. **Pas de crypto maison.** N'utilise que des bibliothèques et contrats établis : ethers, `@safe-global/*`, **Zodiac Delay Modifier** (Gnosis Guild, audité), OpenZeppelin (ECDSA, ERC-20), `@simplewebauthn/*`, `shamir-secret-sharing`, `bitcoinjs-lib` si tu fais le §5.
   Le seul contrat écrit sur mesure autorisé est le **Guard** du §3. Il doit être minimal, entièrement testé, et signalé « non audité » dans la doc.
3. **Ne régénère aucune clé existante. Ne casse aucun wallet déjà déployé.** Les nouveaux mécanismes s'appliquent automatiquement aux **nouveaux** wallets. Pour les wallets existants, ajoute un parcours « **Upgrade wallet security** » (bannière + signature K1 + K2).
4. **Rien ne doit casser.** Le parcours create → sign → recover, `npm run e2e` et le parcours de `docs/DEMO_SCRIPT.md` dans le navigateur doivent marcher après chaque commit. **Étends `npm run e2e`** pour couvrir les nouveaux chemins on-chain.
5. **L'apparence ne change pas** : mêmes tokens visuels, interface en anglais. Les nouveaux écrans suivent le style existant. Pas de gros badges MOCK ; l'honnêteté sur ce qui est réel ou simulé passe par le README et une page discrète « About this prototype ».
6. **Besoin d'un humain** (ETH de test pour déployer des contrats, test Touch ID, etc.) : passe par `POUR_NOA.md`, en continuant les autres tâches si c'est non bloquant. Les déploiements de contrats coûtent de l'ETH Sepolia : vérifie le solde du relayer **avant** chaque phase et demande un faucet assez tôt.
7. **Au démarrage**, écris dans `POUR_NOA.md` une estimation du temps de chaque phase (A à D). Travaille **dans l'ordre des phases**. Si le temps manque, une phase terminée et testée vaut mieux que quatre phases à moitié faites.
8. **Valeurs de démo courtes**, valeurs de production indiquées dans le code et la doc (ex. délai démo 2 min, prod 48 h).

---

## 1. Vue d'ensemble : problèmes → solutions

| # | Problème | Solution retenue | Phase |
|---|---|---|---|
| 2 | Serveurs exposés sur toutes les interfaces | Écoute sur `127.0.0.1` par défaut (variable `HOST`) | A |
| 3 | Réceptions extérieures absentes de l'historique | Indexeur on-chain (événements `Transfer` ERC-20 + `SafeReceived` ETH) | A |
| 4 | Swissquote peut bloquer | Refus toujours motivés + chemin de sortie garanti on-chain (Delay D1) + engagement de délai de réponse | A + B |
| 5 | La porte de sortie contourne la conformité | Toute transaction sans K2 passe par un délai on-chain (D1), avec alerte conformité ; détection des transactions hors co-signature | B |
| 6 | Le délai de 48 h n'existe que sur le serveur | **Guard on-chain** : seul K1 + K2 est immédiat, tout le reste passe par D1 (48 h) | B |
| 7 | Sauvegarde cloud = maillon faible | **Plus de cloud** : part ② protégée par une **clé de sécurité physique** (voir §0.2), et délai on-chain D1 sur tout chemin sans K1 + K2 | 0 + B |
| 8 | « Swissquote + partenaire ne peuvent rien » fragile | K2 + K3 n'est plus immédiat (D1, avec veto du client) | B |
| 9 | Travel Rule : collecte sans transmission | Messages **IVMS101** signés, transmis par un protocole de type TRP à un VASP simulé, et preuve de propriété pour les wallets auto-hébergés | C |
| 10 | Beaucoup de simulé | Matrice « production readiness » + page « About this prototype » | A |
| 11 | Clé de l'appareil dans le navigateur | K1 chiffrée avec une clé dérivée de la passkey (**WebAuthn PRF**), donc liée au matériel ; cible de production documentée | C |
| 12 | Décès / succession | Héritier désigné + module Delay D3 (6 mois en prod), veto possible par le client tant qu'il est en vie, dossier d'héritier vérifié | C |
| 13 | Appareil perdu ET Swissquote disparu | K3 **seule** peut agir après un long délai on-chain (Delay D2, 30 jours en prod) | B |
| 14 | Appareil + papier + mot de passe perdus | Option « **contact de confiance** » (Shamir 2 sur 4) + bilan de santé régulier de la récupération | C |
| 15 | Quitter Swissquote | Parcours « **Take full control** » : remplacement de K2 par une clé du client, Guard et modules retirés | B |
| 16 | Client sous la menace (extorsion) | **Code de contrainte** (vue leurre + gel silencieux + alerte) + limites que le client ne peut relever qu'avec un délai | C |
| 17 | Rotation de K2 | Versionnage de K2, rotation par wallet (K1 + K2) via une bannière, l'ancienne K2 est refusée par le signataire | C |
| 19 | Jetons inconnus / arnaques / empoisonnement d'adresse | Détection de tous les jetons entrants, section « Unrecognised tokens », interdiction d'interagir, alerte sur les adresses sosies | A |
| 20 | Mauvais réseau / mauvais jeton | Contrôles avant envoi (adresse de contrat, adresse du jeton lui-même), confirmation de réseau, renvoi d'un jeton reçu par erreur, redéploiement du Safe à la même adresse sur une autre chaîne | A + D |
| 21 | Services Swissquote en panne | Détection automatique, « **Emergency mode** » guidé dans le navigateur, réserve de gas d'urgence | A + B |
| 23 | Bitcoin et autres chaînes | Multi-chaînes EVM (même adresse de Safe) ; Bitcoin : multisig 2 sur 3 natif (P2WSH) sur signet ou testnet avec les mêmes rôles | D |

---

## 2. Phase A — Corrections rapides et visibles

### #2 Serveurs exposés
- Tous les services font `app.listen(port, process.env.HOST ?? '127.0.0.1')`. Le mode téléphone ou tunnel continue de marcher via le proxy Vite (seul Vite est exposé).
- Ajoute un test ou un script de vérification. Mets les logs à jour (adresse réelle d'écoute).

### #3 Réceptions extérieures
- Crée un **indexeur** dans `sq-cosigner` (ou un module `indexer.ts`) qui interroge la chaîne toutes les 15 s pour chaque Safe connu :
  - jetons : `getLogs` de l'événement `Transfer(address,address,uint256)` avec `to = Safe`, **pour tous les contrats** (pas seulement l'USDC, ce qui sert aussi au #19) ;
  - ETH entrant : l'événement `SafeReceived(address sender, uint256 value)` émis par le Safe v1.4.1 ;
  - un **curseur de bloc par Safe**, une profondeur de confirmation configurable, et une clé d'idempotence `txHash:logIndex`, donc aucun doublon.
- Chaque réception confirmée crée : une ligne d'historique, un justificatif PDF, une notification, et l'animation de confirmation si le client a l'app ouverte.
- Le nom de l'émetteur n'est affiché **que** s'il est connu (contact, wallet vérifié du client, trésorerie Swissquote affichée comme « Your Swissquote account »). On ne l'invente jamais.
- Test e2e : envoi d'USDC depuis une adresse externe (la trésorerie utilisée comme un tiers), puis vérification que la ligne et le document apparaissent.

### #19 Jetons inconnus, arnaques, empoisonnement d'adresse
- Les jetons absents de la liste blanche (USDC de démo, USDC Circle) sont rangés dans une section repliée « **Unrecognised tokens** », **jamais valorisés**, avec l'avertissement : « Do not interact: unknown tokens are often scams. »
- Moteur de règles : **refus** de toute transaction qui appelle un contrat de jeton non reconnu (`approve`, `transfer`, appel arbitraire), sauf l'action explicite « Return / ignore », qui ne signe rien.
- **Empoisonnement d'adresse** : si une adresse ressemblant à un contact (mêmes 4 premiers ET 4 derniers caractères, adresse différente) apparaît dans l'historique, notamment via un transfert de 0 ou de quelques unités, elle est marquée « Look-alike address — possible scam ». Le moteur de règles **refuse** d'envoyer vers une adresse sosie d'un contact, avec une explication claire.
- Tests : jeton inconnu reçu → masqué et non interactif ; envoi vers une adresse sosie → refusé.

### #20 Mauvais réseau ou mauvais jeton (partie A)
- Avant l'envoi, avec explications en clair :
  - envoi vers **l'adresse du contrat du jeton lui-même** → bloqué (« This would destroy the funds ») ;
  - destinataire qui est **un contrat** (bytecode présent), non reconnu comme dApp ni comme Safe → avertissement fort + confirmation ;
  - premier envoi vers une adresse → case « This recipient accepts **Ethereum (Sepolia)** USDC » ;
  - adresse au format d'une autre chaîne (Bitcoin, Solana, etc.) collée dans le champ → message dédié.
- Écran Receive : le QR de l'adresse publique (s'il existe) encode `ethereum:<adresse>@11155111` (EIP-681). Le réseau est affiché en grand.
- **Renvoyer un jeton reçu par erreur** : depuis le détail d'un jeton reconnu reçu d'une adresse, action « Send back to sender », soumise aux contrôles habituels.

### #10 Clarté réel / simulé
- `docs/PRODUCTION_READINESS.md` : un tableau avec, pour chaque élément simulé, ce qui est simulé, l'intégration de production prévue (type de prestataire : vérification d'identité vidéo agréée FINMA, fournisseur de données de sanctions, HSM, partenaire fiduciaire, réseau Travel Rule…), le risque et l'effort.
- Page discrète « **About this prototype** » (lien dans le pied de page et dans More), qui reprend ce tableau en version courte. **Aucun badge ajouté dans les écrans.**
- Mets à jour le tableau Real vs Mock du README.

### #4 « Swissquote peut bloquer » (partie A)
- Tout refus du co-signataire affiche : le **motif précis**, la règle concernée, comment le résoudre, et la phrase : « Your funds are never locked: you can always move them with your recovery key (protected exit, see Security). »
- `docs/COSIGNER_COMMITMENTS.md` : engagement de délai de réponse (ex. une transaction conforme est co-signée en moins de 60 s ; une revue humaine en moins de 24 h), procédure de contestation, journal des refus consultable par le client.
- Écran Security : section « **Your guarantees** », 3 lignes simples : Swissquote ne peut pas déplacer vos fonds ; Swissquote ne peut pas vous bloquer durablement (sortie protégée) ; chaque décision est journalisée.

### #21 Services Swissquote en panne (partie A)
- L'app vérifie régulièrement la disponibilité des services (`/health`, avec délai d'expiration). En cas de panne, une bannière s'affiche : « Swissquote services are unreachable. Your funds are safe. » avec un lien vers **Emergency mode**.
- Emergency mode (complété en phase B) : soldes lus **directement** sur la blockchain via un RPC public (déjà multi-RPC), historique en cache local, et sortie guidée.

---

## 3. Phase B — Couche on-chain : Guard + modules Delay (cœur de la solution)

### 3.1 Principe (à expliquer tel quel dans la doc)
Aujourd'hui, toutes les règles de délai et de conformité sont appliquées **par K2, hors chaîne**. On ajoute une règle **inscrite dans le contrat**, qui vaut même si Swissquote, le partenaire ou un voleur a 2 clés :

| Combinaison de signatures | Effet on-chain |
|---|---|
| **K1 + K2** (usage normal) | Exécution **immédiate** ; K2 applique les règles hors chaîne comme aujourd'hui |
| **Annulation d'une opération en attente** (`setTxNonce` sur un module Delay), par 2 propriétaires quelconques | **Immédiate** : c'est le veto |
| **Toute autre combinaison** (K2 + K3 récupération, K1 + K3 sortie sans Swissquote, tout changement de configuration sans K1 + K2) | **Refusée en direct** : elle doit être **mise en file dans le module Delay D1** et ne s'exécute qu'après **48 h** (démo : 2 min), avec veto possible |
| **K3 seule** | Mise en file dans le module **Delay D2**, exécutable après **30 jours** (démo : 4 min), avec veto possible |

Conséquences :
- **#5** : une sortie sans Swissquote reste **garantie** (self-custody), mais avec un préavis de 48 h. L'indexeur alerte la conformité Swissquote et le client dès la mise en file.
- **#6** : le délai de récupération devient **on-chain**.
- **#7 / #8** : même avec 2 clés volées ou en cas de collusion Swissquote + partenaire, rien n'est immédiat. Le vrai client est notifié et peut opposer son veto avec K1 + n'importe quelle autre clé.
- **#13** : appareil perdu ET Swissquote disparu → K3 seule après 30 jours.
- **#4** : Swissquote ne peut retarder une sortie que de 48 h, jamais la bloquer.

### 3.2 Implémentation
- **Modules Delay** : utilise le **Zodiac Delay Modifier** officiel (mastercopy + `ModuleProxyFactory` ; vérifie les adresses déployées sur Sepolia via le paquet `@gnosis-guild/zodiac`, ou déploie la mastercopy depuis ses artefacts officiels). Deux proxies par Safe :
  - **D1** : cooldown 48 h (démo 120 s), expiration 7 jours ; modules autorisés à mettre en file : **le Safe lui-même** ;
  - **D2** : cooldown 30 jours (démo 240 s), expiration 30 jours ; modules autorisés à mettre en file : **l'adresse K3**.
  - Les deux sont activés comme modules du Safe (`enableModule`).
- **Guard** (`contracts/MyWallGuard.sol`, Solidity 0.8.x, OpenZeppelin ECDSA) installé avec `setGuard`. Dans `checkTransaction` :
  - recalcule le hash de la transaction Safe (`getTransactionHash` avec le nonce de la transaction, attention à l'incrémentation du nonce dans Safe 1.4.1), récupère les signataires (signatures EOA, `v` = 27/28 et la variante `eth_sign`), et détermine si **K1 et K2** sont présents ;
  - `K1 + K2` → autorisé, mais **refuse toujours `DELEGATECALL`** sauf vers MultiSend « call only » officiel ;
  - sinon, autorisé **uniquement** si la cible est D1 ou D2 et la fonction est `execTransactionFromModule` (mise en file) ou `setTxNonce` (veto) ;
  - tout le reste → `revert` avec un message explicite ;
  - **les fonctions d'administration** des modules (`setTxCooldown`, `setTxExpiration`, `enableModule`, `disableModule`) et du Safe (`setGuard`, `enableModule`, `disableModule`, `changeThreshold`, `addOwner`, `removeOwner`, `swapOwner`, `setFallbackHandler`) exigent K1 + K2 en direct, ou passent par D1 ;
  - les adresses K1 et K2 sont lues dynamiquement (owners actuels + adresse K2 enregistrée dans le Guard, modifiable seulement via K1 + K2 ou D1), pour survivre aux rotations (#17) et aux récupérations.
- **Outillage** : Hardhat ou `solc` via npm (évite les installations natives). Tests unitaires du Guard sur un fork ou réseau local, avec **chaque ligne du tableau 3.1** testée, plus les tentatives de contournement (Guard retiré sans délai, cooldown modifié, `DELEGATECALL`, signatures dupliquées). Vérification sur Etherscan Sepolia si possible.
- **Création de wallet** : après le déploiement du Safe (initializer inchangé et indépendant de la chaîne, cf. #20/#23), le relayer exécute une transaction K1 + K2 groupée (MultiSend) : déploiement de D1 et D2, `enableModule`, configuration des modules, `setGuard`.
- **Wallets existants** : bannière « Upgrade wallet security » qui fait la même chose en une signature (K1 via Touch ID + K2).
- **Parcours dans l'app** :
  - **Recovery** (« I lost my device ») : la rotation `swapOwner` est maintenant **mise en file dans D1** par K3 + K2, avec le compte à rebours on-chain affiché, puis exécutée (`executeNextTx`, payé par le relayer). L'ancien délai serveur reste en complément.
  - **Protected exit** (sortie sans Swissquote, K1 + K3) : depuis Security et Emergency mode, le client reconstitue K3 (code papier + clé de sécurité physique), met en file un transfert vers l'adresse de son choix dans D1, puis l'exécute après le délai.
  - **Long-term recovery** (K3 seule) : D2, accessible depuis `/recover` quand ni l'appareil ni Swissquote ne sont disponibles.
  - **Veto** : toute mise en file détectée par l'indexeur (événement `TransactionAdded` de D1 et D2) déclenche immédiatement notification, email simulé et bannière rouge « A protected operation is pending on your wallet — Cancel it », avec un bouton qui signe `setTxNonce` (K1 + K2).
  - **Console admin** : liste des opérations en attente et des transactions exécutées **sans co-signature K2** (détection par l'indexeur via `ExecutionFromModuleSuccess` et `ExecutionSuccess`), marquées « Compliance review ».
- **Gas d'urgence (#21)** : à la création, le relayer dépose une petite **réserve d'ETH** dans le Safe (démo 0.002 ETH), affichée comme « Emergency gas reserve — used only if Swissquote is unavailable ». La politique de co-signature interdit de la dépenser en usage normal. Emergency mode l'utilise pour payer la mise en file et l'exécution sans relayer.
- **Emergency mode complet** : sortie protégée (D1) ou récupération long terme (D2) depuis le navigateur, **sans aucun service Swissquote** (RPC public uniquement). Teste-le avec les services arrêtés.
- **Étends `npm run e2e`** : (a) K2 + K3 en direct → refusé par le Guard ; (b) mise en file D1 puis exécution après le délai ; (c) veto qui annule une mise en file ; (d) K1 + K3 sortie protégée ; (e) K3 seule via D2 ; (f) K1 + K2 normal toujours immédiat.

### #15 Quitter Swissquote : « Take full control »
- Écran Security → « **Take full control of my wallet** ». Le client choisit une nouvelle clé de remplacement de K2 : une nouvelle clé locale générée et sauvegardée en fichier chiffré, ou l'adresse d'un wallet externe **vérifié par signature**.
- Transaction K1 + K2 (immédiate, Swissquote coopère) : `swapOwner(K2 → nouvelle clé)`, retrait du Guard, désactivation de D1, D2 et D3 (au choix du client : garder D1 et D2 avec la nouvelle clé), puis Swissquote désenregistre le wallet et clôt le suivi Travel Rule.
- **Si Swissquote ne coopère pas** : même opération via D1 (K1 + K3, 48 h).
- Résultat : un Safe standard, utilisable sur app.safe.global. Montre-le dans la démo et documente-le (argument fort pour le self-custody et le volet légal).

---

## 4. Phase C — Identité de l'appareil, conformité, situations de vie

### #11 Clé de l'appareil liée au matériel (WebAuthn PRF)
- À la création de la passkey, demande l'extension **PRF** (`prf: { eval: { first: <sel fixe par wallet> } }`). Si elle est supportée, dérive une clé AES-GCM (WebCrypto HKDF) depuis la sortie PRF, et chiffre K1 **deux fois** : mot de passe (keystore existant) ET clé PRF. Le déverrouillage exige donc la passkey matérielle (Secure Enclave ou gestionnaire de passkeys de l'appareil). Une copie de la base locale volée est inutile.
- Si PRF n'est pas supporté : repli sur le schéma actuel, avec une mention claire dans Security (« Hardware binding: not available on this browser »).
- Documente la **cible de production** : app native, avec K1 dans le trousseau iOS (`ThisDeviceOnly` + contrôle biométrique) ou Android StrongBox, ou une passkey **directement propriétaire du Safe** (signataire WebAuthn de Safe, vérification P-256 / RIP-7212).

### #7 Part ② de la clé de secours (remplacée)
- Le problème du cloud est **supprimé** par le §0.2 : il n'y a plus aucune sauvegarde cloud.
- Explique dans la doc que, grâce à D1 et D2, même une clé de sécurité physique et un code papier volés ne permettent **aucun** mouvement immédiat.

### #9 Travel Rule : transmission réelle simulée de bout en bout
- Construis les messages au format **IVMS101** (originator : client KYC ; beneficiary : nom, adresse et pays saisis ; identifiants des VASP), avec validation du schéma.
- Crée un petit service `services/vasp-mock` (processus séparé, stockage propre) qui joue un **VASP contrepartie**. Il s'expose via une API de type **TRP (Travel Rule Protocol)** : requête de transfert avec le payload IVMS101 signé (Ed25519 via `node:crypto`) → réponse « approved » ou « rejected » signée.
- **Annuaire simulé** adresse → VASP (ex. une adresse de démo appartenant à « Demo Exchange AG »). Logique :
  - destinataire géré par un VASP → transmission TRP **avant** la co-signature ; K2 ne signe qu'après une réponse « approved » ;
  - destinataire auto-hébergé → preuve de propriété (signature EIP-191 par le bénéficiaire, ou déclaration du client sous le seuil) ;
  - wallet vérifié du client → aucune donnée tierce nécessaire.
- Le justificatif PDF et la console conformité affichent le statut Travel Rule (transmis, approuvé, référence) **sans** données personnelles dans les logs.
- Documente : en production, connexion à un réseau Travel Rule réel (TRP / OpenVASP ou équivalent commercial), à choisir et valider avec la conformité.

### #12 Succession
- Dans Security → « **Legacy / beneficiaries** » : le client désigne un ou plusieurs héritiers (nom + adresse de wallet vérifiée par signature, ou wallet créé pour l'héritier). Enregistrement dans sq-bank.
- On-chain : un module **Delay D3** par Safe (cooldown 6 mois en prod, 5 min en démo), où l'adresse de l'héritier est autorisée à mettre en file. Le client en vie annule toute mise en file d'un simple veto (notifications fortes). Pour la production, documente le **module Zodiac Roles** qui limiterait l'héritier à « transférer vers sa propre adresse ».
- **Parcours hors chaîne** (simulé) dans la console : déclaration de décès + **certificat d'héritier** (documents fictifs), vérification par la conformité. Swissquote **ne bloque pas** l'exécution mais peut, avec l'exécuteur testamentaire, contester via le veto (K2 + une clé client si disponible). Documente l'articulation avec le droit successoral suisse (questions ouvertes pour un juriste).
- Ajoute à l'e2e : l'héritier met en file → délai → exécution → fonds sur l'adresse de l'héritier.

### #14 Appareil + papier + mot de passe perdus
- Option « **Trusted contact** » : le client ajoute une personne de confiance. La clé K3 est **redécoupée en Shamir 2 sur 4** (code papier, clé de sécurité physique, partenaire, contact de confiance) : reconstruction de K3 à partir des parts actuelles (code papier + clé de sécurité physique), nouvelle découpe, envoi chiffré de la part du contact (lien d'invitation simulé), invalidation des anciennes parts. Partenaire + contact de confiance suffisent alors.
- **Bilan de santé de la récupération** (Security → « Recovery health check ») tous les 6 mois, avec rappel : vérifier le code papier (checksum, sans le révéler), vérifier le mot de passe de sauvegarde, confirmer le contact de confiance. Score affiché : « Recovery: Strong / Weak ».
- Documente clairement le cas résiduel (tout perdu et pas de contact de confiance) et le rôle de D2.

### #16 Client sous la menace
- **Code de contrainte** (optionnel, défini dans Security) : saisi à la place du mot de passe, il ouvre une **vue leurre** (petit solde fictif plausible) et déclenche **en silence** le gel de la co-signature et une alerte « duress » dans la console Swissquote, sans aucun indice visible.
- **Limites protectrices** : plafond journalier choisi par le client. **Le baisser est immédiat, le relever prend 24 h** (démo 60 s), avec notification. Les envois vers un nouveau destinataire au-dessus d'un seuil ont toujours un délai.
- Tests : code de contrainte → vue leurre + gel effectif ; relèvement de limite → différé.

### #17 Rotation de K2
- Le signataire gère des **versions de K2** (`k2.v1`, `k2.v2`…), chiffrées au repos. Commande `npm run k2:rotate` : génère la nouvelle version et marque l'ancienne « retiring ».
- Pour chaque wallet : bannière « Security update » → transaction K1 + K2 (ancienne) : `swapOwner(K2.v1 → K2.v2)` + mise à jour de l'adresse K2 dans le Guard.
- La console admin affiche la progression (% de wallets migrés). Après la date limite, **l'ancienne K2 est refusée** par le signataire, même si elle est présentée.
- **Compromission de K2** : K2 seule ne permet rien (Guard + 2 sur 3). Procédure d'urgence documentée : rotation forcée à la prochaine connexion de chaque client, D1 comme filet de sécurité.
- Ajoute à l'e2e : rotation sur un wallet de test, puis signature avec la nouvelle K2 acceptée et l'ancienne refusée.

---

## 5. Phase D — Multi-chaînes et Bitcoin (si le temps le permet)

### #20 / #23 Même adresse sur une autre chaîne EVM
- Garde l'initializer du Safe **indépendant de la chaîne** : modules et Guard ajoutés après le déploiement. Le Safe peut alors être **redéployé à la même adresse** sur une autre chaîne EVM où les contrats canoniques Safe existent.
- `npm run redeploy -- <chainId>` (ex. Base Sepolia, Arbitrum Sepolia) : redéploie le Safe à l'adresse identique, puis exécute le même setup (modules + Guard). Cela permet de **récupérer des fonds envoyés par erreur sur une autre chaîne**. Démontre-le sur une seconde testnet si tu obtiens du gas (`POUR_NOA.md`).
- Interface : sélecteur de réseau (Ethereum Sepolia par défaut, + 1 autre), soldes par réseau, réseau toujours visible sur Receive et Send.

### #23 Bitcoin
- Même modèle de garde, sans MPC : **multisig Bitcoin natif 2 sur 3 (P2WSH)** sur **signet** (ou testnet), avec `bitcoinjs-lib` : clés BTC K1 (appareil), K2 (Swissquote, dans le signataire), K3 (secours, même découpe Shamir).
- Fonctions : adresse de réception, solde (API publique de type Esplora / mempool.space signet), envoi signé en PSBT par K1 + K2, puis diffusion.
- Récupération Bitcoin : pas de `swapOwner` en Bitcoin, donc **balayage** des fonds vers un nouveau multisig (K3 + K2). Documente la différence avec Ethereum (pas de délai on-chain natif, sauf scripts à timelock `CSV`, à proposer comme évolution).
- Si le temps manque : documentation complète (architecture, PSBT, récupération, alternative MPC/TSS) sans code.

---

## 6. Compte rendu pour Noa (obligatoire)

À la fin (et une version intermédiaire après chaque phase), écris **`docs/COMPTE_RENDU_SECURITE.md` en français simple**, sans jargon, ou avec chaque terme technique expliqué entre parenthèses. Pour **chaque problème traité** (2 à 23 sauf 18 et 22) :

```
### Problème N — <titre simple>
**Le risque, en une phrase :** …
**Ce que j'ai fait :** … (2–4 phrases)
**Pourquoi cette solution :** …
**Réel ou documenté :** ✅ codé et testé / 🟡 codé avec une partie simulée (laquelle) / 📄 documenté seulement (pourquoi)
**Comment le montrer au jury :** … (écran, bouton, lien Etherscan)
**Ce qui reste comme limite :** …
```

Ajoute en tête :
- un **schéma simple** des 3 clés + Guard + modules D1/D2/D3, avec qui peut faire quoi et en combien de temps ;
- un **tableau récapitulatif** des problèmes et de leur statut ;
- **les 5 phrases à dire au jury** sur la sécurité ;
- **les 5 questions difficiles probables** avec leur réponse.

Mets aussi à jour, en anglais : README (sections Security, Real vs Mock, Proof on Sepolia avec les nouveaux liens Etherscan), `THREAT_MODEL.md`, `LEGAL.md`, `docs/PRODUCTION_READINESS.md`, `docs/DEMO_SCRIPT.md` (nouvelles étapes de démo : veto d'une opération en attente, sortie protégée, Take full control, code de contrainte, réception externe, jeton arnaque masqué).

Termine par une entrée dans `POUR_NOA.md` : « ✅ Sécurité renforcée — lis docs/COMPTE_RENDU_SECURITE.md », avec les commandes pour lancer la démo.

---

## 7. Critères d'acceptation
- [ ] Travail en cours commité au départ ; un commit par problème ; e2e, tests et parcours navigateur verts à la fin
- [ ] Problèmes 18 et 22 **non traités**
- [ ] #2 écoute sur 127.0.0.1 ; #3 réceptions externes historisées, sans doublon ; #19 jetons inconnus masqués, sosies refusés ; #20 contrôles avant envoi
- [ ] Guard + D1 + D2 déployés et testés : K1 + K2 immédiat, toute autre combinaison différée, veto fonctionnel, K3 seule après le délai long
- [ ] Sortie protégée et Emergency mode fonctionnels **avec les services Swissquote arrêtés**
- [ ] Take full control démontré on-chain
- [ ] PRF (ou repli documenté), mot de passe de sauvegarde distinct, contact de confiance 2 sur 4, bilan de santé
- [ ] Travel Rule : IVMS101 + VASP simulé (processus séparé) + co-signature conditionnée
- [ ] Succession (D3 + parcours conformité), code de contrainte, limites différées, rotation de K2
- [ ] Phase D faite ou documentée
- [ ] `docs/COMPTE_RENDU_SECURITE.md` complet, en français simple
