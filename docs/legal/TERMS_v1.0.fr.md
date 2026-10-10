# My Wall — Conditions d'utilisation (annexe : traduction française)

**Version 1.0 — 10.10.2026**

> **Prototype — pas un avis juridique, à faire relire par le service juridique de Swissquote.** Ces conditions ont été rédigées pour le Swissquote Wallet Challenge (hackathon EPFL) afin de montrer comment le service réel serait décrit à un client. Elles décrivent le produit tel qu'il est construit dans ce prototype. Elles n'ont pas été relues par un juriste et ne sont proposées à personne. **Traduction de la version anglaise (`TERMS_v1.0.md`), qui fait foi en cas de différence.** L'interface de My Wall est en anglais et affiche la version anglaise.

## En bref (5 points)

1. **Vous gardez le contrôle de vos fonds.** Votre wallet exige 2 clés sur 3. Swissquote n'en détient qu'une : il ne peut jamais déplacer vos fonds seul.
2. **Vous protégez vos secrets.** Votre appareil et votre mot de passe, votre code de récupération papier et votre clé de sécurité physique sont sous votre garde. Swissquote ne peut ni les lire ni les réinitialiser.
3. **Swissquote co-signe selon des règles publiées.** Chaque refus est motivé. Si Swissquote refuse ou est indisponible, la sortie protégée vous permet de déplacer vos fonds après un délai on-chain de 48 heures.
4. **Des frais clairs.** La commission n'est prélevée que sur les échanges (0,80 % avec l'offre Free, moins avec Plus ou Pro). Les frais de réseau sont payés par Swissquote dans la limite d'un quota journalier.
5. **Les crypto-actifs comportent des risques.** Les cours varient et une transaction confirmée est irréversible. Ce prototype fonctionne sur le réseau de test Ethereum Sepolia : rien n'a de valeur réelle.

---

## 1. Les parties et le service

1.1 Les présentes conditions d'utilisation (« Conditions ») régissent l'utilisation de **My Wall**, le wallet crypto en self-custody (garde par le client) proposé par Swissquote Bank SA (« Swissquote », « nous ») à ses clients existants (« vous »).

1.2 My Wall est **un logiciel et un service de co-signature de sécurité**. Votre wallet est un **compte Safe** (un contrat intelligent open source et audité sur la blockchain Ethereum) avec trois clés propriétaires et un seuil de deux. Swissquote fournit l'application, détient une des trois clés, contrôle chaque transaction selon les règles de la section 4 et paie les frais de réseau dans les limites de la section 10.

1.3 My Wall n'est accessible qu'aux clients dont Swissquote a déjà vérifié l'identité (KYC). Il est rattaché à votre relation client Swissquote, dont les conditions générales s'appliquent aussi. En cas de contradiction sur un point propre à My Wall, les présentes Conditions prévalent.

## 2. Non-dépôt : qui détient quelle clé

2.1 Votre wallet est contrôlé par trois clés :

| Clé | Qui la détient | À quoi elle sert |
|---|---|---|
| **K1 — clé de l'appareil** | Vous | Créée sur votre appareil, chiffrée avec votre mot de passe de wallet et utilisable seulement après votre passkey (Touch ID / Face ID). Sert à signer au quotidien. |
| **K2 — clé du co-signataire** | Swissquote | Conservée par Swissquote (dans un module matériel de sécurité, HSM, en production). Ne signe qu'après les contrôles de la section 4. |
| **K3 — clé de secours** | Vous | Jamais conservée en un seul morceau. Elle est découpée en parts : votre **code de récupération papier**, une part protégée par votre **clé de sécurité physique**, et une part détenue par un **partenaire de récupération** indépendant (et, si vous le choisissez, un **contact de confiance** — section 5.6). Deux parts suffisent à la reconstituer. |

2.2 **Swissquote ne peut pas déplacer vos fonds seul.** Il détient une clé sur trois ; la blockchain en exige deux. Swissquote et le partenaire de récupération ensemble ne peuvent pas non plus reconstituer K3.

2.3 **Vos crypto-actifs ne sont pas des dépôts** et n'apparaissent pas au bilan de Swissquote. Ils ne sont pas couverts par la garantie des dépôts suisse. Comme vous pouvez toujours les déplacer sans Swissquote (section 6), Swissquote ne les détient pas en garde. *(Note pour le service juridique : cette qualification au regard de la pratique FINMA est à confirmer — voir `docs/LEGAL.md`.)*

2.4 My Wall n'utilise **pas de phrase secrète de 12 ou 24 mots**. La sécurité repose sur les trois clés, dont deux sont toujours nécessaires.

2.5 **Règles de sécurité inscrites dans la blockchain.** En plus de la règle 2 sur 3, votre wallet comporte un **garde** (Guard) et des **modules de délai** :

| Signatures | Effet |
|---|---|
| Votre clé d'appareil **et** Swissquote (K1 + K2) — usage normal | Exécution immédiate, après les contrôles de Swissquote |
| Toute autre combinaison de deux clés (par exemple clé de secours + Swissquote, ou clé d'appareil + clé de secours sans Swissquote) | Jamais immédiate : mise en file pendant **48 heures** (délai **D1**), pendant lesquelles vous pouvez vous y opposer (veto) |
| Clé de secours seule (K3) | Mise en file pendant **30 jours** (délai **D2**), veto possible |
| Un héritier désigné (section 7) | Mise en file pendant **6 mois** (délai **D3**), veto possible |
| Annulation d'une opération en attente (veto) | Immédiate, avec deux clés quelconques |

Le contrat de garde est propre à My Wall et n'a pas encore été audité de façon indépendante (voir `docs/PRODUCTION_READINESS.md`). Les modules de délai sont le Zodiac Delay Modifier, open source.

## 3. Vos responsabilités

3.1 Vous devez protéger et ne jamais partager :
- votre **appareil** et son verrouillage d'écran, ainsi que votre **passkey** ;
- votre **mot de passe de wallet** (il chiffre la clé de votre appareil sur votre appareil ; Swissquote ne le reçoit jamais) ;
- votre **code de récupération papier** (hors ligne, idéalement en deux endroits, jamais photographié ni stocké dans le cloud) ;
- votre **clé de sécurité physique** (par exemple une clé FIDO2), qui protège une part de votre clé de secours ;
- votre éventuel **code de contrainte** (section 5.7).

3.2 Swissquote **ne peut ni retrouver ni réinitialiser** votre mot de passe, votre code papier ou votre clé de sécurité physique. Si vous perdez en même temps votre appareil, votre code papier et votre clé de sécurité physique sans avoir choisi de contact de confiance, la récupération à long terme (délai D2, section 5.4) peut être votre seule option, et vos fonds peuvent dans certains cas devenir inaccessibles.

3.3 Vous vérifiez chaque transaction avant de la confirmer : l'adresse du destinataire, le réseau (Ethereum), l'actif et le montant. My Wall affiche un résumé en langage clair de chaque transaction ; une transaction confirmée et exécutée **est irréversible**.

3.4 Vous tenez vos coordonnées à jour afin que nous puissions vous avertir d'une opération en attente sur votre wallet, et vous lisez ces avertissements rapidement. Votre veto (section 5.2) ne vous protège que si vous agissez pendant le délai.

3.5 Vous effectuez le **bilan de santé de la récupération** quand l'application vous le rappelle (tous les 6 mois), pour vérifier que vos moyens de récupération fonctionnent toujours.

3.6 Vous n'utilisez pas My Wall à des fins illicites, pour contourner des sanctions ou pour le compte d'un tiers.

## 4. Le co-signataire Swissquote

4.1 **Rôle.** Le co-signataire de Swissquote contrôle chaque transaction que vous signez et ajoute la seconde signature quand les règles sont respectées. Ces règles sont publiées dans l'application et comprennent : la confirmation par votre passkey liée à la transaction exacte, le filtrage du destinataire contre les listes de sanctions (section 8), les données Travel Rule quand elles sont exigées (section 8), des limites journalières, des contrôles renforcés au-delà d'un seuil (code par email, délai de réflexion, validation à quatre yeux par un responsable conformité), une liste d'applications autorisées (dApps), et le refus d'interagir avec des jetons inconnus ou des adresses sosies.

4.2 **Refus motivés.** Si le co-signataire refuse une transaction, l'application vous indique le motif précis, la règle concernée et comment résoudre le problème. Les refus sont inscrits dans un journal que vous pouvez consulter. Swissquote ne refuse de co-signer que pour des raisons légales ou réglementaires, pour vous protéger d'une fraude probable, ou parce qu'une règle que vous avez acceptée n'est pas respectée.

4.3 **Délais de réponse.** Une transaction conforme est co-signée en moins de 60 secondes. Une transaction qui nécessite une revue humaine est tranchée en moins de 24 heures (jours ouvrables ; valeurs cibles, voir `docs/COSIGNER_COMMITMENTS.md`). Vous pouvez contester un refus selon la procédure décrite dans ce document.

4.4 **Suspension.** Swissquote peut suspendre la co-signature de votre wallet (par exemple sur ordre légal, correspondance avec une liste de sanctions ou soupçon de compromission). Une suspension est visible dans l'application. Elle n'empêche jamais la sortie protégée de la section 6, qui ajoute seulement le délai de 48 heures.

4.5 **Rotation de clé.** Swissquote peut remplacer sa clé (K2) pour des raisons de sécurité. Il vous sera alors demandé de confirmer une « Security update » dans l'application ; l'ancienne clé Swissquote est refusée après la date annoncée. Vos fonds et l'adresse de votre wallet ne changent pas.

## 5. Délais de sécurité, veto et récupération

5.1 **Pourquoi des délais.** Hormis l'usage normal (K1 + K2), aucune opération sur votre wallet n'est immédiate. Même une personne qui obtiendrait deux clés, ou Swissquote et le partenaire de récupération agissant ensemble, ne peut donc pas déplacer vos fonds sans que vous soyez averti et puissiez réagir.

5.2 **Veto.** Dès qu'une opération est mise en file dans un module de délai, My Wall vous prévient (notification dans l'application, email et bannière rouge « A protected operation is pending on your wallet »). Vous pouvez l'annuler en une action (« Cancel it »), avec votre clé d'appareil et une autre clé.

5.3 **Appareil perdu (récupération).** Si vous perdez votre appareil, vous pouvez récupérer votre wallet avec l'aide de Swissquote : contrôles d'identité (dont une preuve de vie comparée à votre photo KYC), votre code de récupération, puis remplacement de la clé de votre appareil, mis en file **48 heures** (D1) avant exécution. Vous êtes averti par votre compte Swissquote pendant ce délai.

5.4 **Récupération à long terme.** Si ni votre appareil ni Swissquote ne sont disponibles, votre clé de secours seule peut déplacer vos fonds après **30 jours** (D2).

5.5 **Valeurs des délais.** Les délais ci-dessus sont ceux de la production. Le prototype utilise des valeurs de démonstration courtes (des minutes au lieu de jours). Baisser une protection est immédiat ; relever une limite que vous avez fixée (par exemple votre plafond journalier) prend effet après 24 heures.

5.6 **Contact de confiance (facultatif).** Vous pouvez désigner une personne de confiance. Votre clé de secours est alors découpée en quatre parts (code papier, clé de sécurité physique, partenaire de récupération, contact de confiance), dont deux suffisent. Votre contact de confiance seul ne peut ni reconstituer la clé ni déplacer vos fonds, et toute récupération passe toujours par les délais ci-dessus.

5.7 **Code de contrainte (facultatif).** Vous pouvez définir un code de contrainte. Saisi à la place de votre mot de passe, il ouvre une vue leurre, suspend la co-signature en silence et alerte Swissquote. Ne l'utilisez que si vous êtes menacé. Swissquote vous contactera ensuite par vos canaux vérifiés avant de rétablir la co-signature.

## 6. Sortie protégée et « Take full control »

6.1 **Sortie protégée.** Vous pouvez toujours déplacer vos fonds **sans Swissquote** : avec la clé de votre appareil et votre clé de secours reconstituée (code papier et clé de sécurité physique), vous mettez en file un transfert vers l'adresse de votre choix. Il est exécuté après **48 heures** (D1). Cela fonctionne même si les services de Swissquote sont indisponibles (« Emergency mode », qui lit directement la blockchain). Une petite **réserve de gas d'urgence** déposée dans votre wallet à sa création ne sert qu'à cet usage.

6.2 **Prendre le contrôle total.** Vous pouvez mettre fin au service de co-signature à tout moment depuis Security → « Take full control of my wallet ». La clé de Swissquote est alors remplacée par une clé que vous contrôlez (une nouvelle clé enregistrée dans un fichier chiffré, ou un wallet externe dont vous prouvez la propriété par signature), et le garde et les modules de délai sont retirés ou conservés, à votre choix. Si Swissquote coopère, c'est immédiat ; sinon, l'opération passe par le délai de 48 heures.

6.3 Après la prise de contrôle totale, votre wallet est un Safe standard utilisable avec d'autres logiciels (par exemple app.safe.global). La co-signature, les contrôles de conformité, les frais offerts, l'assistance à la récupération et le support de Swissquote prennent fin pour ce wallet, et les protections des sections 4 et 5 ne s'appliquent plus.

## 7. Succession

7.1 Vous pouvez désigner un ou plusieurs **héritiers** dans Security → « Legacy / beneficiaries », avec une adresse de wallet dont ils prouvent la propriété par signature.

7.2 Un héritier désigné peut mettre en file un transfert de vos fonds vers sa propre adresse. Il est exécuté après **6 mois** (D3). De votre vivant, vous pouvez l'annuler par un simple veto, et vous êtes fortement averti.

7.3 En parallèle, Swissquote traite le dossier hors chaîne (acte de décès, certificat d'héritier) selon ses procédures de succession habituelles. Swissquote ne bloque pas l'exécution on-chain, mais peut, avec l'exécuteur testamentaire, la contester par le mécanisme de veto. La désignation d'un héritier dans My Wall ne remplace pas un testament et ne tranche pas les questions de droit successoral suisse (réserves héréditaires, communauté héréditaire) ; ces points sont à revoir par le service juridique de Swissquote.

## 8. Conformité

8.1 **Filtrage des sanctions.** Chaque destinataire et chaque application avec laquelle votre wallet interagit sont contrôlés contre les listes de sanctions (SECO, OFAC, UE) et des données d'analyse de risque blockchain. Swissquote refuse de co-signer une transaction vers une adresse sanctionnée et peut la signaler aux autorités compétentes comme la loi l'exige. *(Prototype : une liste de démonstration contenant de vraies adresses publiques de l'OFAC.)*

8.2 **Travel Rule.** Les règles suisses de lutte contre le blanchiment (OBA-FINMA art. 10, communication FINMA 02/2019) exigent que des informations sur le donneur d'ordre et le bénéficiaire accompagnent les transferts. Quand vous envoyez vers **le wallet de quelqu'un d'autre**, My Wall demande le nom du bénéficiaire et, au-delà de certains montants, des informations complémentaires. Ces informations sont transmises au format **IVMS101** au prestataire du bénéficiaire (VASP) avant la co-signature ou, pour un wallet auto-hébergé, la propriété du bénéficiaire est prouvée par signature. Les transferts vers **vos propres wallets vérifiés** ne demandent aucune donnée de tiers.

8.3 **Vérification des wallets.** Avant d'envoyer vers un autre de vos wallets ou de recevoir depuis celui-ci, vous prouvez que vous le contrôlez en signant un message standard (« Sign-In with Ethereum », EIP-4361) ou, pour un compte intelligent, une signature EIP-1271. La signature n'est pas une transaction et ne coûte rien. Votre wallet My Wall est vérifié automatiquement à sa création.

8.4 Nous pouvons vous demander des informations complémentaires sur une transaction ou l'origine des fonds. À défaut, Swissquote peut refuser de co-signer.

## 9. Frais, offres et abonnements

9.1 **Commission.** Une commission de service s'applique **uniquement aux échanges éligibles (swaps)** entre crypto-actifs dans My Wall. Elle n'est jamais prélevée sur les transferts entrants ou sortants, les autorisations ou les révocations.

| Offre | Prix | Commission sur les échanges éligibles |
|---|---|---|
| Free | 0 € | 0,80 % |
| Plus | 7 € / mois, ou 70 € / an (payés en une fois ou en 12 mensualités avec engagement de 12 mois) | 0,40 % |
| Pro | 15 € / mois, ou 150 € / an (payés en une fois ou en 12 mensualités avec engagement de 12 mois) | 0,20 % |

9.2 Les réductions des offres ne s'appliquent qu'à la commission de Swissquote, pas aux frais de réseau ni aux frais des partenaires (liquidité), refacturés au coût. Le coût total est affiché avant la confirmation d'un échange. Aucune marge cachée dans le taux de change.

9.3 **Abonnements.** Un abonnement mensuel peut être résilié à tout moment et prend fin à la prochaine échéance. Un abonnement annuel payé en une fois court 12 mois. Un abonnement annuel payé en mensualités vous engage pour 12 mois. Les prix incluent la TVA le cas échéant. *(Prototype : aucun paiement n'est encaissé ; la souscription fonctionne en mode démonstration. Les échanges sont cotés mais pas exécutés.)*

9.4 Swissquote peut modifier ses prix selon la section 15. Une hausse de prix est une modification substantielle.

## 10. Frais de réseau offerts et quotas

10.1 Chaque transaction Ethereum coûte des frais de réseau (« gas »). En usage normal, **Swissquote paie ces frais pour vous** : vous n'avez pas besoin de détenir des ETH.

10.2 Cette prise en charge est limitée à **20 transactions par jour** et par client, et à un montant maximal de gas par transaction, pour éviter les abus. Au-delà du quota, le co-signataire refuse de prendre en charge la transaction et vous explique pourquoi ; vous pouvez réessayer le lendemain.

10.3 La **réserve de gas d'urgence** (section 6.1) ne peut pas être dépensée en usage normal.

10.4 Swissquote peut modifier ce quota selon la section 15. Les frais de réseau des opérations hors usage normal (sortie protégée, récupération à long terme, opérations après « Take full control ») sont payés depuis votre wallet.

## 11. Données personnelles

11.1 Swissquote traite vos données personnelles selon la loi fédérale sur la protection des données (nLPD) et sa déclaration de confidentialité. Pour My Wall, cela comprend : l'adresse et les transactions de votre wallet, les identifiants de votre appareil et de votre passkey, les données Travel Rule que vous fournissez, la trace de votre acceptation des présentes Conditions (version, date et appareil) et les journaux des décisions de co-signature.

11.2 **Ce que Swissquote ne reçoit jamais :** votre mot de passe de wallet, la clé de votre appareil, votre code de récupération papier ou votre clé de secours complète.

11.3 **Une blockchain publique reste publique.** Les transactions de votre wallet sont visibles par tous sur Ethereum. Votre réglage de confidentialité (« vue consolidée complète », « solde uniquement » ou « aucune ») détermine comment Swissquote affiche et utilise les données du wallet dans votre compte Swissquote ; il ne change pas ce qui est visible sur la blockchain. Les contrôles de conformité s'appliquent toujours.

11.4 Les données Travel Rule sont conservées 10 ans comme l'exige la loi sur le blanchiment d'argent et ne sont jamais écrites sur la blockchain, dans les notifications ou dans les journaux.

11.5 Le partenaire de récupération et le prestataire du bénéficiaire (Travel Rule) ne reçoivent que les données nécessaires à leur rôle.

## 12. Risques des crypto-actifs

12.1 La valeur des crypto-actifs peut varier fortement et tomber à zéro. Les stablecoins (comme l'USDC) dépendent de leur émetteur et peuvent perdre leur parité. Les contre-valeurs en CHF affichées dans My Wall sont **indicatives**.

12.2 Les transactions blockchain sont **irréversibles**. Un transfert vers une mauvaise adresse, vers l'adresse d'un contrat de jeton ou sur le mauvais réseau peut être perdu. My Wall effectue des contrôles avant l'envoi mais ne peut pas garantir que toute erreur sera détectée.

12.3 Les contrats intelligents et les blockchains peuvent contenir des failles inconnues. Les réseaux peuvent être congestionnés, scindés ou attaqués. Les jetons inconnus envoyés sur votre wallet sont souvent des arnaques : My Wall les masque et ne vous laisse pas interagir avec eux.

12.4 Rien dans My Wall ne constitue un conseil en placement. Les informations de marché et les contenus pédagogiques sont fournis à titre d'information.

## 13. Réseau de test (ce prototype)

13.1 Ce prototype fonctionne sur **Ethereum Sepolia**, un réseau de test public. Les jetons de test (ETH et USDC de test) n'ont **aucune valeur monétaire** et ne peuvent pas être échangés contre de l'argent.

13.2 Certains composants sont simulés (par exemple la vérification d'identité, le partenaire de récupération, le prestataire contrepartie pour la Travel Rule, les paiements et les emails). La page « About this prototype » indique ce qui est réel et ce qui est simulé.

## 14. Disponibilité

14.1 Swissquote s'efforce de garder My Wall disponible en permanence mais ne garantit pas un service sans interruption. Si les services de Swissquote sont injoignables, l'application vous le signale et propose l'**Emergency mode** : vos soldes sont lus directement sur la blockchain et la sortie protégée (section 6.1) reste disponible.

## 15. Modification des présentes Conditions

15.1 Swissquote peut modifier les présentes Conditions. Chaque version porte un numéro et une date, et les changements sont résumés en langage clair dans Information → « My Wall updates ».

15.2 Une **modification substantielle** (qui touche vos droits, vos obligations, les frais, les quotas, les délais ou l'usage de vos données) exige votre **nouvelle acceptation** à la prochaine ouverture de My Wall. Tant que vous ne l'avez pas acceptée, vous ne pouvez pas utiliser les écrans du wallet, mais la sortie protégée et Take full control restent à votre disposition.

15.3 Une **modification non substantielle** (formulation, précisions, corrections) est annoncée à titre d'information et ne demande pas de nouvelle acceptation.

15.4 Vous pouvez à tout moment voir la version acceptée, sa date, et la télécharger en PDF (Settings, et Swaplet → Documents → Legal).

## 16. Responsabilité

16.1 Swissquote répond des dommages causés par une violation intentionnelle ou par négligence grave des présentes Conditions. Dans la mesure permise par la loi, Swissquote ne répond pas des pertes résultant : de transactions que vous avez confirmées, de la perte ou de la divulgation de vos secrets (section 3), du fonctionnement des blockchains, des contrats intelligents ou des applications tierces, des mouvements de marché, ou de refus de co-signer conformes à la section 4.

16.2 Rien dans les présentes Conditions ne limite une responsabilité qui ne peut pas l'être selon le droit suisse. *(À revoir par le service juridique, notamment l'art. 100 CO.)*

## 17. Fin du service

17.1 Vous pouvez cesser d'utiliser My Wall à tout moment, notamment par « Take full control » (section 6.2). Vos fonds restent à vous.

17.2 Swissquote peut mettre fin au service de co-signature avec un préavis de deux mois, ou immédiatement pour de justes motifs (par exemple une obligation légale). Dans tous les cas, vous conservez la sortie protégée et Take full control, et Swissquote vous aide à déplacer vos fonds.

## 18. Droit applicable et for

18.1 Les présentes Conditions sont régies par le **droit suisse**. Le for est celui prévu par les conditions générales de votre relation client Swissquote, sous réserve des fors impératifs en faveur des consommateurs. *(À confirmer par le service juridique de Swissquote.)*

## 19. Contact

Questions, réclamations ou contestation d'un refus : par la messagerie sécurisée de votre compte Swissquote. *(Prototype : aucun canal de contact réel.)*

---

*My Wall — Conditions d'utilisation, version 1.0 du 10.10.2026 (traduction). Prototype — Swissquote Wallet Challenge (EPFL). Pas un avis juridique, à faire relire par le service juridique de Swissquote.*
