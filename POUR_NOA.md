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
