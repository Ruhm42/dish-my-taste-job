# Convergence du balayage

> **Statut** : acté · **Dernière mise à jour** : 2026-08-29

[`10-reprise-du-balayage.md`](10-reprise-du-balayage.md) a réparé le compteur : à partir de
septembre, la reprise dépense à nouveau. Elle laissait ouverte la question qu'elle nommait
comme un seul arbitrage — combien coûte la couverture complète, et que fait-on des horaires
qui périment pendant qu'on la paie.

Cette spec la tranche. Et elle la tranche autrement que prévu, parce que la mesure a déplacé
le problème : **le balayage ne converge pas parce que sa façon de résoudre une troncature ne
réduit pas la densité.** Ce n'est ni le périmètre, ni le plafond.

Rien de ce qui suit ne demande de dépenser un appel pour être décidé.

---

## L'état constaté, 29 août 2026

Lu en base de production.

| | Mesure |
|---|---|
| Cellules mères (profondeur 0) | 653 — dont **166 tronquées**, soit 25 % |
| Cellules filles créées | 664 en profondeur 1, 184 en profondeur 2 |
| Cellules jamais interrogées | **601** |
| Appels dépensés | 900 |
| Fiches avec horaires | 3 466, expirant les **27 septembre** (635) et **28 septembre** (2 831) |
| Tarif au-delà du quota | **35 $ / 1 000 appels** (`Nearby Search` Enterprise) |

---

## 1. Ce que la subdivision en quatre achète réellement

Mesuré sur les 212 cellules tronquées et leurs 848 filles :

| | Mesure |
|---|---|
| Filles par cellule tronquée | 4,0 |
| Rayon de la fille / rayon de la mère | 0,72 |
| SIRENE cumulés des filles / SIRENE de la mère | **4,18** |
| SIRENE par cellule, mère → fille | **17,3 → 15,3**, soit **−12 %** |

**Quatre appels pour retirer 12 % de la densité.** Quatre cercles de rayon 0,72 R posés pour
couvrir un disque de rayon R se recouvrent massivement — ils totalisent 2,07 fois l'aire de
leur mère, et le cœur dense tombe dans les quatre. La fille moyenne, à 15,3 SIRENE, retombe
exactement dans la tranche qui tronque le plus.

C'est là toute l'explication de l'interblocage. Chaque niveau de subdivision multiplie le
coût par quatre et n'écarte presque rien de ce qui a causé la troncature.

## 2. La troncature est prévisible avant de dépenser

Taux de troncature mesuré sur les 900 appels déjà passés, par densité SIRENE de la cellule —
une donnée connue **avant** l'appel :

| SIRENE dans la cellule | Cellules interrogées | Tronquées | Taux |
|---|---|---|---|
| 1 à 4 | 230 | 2 | 1 % |
| 5 à 9 | 217 | 14 | 6 % |
| 10 à 14 | 137 | 22 | 16 % |
| 15 à 19 | 255 | 139 | **55 %** |
| 20 à 29 | 37 | 13 | 35 % |
| 30 et plus | 23 | 22 | **96 %** |

> Le creux à 35 % sur la tranche 20-29 ne contredit pas la table : elle ne compte que 37
> cellules, et ce sont surtout des filles de rayon réduit. Les deux tranches qui l'encadrent,
> à 55 % et 96 %, portent le signal.

Et les 601 cellules en attente sont **plus denses que la moyenne de celles déjà faites** :
107 sont entre 15 et 19, 111 entre 20 et 29, 51 au-dessus de 30. **269 d'entre elles, 45 %,
sont dans la zone où plus d'une sur deux tronque.** Les interroger telles quelles, c'est
acheter environ 180 troncatures, donc 720 cellules filles qui tronqueront à leur tour.

## 3. La constante de calibrage regarde le mauvais bout de la distribution

`GOOGLE_TO_SIRENE_RATIO` vaut **1,16** en configuration. Mesuré sur les 687 cellules qui
n'ont pas tronqué — les seules où le compte Google est un vrai compte et non un plafond :

| | Ratio Google / SIRENE |
|---|---|
| Moyenne | 0,91 |
| Médiane | 0,86 |
| **9ᵉ décile** | **1,57** |

> Le 0,78 cité jusqu'ici (4 465 Google pour 5 720 SIRENE) n'est pas le bon chiffre non plus :
> il divise une récolte **incomplète** par une population **complète**. Il décrit l'avancement
> du balayage, pas le rendement d'une cellule.

Une cellule est tronquée par ce qu'elle a d'extrême, jamais par sa moyenne. Dimensionner sur
0,91 revient à dire « une cellule de 20 SIRENE rend 18 résultats » — vrai pour la cellule
médiane, faux pour une sur dix, et ce sont précisément ces cellules-là qui coûtent, puisque
chacune déclenche quatre appels. C'est la même erreur que D22 avait déjà corrigée sur
l'échantillon de calibrage : la densité extrême gouverne le coût.

---

## Les règles

### 1. La fraîcheur prime sur la complétude

Une base incomplète reste utile : on y cherche, on y trouve, ce qui manque est annoncé. Une
base périmée n'est pas seulement fausse, elle sort des CGU (D7) — et son contenu ne peut plus
être affiché du tout.

**Chaque cycle mensuel sert d'abord les cellules dont le contenu expire, de la plus ancienne
à la plus récente ; ce qui reste de quota va à la découverte.**

Cela change la règle de reprise, qui ne rejouait jamais une cellule `done`. **`done` veut dire
« faite dans cette période », pas « faite une fois pour toutes ».** Puisque tout le contenu
expire à 30 jours, chaque cellule doit être interrogée une fois par période de toute façon ;
la règle de D22 — ne pas rejouer — reste vraie **à l'intérieur** d'une période, et cesse de
l'être d'une période à l'autre.

Il n'y a donc pas un budget « rafraîchissement » et un budget « découverte » à répartir : il y
a **un seul plan, parcouru dans l'ordre d'expiration du contenu qu'il couvre**. Ce qui n'entre
pas dans le quota de la période reste vieux, est compté, et le bandeau le dit.

> **Ce que ça retire à une intuition confortable.** On aurait pu croire que rafraîchir coûte
> 688 appels — les cellules `done`, qui ne tronquent pas. C'est faux : les 212 cellules
> tronquées ont elles aussi produit du contenu stocké (4 240 lieux renvoyés contre 5 130 pour
> les `done`), et ce contenu expire aux mêmes dates. Le contenu en base vient des **900**
> cellules interrogées, pas des 688 abouties. Sous le plan actuel, le rafraîchir coûte donc
> tout le quota mensuel et ne laisse rien à la découverte — c'est ce qui rend les règles 2 et 3
> nécessaires, et pas seulement élégantes.

> Le plafond **journalier** de 800 (D15) impose au moins deux exécutions sur deux jours UTC
> distincts pour dépenser 1 000 appels dans le mois. C'est déjà couvert par
> [`10`](10-reprise-du-balayage.md) ; la planification doit simplement pouvoir être rejouée.

### 2. Une troncature se résout par une replanification locale, pas par une division en quatre

La cellule tronquée n'est plus découpée en quatre cercles plus petits au même endroit. Son
emprise est **replanifiée depuis la densité SIRENE qu'elle contient**, en autant de cellules
que nécessaire pour que chacune tienne sous le plafond de densité.

Une cellule de 30 SIRENE devient trois cellules de 10, pas quatre cellules de 26.

La différence n'est pas de degré. La division en quatre part de la géométrie du cercle et
ignore où sont les établissements ; la replanification part de là où ils sont, ce qui est
justement le principe qui rend ce balayage économe (D6) et qu'on avait cessé d'appliquer
au-delà du premier niveau.

### 3. Le plafond de densité se calibre sur le 9ᵉ décile

**Au plus 12 établissements SIRENE par cellule** : 12 × 1,57 = 18,8, sous les 20, pour neuf
cellules sur dix. Le plan actuel en porte **8,8 en moyenne** au premier niveau — il est à la
fois trop fin là où c'est vide (230 cellules abouties à 1-4 SIRENE ne ramènent que 2,3 lieux
chacune) et trop grossier là où c'est dense. Un plan recalibré couvre donc le même terrain
avec un nombre de cellules qui peut être **inférieur** aux 900 déjà dépensées ; c'est
précisément ce que la règle 4 fait mesurer. Le taux de troncature attendu est celui de la tranche 10-14, soit 16 %, et
non les 55 % de la tranche 15-19 qu'autorise le calibrage actuel.

La constante de configuration cesse de porter une moyenne. Elle porte le décile, et son
commentaire dit lequel et pourquoi — une constante dont on a oublié ce qu'elle mesure est une
constante qui ment à la prévision de coût, qui est l'outil de décision du projet.

### 4. Le coût de la convergence est un nombre mesuré, pas une estimation — et il décide

`plan:cells` tourne à sec par défaut. Recalibré, sur les cellules feuilles mesurées, **le
nombre de cellules qu'il annonce est le nombre d'appels que la couverture complète coûtera
chaque mois.** Ce nombre est produit avant toute dépense.

La règle d'arbitrage est posée **maintenant**, pour que le chiffre décide et non l'inverse :

| Ce que le plan à sec annonce | Ce qu'on fait |
|---|---|
| **≤ 900 appels** | Rien à arbitrer. Le zéro euro tient, le re-balayage mensuel complet tient, D7 redevient vrai par construction |
| **900 à 1 500** | On réduit le périmètre au rendement mesuré (tableau ci-dessous) jusqu'à repasser sous 900 |
| **> 1 500** | La contrainte « zéro euro » ne tient pas au périmètre actuel. Elle se rouvre explicitement, avec le coût réel — 35 $ par tranche de 1 000 — et sa propre entrée au journal |

### 5. Si le périmètre doit être réduit, il l'est au rendement, pas à la géographie

Ce qu'on cherche, c'est la recherche que la vision désigne comme l'essentiel : sans coupure
et week-end libre. Rendement mesuré, par commune :

| Commune | SIRENE (≈ le coût) | Sans coupure **et** week-end libre | Rendement |
|---|---|---|---|
| Lyon 6e | 576 | 53 | 9,2 % |
| Lyon 9e | 368 | 32 | 8,7 % |
| Lyon 3e | 911 | 71 | 7,8 % |
| Lyon 7e | 782 | 51 | 6,5 % |
| Lyon 4e | 214 | 13 | 6,1 % |
| Villeurbanne | 816 | 40 | 4,9 % |
| Lyon 8e | 323 | 15 | 4,6 % |
| Lyon 2e | 777 | 34 | 4,4 % |
| Lyon 5e | 392 | 10 | 2,6 % |
| **Lyon 1er** | **561** | **10** | **1,8 %** |

L'hypercentre touristique coûte le plus et rend le moins : les 1er et 5e réunis pèsent 953
SIRENE pour **20** résultats utiles, quand Villeurbanne en pèse 816 pour 40. C'est cohérent
avec le métier — un restaurant de Presqu'île ouvre sept jours sur sept avec coupure, et c'est
exactement ce que l'utilisateur cherche à éviter.

> **Ce que cette table ne dit pas.** Un arrondissement retiré est un arrondissement vide pour
> quelqu'un qui y habite, et la vision promet « la liste de son arrondissement ». Réduire au
> rendement se justifie sur le rythme de travail ; ça ne rend pas la coupe indolore. C'est
> pourquoi elle n'intervient qu'en second, après le chiffre de la règle 4, et jamais avant.

### 6. Ce qui a expiré ne s'affiche pas

Passé 30 jours, les horaires d'un établissement ne sont plus affichés : la fiche reste, avec
« Horaires à revérifier », et son verdict retombe à *À vérifier*. C'est la conséquence directe
de D7, et c'est aussi le seul comportement honnête — un horaire de plus d'un mois présenté
comme frais est le mode de défaillance que ce projet nomme comme le pire.

Le nombre de fiches dans cet état est compté, dit dans le bandeau au même titre que
l'avancement du balayage, et le cycle mensuel le rapporte à chaque exécution.

C'est la règle 1 qui fait que ce cas reste rare : on rafraîchit avant de découvrir,
précisément pour ne pas avoir à éteindre des fiches.

---

## Options écartées

- *Continuer à subdiviser en quatre, en payant.* Mesuré : quatre appels pour 12 % de densité.
  Résorber une cellule mère à 30 SIRENE par cette voie demande quatre niveaux, soit 256
  appels — un quart du quota mensuel pour une cellule.
- *Réduire le périmètre d'abord.* Ce serait couper la ville pour financer un gaspillage connu.
  L'ordre inverse — mesurer le plan corrigé, arbitrer ensuite — ne coûte rien et peut rendre
  l'arbitrage sans objet.
- *Agrandir les cellules pour ramasser plus par appel.* Déjà réfuté par D22 : la troncature
  apparaît vers 265 m et le rayon est plafonné à 200 m. C'est la densité Google qui borne,
  pas le rayon.
- *Espacer les balayages au-delà de 30 jours.* Écarté en D7, et la règle 6 explique ce que ça
  coûterait : la sortie des CGU, ou l'extinction de la fiche.
- *Purger les horaires à l'expiration.* C'est ce que fait la règle 6, mais fiche par fiche et
  seulement à l'échéance. Une purge globale au 28 septembre transformerait 3 466 fiches d'un
  coup ; la règle 1 existe pour que ça n'arrive pas.
- *Relever le plafond d'appels.* Le garde-fou n'a qu'une raison d'être, garantir l'absence de
  facturation. Le relever, c'est le supprimer en le gardant.

---

## Comment on saura que c'est réparé

Tout se vérifie à sec, sur une copie locale de la production (`db:pull`).

1. `plan:cells --dry-run` recalibré annonce un nombre de cellules, et **aucune cellule du
   plan ne dépasse 12 SIRENE**.
   > Une cellule aboutie n'est pas une cellule sûre pour toujours : 96 des 688 sont rentrées
   > entre 15 et 20 résultats, dont 17 à 19. Un restaurant qui ouvre les fait tronquer au cycle
   > suivant. Le plafond de densité vaut aussi pour ce qu'on rejoue.
2. Ce nombre est comparé aux seuils de la règle 4, et l'arbitrage qui en découle est appliqué
   sans nouvelle discussion.
3. Une troncature simulée sur une cellule à 30 SIRENE produit des cellules sous le plafond de
   densité, et **moins de quatre** si la densité le permet — jamais quatre par principe.
4. Le cycle mensuel à sec annonce d'abord les cellules expirées, ensuite les cellules en
   attente, dans cet ordre.
5. Le cycle mensuel à sec annonce **un seul plan**, son coût total, et ce qui entre dans le
   quota de la période — pas deux budgets séparés.
6. Une fiche dont les horaires ont dépassé 30 jours n'affiche pas d'horaires, affiche
   *À vérifier*, et est comptée dans le bandeau.
7. Le nombre de fiches expirées est **0 au 26 septembre** et le reste après le cycle
   d'octobre.

Et le critère qui compte le plus, celui qu'on ne verra qu'en vrai : **au 28 septembre, le
produit affiche encore des horaires.** S'il en affiche zéro, ou s'il en affiche de périmés,
rien n'a été réparé — dans un cas il s'est éteint, dans l'autre il ment.
