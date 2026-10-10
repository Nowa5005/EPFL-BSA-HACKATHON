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

### Étape 2 — NON BLOQUANT (plus tard) — Recevoir de l'USDC de test
Je te donnerai l'adresse du wallet de démo quand il sera créé. Il faudra aller sur https://faucet.circle.com, choisir **Ethereum Sepolia**, coller l'adresse, et cliquer « Send 10 USDC ». (Je te le redemanderai avec l'adresse exacte.)

### Étape 3 — NON BLOQUANT (plus tard) — Tester Touch ID dans Chrome
Quand l'app web sera prête, il faudra ouvrir http://localhost:5173 dans Chrome et poser le doigt sur Touch ID quand on te le demande. (Je te redirai.)

### Étape 4 — NON BLOQUANT — `git push`
Si GitHub demande une connexion, je te mettrai les étapes ici.

**Si tu bloques, copie-colle ce prompt à Claude (dans le chat) :**
> Je fais un hackathon, mon agent Claude Code me demande d'envoyer de l'ETH de test (réseau Ethereum Sepolia) à l'adresse 0xba45B64A7c1954aC12D6ceF82672150145d976a6 en utilisant un « faucet » comme https://cloud.google.com/application/web3/faucet/ethereum/sepolia. Explique-moi pas à pas comme à une débutante sur Mac, et dis-moi quoi faire si le faucet refuse.

---
