# Justesse du verdict de coupure

> **Statut** : acté · **Dernière mise à jour** : 2026-08-29

La vision tient en une phrase : « obtenir la liste des restaurants sans coupure et fermés le
week-end de son arrondissement — **et que cette liste soit juste** ».

Aujourd'hui, 843 verdicts sur 4 465 reposent sur une règle de repli. Cette spec dit ce que la
mesure a répondu quand on lui a demandé si cette règle valait quelque chose — la réponse est
non — et où se trouve la justesse qu'on cherchait.

Rien de ce qui suit ne consomme un appel réseau. Tout se recalcule hors ligne.

---

## L'état constaté, 29 août 2026

| Verdict | Fiabilité | Fiches | |
|---|---|---|---|
| Sans coupure | confirmé | 2 236 | certitude structurelle : pas de coupure aux horaires |
| Coupure très probable | confirmé | 235 | effectif connu, petite équipe |
| Coupure possible | confirmé | 144 | effectif connu, équipe moyenne |
| Coupure peu probable | confirmé | **8** | effectif connu, grande équipe |
| **Coupure probable** | **probable** | **798** | **repli, effectif inconnu** |
| **Coupure possible** | **probable** | **45** | **repli, « forte amplitude »** |
| Horaires inconnus | à vérifier | 999 | dont 349 déclarés fermés, jamais listés (D29) |

Deux lignes se lisent ensemble. Le repli gouverne 843 fiches, et sur ces 843 la règle
d'amplitude — le seul discriminant qu'il contient — n'en déplace que **45**, soit 5 %. Pour
les 798 autres, le repli est une constante.

---

## 1. Aucun des signaux gratuits ne prédit l'effectif

La question se teste, et elle n'avait jamais été testée. Il existe un jeu de validation
naturel : les **387 établissements dont les horaires portent une coupure et dont l'effectif
est connu**. On y compare ce qu'un signal prédirait à ce que SIRENE dit.

Taux de base sur ce jeu : **61 % de petites équipes**, 37 % de moyennes, 2 % de grandes. Tout
signal qui ne s'écarte pas de 61 % n'apporte rien.

### L'amplitude hebdomadaire — le seuil de 70 h en vigueur

| Amplitude | Effectifs connus | Part capable de deux brigades |
|---|---|---|
| 2 à 20 h | 56 | 32 % |
| 20 à 30 h | 94 | 32 % |
| 30 à 40 h | 110 | 45 % |
| 40 à 50 h | 67 | 45 % |
| 50 à 60 h | 29 | 38 % |
| 60 à 70 h | 10 | 50 % |
| **70 à 78 h** | 12 | **42 %** |
| 80 h et plus | 9 | 33 % |

**Sous 70 heures : 39 %. Au-dessus : 38 %.** Le seuil ne sépare rien. Pire, la tranche
60-70 h, celle que la règle classe du côté « petite équipe », est la plus favorable de toute
la table à 50 %.

La règle affirme pourtant à 45 utilisateurs *« Coupure possible — forte amplitude »* là où
elle devrait dire *« Coupure probable »*. Ce n'est pas une approximation, c'est un verdict
faussement rassurant, et rassurant est la seule direction dans laquelle ce produit n'a pas le
droit de se tromper.

### La durée de la coupure

| Coupure la plus longue | Effectifs connus | Part de petites équipes |
|---|---|---|
| 2 h à 3 h | 10 | 80 % |
| 3 h à 4 h | 63 | 67 % |
| 4 h à 5 h | 144 | 57 % |
| 5 h et plus | 170 | 61 % |

L'intuition était bonne — deux heures et cinq heures ne se valent pas — mais elle ne se
vérifie pas : la pente s'inverse au dernier palier, et le seul écart net porte sur dix
établissements. Le signal existe peut-être ; il n'est pas mesurable ici.

### Le nombre de jours concernés, et la catégorie

Jours avec coupure, part de petites équipes : 75 %, 80 %, 68 %, 57 %, 61 %, 60 %, **38 %**
pour un à sept jours. Seul le sept-jours-sur-sept ressort, sur 34 établissements.

Catégorie, part capable de deux brigades : restaurant 39 %, fast-food 39 %, pizzeria 45 %,
bistrot 40 %, bar 29 %, café 33 %. Aucune séparation.

> **Ce que ça retire.** [`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md) recommandait d'enrichir
> le repli avec ces trois signaux, « la seule option qui améliore la justesse sans dépendre
> d'une source extérieure ». La mesure la réfute. L'axe était le bon, l'option ne l'était pas
> — et elle n'aurait pas été détectée sans jeu de validation, puisqu'une règle enrichie
> *paraît* toujours plus fine que la règle qu'elle remplace.

## 2. L'effectif ne manque pas : il est en base, et l'appariement ne va pas le chercher

**1 506 tranches d'effectif dorment dans notre propre base** : des enregistrements SIRENE
géocodés, porteurs d'une tranche, rattachés à aucun établissement.

L'appariement exige **deux** critères, dont l'un est éliminatoire : proximité sous 75 m **et**
similarité trigramme des noms ≥ 0,45. Or :

- **717 de ces enregistrements n'ont aucun nom.** Le critère ne peut pas être satisfait, à
  aucun seuil. Ils sont exclus par construction, pas par prudence.
- Pour ceux qui en ont un, c'est la raison sociale, pas l'enseigne. Sur les paires candidates
  à moins de 30 m d'un établissement en repli : **201 marquent 0,00** de similarité, une
  petite dizaine atteint 0,45.

Le nom n'est pas un filtre dans ce jeu de données, c'est un mur.

### Le discriminant que SIRENE fournit vraiment, c'est l'adresse

Validé contre les 1 585 appariements existants, tenus pour justes :

| | Mesure |
|---|---|
| Établissements avec **un seul** candidat SIRENE au même numéro de rue, sous 75 m | 735 |
| dont le candidat est le bon | **713 — 97,0 %** |
| Établissements avec plusieurs candidats au même numéro | 767 |
| dont le bon est parmi eux | 751 — 97,9 % |

Et ce que ça rattraperait, sur les établissements aujourd'hui non appariés porteurs d'un
verdict de repli : **305 des 621** ont exactement un candidat au même numéro de rue porteur
d'une tranche. 58 en ont plusieurs — ceux-là restent sans effectif.

> **Correction d'un chiffre qui a servi à arbitrer.** « Même un appariement parfait
> plafonnerait autour de 41 % » divisait les tranches connues par la population SIRENE.
> Rapporté aux établissements, ce qui est la seule mesure utile : **2 480 tranches
> exploitables pour 4 465 établissements, soit un plafond de 56 %**. On est à 22 %. Le levier
> est deux fois plus gros que ce qu'on croyait.

---

## Les règles

### 1. L'appariement se fonde sur l'adresse ; le nom départage, il n'exclut jamais

Critère principal : **même numéro de rue et proximité**. La similarité de nom devient un
critère de classement, appliqué quand plusieurs enregistrements se présentent au même numéro,
et ne peut plus écarter à elle seule un candidat par ailleurs cohérent.

Ce qui ne change pas, et qui est le principe : **mieux vaut une information manquante qu'une
information fausse.** Plusieurs candidats indiscernables au même numéro, c'est un
établissement laissé sans effectif. L'exclusivité reste entière — un enregistrement SIRENE
sert au plus un établissement, sans quoi le compte des non-appariés, qui est le canari du
balayage, mentirait dans le sens rassurant.

**La précision de la règle se mesure avant de l'appliquer**, sur les appariements existants,
et ne descend pas sous **95 %**. Mesurée aujourd'hui : 97 %.

> **Pourquoi 97 % suffit ici, alors que le projet refuse l'information fausse.** Parce que le
> verdict affiche son raisonnement, effectif compris — *« Coupure très probable — ouvert
> 12h-14h30 puis 19h-22h30, 3 à 5 salariés »*. Un professionnel du secteur lit cette phrase et
> voit immédiatement qu'un bouchon de quinze couverts n'a pas vingt salariés. L'explicabilité
> n'est pas un confort de présentation : c'est ce qui rend une règle à 97 % acceptable, là où
> un verdict nu ne le serait pas.

### 2. La règle de repli par amplitude est supprimée

Quand l'effectif est inconnu et que les horaires portent une coupure, le verdict est **Coupure
probable**, fiabilité **probable**. Sans condition, sans seuil, sans mention d'amplitude.

C'est ce que le jeu de validation soutient — 61 % de petites équipes — et c'est tout ce qu'il
soutient. Les 45 fiches aujourd'hui adoucies en *« Coupure possible — forte amplitude »*
repassent en *« Coupure probable »*. **Le produit devient moins rassurant sur 45 fiches, et
plus juste sur les 45.**

Les court-circuits structurels ne bougent pas : pas de coupure aux horaires, service unique,
restauration collective. Ce sont des certitudes, pas des replis.

### 3. Le filtre cesse de promettre une troisième réponse qu'il n'a pas

« Coupure peu probable » exige une grande équipe **et** une coupure aux horaires : 8
établissements sur 4 465, et 2 % du jeu de validation. Ce n'est pas un défaut de règle, c'est
un fait sur le secteur — une brigade de vingt personnes est rare en restauration lyonnaise
indépendante.

L'option de filtre *« Oui ou probablement »* ajoute donc **huit lignes** à *« Oui »*. Trois
choix pour deux résultats : l'option ment sur ce qu'elle promet et coûte à l'utilisateur une
décision pour rien.

**Le filtre de coupure devient binaire : *Sans coupure* ou *Peu importe*.** La fiabilité
continue de s'afficher sur chaque résultat, en mots, jamais comme un axe de filtre : elle
qualifie un verdict, elle n'en sélectionne pas.

---

## Options écartées

- *Enrichir le repli avec la durée de coupure, le nombre de jours et la catégorie.* C'était la
  piste recommandée. Mesurée sur 387 établissements, aucune ne s'écarte du taux de base. Une
  règle plus fine qui ne prédit pas mieux n'est pas une amélioration, c'est une complication
  qu'on ne saura plus retirer.
- *Abaisser le seuil de similarité de nom.* Ne touche pas les 717 enregistrements sans nom, et
  dégrade la précision là où le nom existe. Le seuil n'est pas le problème ; le caractère
  éliminatoire du critère l'est.
- *Redéfinir « peu probable » pour englober les équipes moyennes.* Rendrait l'option peuplée
  — 2 388 fiches — en appelant « peu probable » ce que la règle appelle « possible ». Le
  problème n'est pas que l'option soit vide, c'est qu'elle affirmerait le contraire du verdict.
- *Afficher un score de fiabilité chiffré pour rendre l'incertitude lisible.* La vision
  l'interdit explicitement : des mots, jamais un pourcentage.
- *Aller chercher l'effectif ailleurs qu'à SIRENE.* Aucune source gratuite et exhaustive
  n'existe (D4), et le plafond de 56 % est une propriété de SIRENE, pas de notre appariement.
- *Assumer le plafond et le dire, sans rien changer.* Défendable à 41 % de plafond, beaucoup
  moins à 56 % quand on est à 22 % : on renoncerait devant un chiffre faux.

---

## Comment on saura que c'est réparé

Tout se vérifie hors ligne, sur une copie locale (`db:pull`), sans un appel réseau.

1. La précision de la règle d'appariement, mesurée sur les 1 585 appariements existants, est
   **≥ 95 %**.
2. `match:sirene` à sec annonce **au moins 1 700 établissements avec effectif**, contre 974.
3. Un établissement avec plusieurs candidats au même numéro reste **sans effectif**.
4. Aucun enregistrement SIRENE n'est utilisé deux fois.
5. Après `compute:profiles` : **zéro fiche en « possible / probable »** — la règle d'amplitude
   n'existe plus. Les 45 concernées sont passées en « Coupure probable ».
6. Le nombre de verdicts en repli baisse d'environ 300 ; aucun ne bascule vers *Sans coupure*,
   qui reste une certitude structurelle.
7. Le filtre de coupure propose deux réponses, et le compte derrière chacune correspond à la
   base.
8. Aucune fiche ne gagne ni ne perd d'horaires : cette spec ne touche qu'à l'effectif et aux
   règles qui le lisent.

Et le critère qui ne se mesure pas : les explications affichées doivent rester lisibles par un
professionnel. Un effectif rattrapé par l'adresse qui produit une phrase absurde est un
appariement faux, pas une donnée surprenante.
