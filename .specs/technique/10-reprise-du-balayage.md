# Reprise du balayage et fraîcheur des horaires

> **Statut** : acté · **Dernière mise à jour** : 2026-10-17

Le premier balayage réel n'a pas tenu dans un mois ([D22](../DECISIONS.md)). Deux règles
écrites séparément, chacune défendable, se contredisent dès qu'un balayage déborde :
**reprendre au renouvellement du quota mensuel**, et **ne jamais rouvrir le plafond
d'appels**. Cette spec dit ce qui doit se passer quand un balayage dure plus longtemps que le
quota qui le finance.

Elle est à appliquer **avant le 1er septembre 2026**, date à laquelle la tâche planifiée se
déclenche. Rien de ce qui suit ne demande de dépenser un appel Google.

---

## L'état constaté, 29 août 2026

Lu en production, pas estimé.

| | Mesure |
|---|---|
| Balayages ouverts | 1, statut `failed` |
| Appels déjà dépensés par ce balayage | **900** |
| Cellules faites | 688 |
| Cellules tronquées non résolues | 212 |
| Cellules jamais interrogées | **601** |
| Cellules connues au total | 1 501 |
| Horaires en base | 3 466 fiches, expirant les **27 et 28 septembre** |

---

## 1. Le plafond doit compter la même chose que le quota

### Ce qui se passe le 1er septembre si rien ne change

Le cycle mensuel détecte 601 cellules en attente. Il saute la planification, comme D22 le
prévoit, et relance le balayage sur ce même run. Le balayage reprend le compteur du run —
900 — et le compare à son plafond — 900. **Le tout premier appel est refusé.** Le job échoue
en ayant dépensé zéro.

Et le mois suivant reproduit exactement la même chose, indéfiniment : le compteur ne baissera
jamais, puisque seul un appel dépensé le fait monter et qu'aucun ne peut plus l'être.

Le plafond par balayage est délibéré et son motif est juste — dix reprises ne doivent pas
autoriser dix fois le plafond. Mais D22 a décidé de reprendre **au renouvellement du quota
mensuel**, et le compteur, lui, ne connaît pas les mois.

### La règle

**Le plafond porte sur la période du quota — le mois calendaire — et non sur le balayage.**

Trois invariants, qui tiennent ensemble :

1. Une reprise dans une **nouvelle** période doit pouvoir dépenser, quel qu'ait été le coût
   des périodes précédentes.
2. Plusieurs exécutions dans **la même** période se partagent un plafond unique : dix
   reprises ne valent pas dix plafonds.
3. Rien ne se reporte d'une période sur la suivante, ni le dépensé ni le non-dépensé.

Ce qui ne change pas : le total dépensé par un balayage reste enregistré et lisible. C'est
lui qui a permis d'écrire D22. Il cesse simplement de piloter le refus.

### ~~Le plafond journalier est une contrainte distincte, et il est plus bas~~

> **Faux, mesuré le 29 août.** Le plafond journalier posé sur `SearchNearbyRequest` vaut
> **1 000**, pas 800 : c'est ce que tabule [`02-budget-google-et-garde-fous.md`](02-budget-google-et-garde-fous.md)
> depuis le 28 août, et ce que renvoie la lecture directe du quota. La section ci-dessous
> lit le 800 de D15, qui avait déjà été relevé — précisément parce qu'il passait sous notre
> compteur de 900. L'ordre `900 < 1 000` tient, une exécution peut donc dépenser le mois
> entier d'un seul tenant, et **aucun plafond journalier local n'est posé**.
>
> Ce qui reste vrai de la section : la reprise doit pouvoir être rejouée dans le mois sans
> rien replanifier. Elle le permet.
>
> S'ajoute une contrainte que cette spec n'avait pas vue : la période du quota se compte en
> **heure du Pacifique**, celle où Cloud Billing bascule son cycle. Comptée en UTC, elle
> remettrait notre compteur à zéro huit heures avant celui de Google — et la tâche planifiée
> se déclenche dans cette fenêtre.


[D15](../DECISIONS.md) a posé `SearchNearbyRequest` à **800 par jour**. Le plafond du script
est à 900. L'ordre annoncé dans `CLAUDE.md` — « compteur du script (900) < plafond journalier
Google (1000) = quota mensuel gratuit » — **confond le plafond journalier et le quota
mensuel**. Le second vaut 1 000 ; le premier vaut 800, donc moins que notre propre compteur.

Conséquence directe : une exécution ne peut pas dépenser plus de 800 appels. Atteindre 900
dans le mois demande **au moins deux exécutions, sur deux jours UTC différents**. La tâche
planifiée doit pouvoir être rejouée dans le mois sans rien replanifier — ce que la reprise
permet déjà, une fois le plafond indexé sur la période.

> **Le premier balayage l'a masqué par accident.** Lancé à 23h55 UTC, il a dépensé 248 appels
> le 28 août et 652 le 29 : deux jours, aucun proche de 800. La limite n'a jamais été testée.
> Lancée à 03h00 comme la planification le prévoit, la même dépense se serait arrêtée à 800
> sur un `HTTP 429` — précisément le message opaque que le compteur local existe pour éviter.

---

## 2. La péremption doit se voir

Les CGU limitent la conservation du contenu Places à **30 jours** ([D7](../DECISIONS.md)). La
date d'expiration est calculée et **écrite** à chaque balayage. Elle n'est **jamais lue** :
aucune requête du produit ne la mentionne, ni l'application, ni le balayage, ni le cycle
mensuel.

Aujourd'hui, zéro fiche périmée. Au 28 septembre, **3 466** — et l'écran continuera de les
présenter comme fraîches.

S'y ajoute la règle de reprise : les cellules déjà faites ne sont pas rejouées. Même une fois
le plafond réparé, le balayage de septembre ira chercher les 601 cellules manquantes ; il ne
rafraîchira pas les 688 déjà faites, dont les horaires auront dépassé 30 jours.

D7 affirme que « la conformité aux CGU est obtenue par construction, pas par vigilance ».
C'est vrai d'un balayage qui tient dans le mois. Ça ne l'est plus d'un balayage qui déborde,
et le premier a débordé.

### La règle

- La péremption est **mesurée** : combien de fiches, depuis quand, sur quelles zones.
- Elle est **dite à l'écran**, dans le vocabulaire du métier — au même titre que le bandeau
  d'avancement du balayage, qui dit déjà ce que la base ne sait pas encore.
- Le cycle mensuel la **rapporte** à chaque exécution, et **échoue** si un balayage qu'il a
  mené jusqu'à convergence laisse des horaires périmés. Tant que le balayage n'a pas convergé,
  la péremption est une conséquence connue et rapportée ; une fois convergé, c'est un défaut.

> **Complété par D36, le 17 octobre.** La condition « mené jusqu'à convergence » ne se réalise
> pas : le plan compte 2 408 cellules pour 900 appels par période, et l'alarme ne pouvait donc
> jamais sonner. Elle sonne désormais aussi avant la convergence, au-delà d'un seuil : voir
> [§4](#4-ce-quun-cycle-rouge-veut-dire). La règle « une fois convergé, une seule fiche
> périmée est un défaut » est conservée.

C'est la même règle que partout ailleurs dans ce projet : une base incomplète qui se dit
complète est le pire résultat possible. Une base périmée qui se dit fraîche en est la variante
temporelle.

### Ce qu'on ne fait pas encore

**Purger les horaires expirés.** C'est la seule option strictement conforme, et elle
transforme d'un coup 3 466 fiches en « Horaires inconnus » : le produit s'éteint au lieu de
vieillir. On ne prend pas cette décision ici — voir ci-dessous pourquoi elle n'est pas
séparable de l'arbitrage de coût.

---

## 3. Ce que ces deux règles ne résolvent pas

Il reste **601 cellules à interroger**, et environ une sur quatre tronque au rythme mesuré,
créant quatre cellules filles à chaque fois. L'ordre de grandeur pour converger est de
**1 200 appels**, contre **1 000 gratuits par mois**.

Autrement dit : réparer le plafond débloque le balayage, mais **ne le fait pas converger dans
le mois**. Il faudra deux périodes. Et pendant la seconde, les horaires de la première
périment.

C'est ce qui rend les deux questions inséparables. Le choix n'est pas « que faire des données
périmées » d'un côté et « combien dépenser » de l'autre : c'est un seul arbitrage.

| Voie | Ce qu'elle coûte | Ce qu'elle abandonne |
|---|---|---|
| Réduire le périmètre | rien | une part de la ville — Villeurbanne pèse 568 établissements, les 4e, 8e et 9e réunis 684 |
| Accepter le dépassement le temps de converger | quelques euros, une fois | la contrainte « zéro euro », sur une durée bornée et connue |
| Replanifier depuis les cellules feuilles mesurées | rien à instruire | rien, mais ne suffit pas seul : économise les ~212 appels de redécouverte par cycle |
| Laisser vieillir au-delà de 30 jours | rien | la conformité aux CGU, en connaissance de cause |
| Purger à l'expiration | rien | le produit, jusqu'au balayage suivant |

**La seule voie qui n'oblige à choisir ni entre un produit éteint ni une entorse aux CGU est
celle qui fait converger le balayage à l'intérieur d'une période.** C'est l'arbitrage à
ouvrir, et il mérite sa propre entrée au journal des décisions quand il sera tranché.

Ce qui est instruisable **sans dépenser un appel** : le coût d'un plan reconstruit depuis les
cellules feuilles mesurées du balayage en cours. La planification tourne à sec par défaut ; le
nombre de cellules qu'elle annonce est le nombre d'appels que la reprise dépenserait.

Deux constantes à corriger au passage, parce qu'elles faussent précisément cette prévision :
le ratio Google/SIRENE vaut **1,16** en configuration pour **0,78** mesuré, et le commentaire
du rayon maximal cite toujours le calibrage sur 8 cellules que D22 a invalidé.

---

## 4. Ce qu'un cycle rouge veut dire

> Ajouté le 17 octobre 2026 — [D36](../DECISIONS.md). À livrer **avant le 1er novembre
> 2026**, date du prochain cycle planifié. Rien de ce qui suit ne demande de dépenser un appel.

Le plan compte **2 408 cellules** pour **900 appels** par période. Chaque cycle s'arrête donc
sur le plafond en laissant des cellules dues, et jusqu'ici chaque cycle sortait rouge pour
cette seule raison. Un rouge doit appeler une action : ce qui est prévu chaque mois se
rapporte, et ne fait pas échouer.

### Le classement

| Ce que le cycle constate | Jusqu'ici | Désormais | L'action qu'il appelle |
|---|---|---|---|
| Arrêt sur le plafond de la période | échec | rapporté | aucune : la période suivante reprend, sans rien replanifier |
| Cellules encore dues | échec | rapporté | aucune ; leur nombre nourrit l'arbitrage de D30 règle 4 |
| Troncature dont les cellules de reprise attendent leur tour | échec | rapporté | aucune : c'est de la découverte due, dans la même file |
| Troncature sans cellule de reprise | échec | **échec** | comprendre comment la reprise s'est perdue |
| Interruption : erreur HTTP, `429`, signal d'arrêt, base injoignable | échec | **échec** | traiter la cause et relancer ; ce que la période a payé n'est pas rejoué |
| Cellule en échec | échec | **échec** | va avec l'interruption ; remise en attente à la reprise |
| Cellule irréductible | échec | **échec** | décider : rayon minimal, profondeur, ou trou assumé |
| Refus de démarrer : journal incohérent, verrou tenu, plafond déjà atteint, balayage trop récent | échec | **échec** | lire le motif, chacun dit ce qu'il attend |
| Plus de 10 % de fiches périmées après le balayage, en réel | jamais | **échec** | vérifier l'ordre de rachat et la part du plan que le plafond atteint |
| Une fiche périmée après un balayage convergé, en réel | échec | **échec** | inchangé : c'est un trou de couverture |
| Péremption, à sec | avertissement | avertissement | inchangé |

**Une troncature non résolue n'est un défaut que si rien de ce qui est dû ne la résoudra.**
Tant qu'une de ses cellules de reprise attend son tour, la période suivante la résout. Comme
la marque de troncature et ses cellules de reprise s'écrivent dans la même transaction, le
défaut se ramène à une cellule tronquée **sans aucune** cellule de reprise. Il n'en existe
aucune au 17 octobre ; c'est pour cela qu'en voir une mérite un rouge.

### Les statuts du balayage

`sweep_run.status` prend une quatrième valeur. La colonne est du texte libre : aucune
migration.

| Statut | Quand | Code de sortie | `error` |
|---|---|---|---|
| `succeeded` | aucun défaut, rien de dû : le plan a convergé dans la période | 0 | vide |
| `capped` | aucun défaut, des cellules restent dues | 0 | vide — le résumé dit ce qui reste |
| `failed` | au moins un défaut | 1 | les défauts, tous, et eux seuls |

Le cas courant de `capped` est le plafond. Le seul autre est un run qui change de période en
cours de route ; la période suivante rachète ce qu'il laisse, il n'y a là rien à réparer.

`succeeded` reste le seul statut que lit le garde-fou de récence, et c'est la raison d'être
d'un statut distinct. Rangé en `succeeded`, un run plafonné repris à la main le 8 du mois
ferait refuser le cycle du 1er suivant — 23 jours, sous les 25 requis — et avec lui le
rafraîchissement du mois.

> Le commentaire de la colonne, dans le schéma, énumère ses valeurs. Le modifier touche
> `lib/db/schema.ts` et déclenche le garde-fou de D32 : à pousser par un déclenchement manuel,
> en sachant qu'aucune colonne ne change.

### Le seuil de péremption

- Mesuré **après** le balayage et les étapes hors ligne, sur la définition qu'applique
  l'écran : la part des fiches avec horaires qui n'affichent plus leurs horaires.
- **10 %**, en configuration à côté de la durée de rétention. Au seuil pile, le cycle passe ;
  au-dessus, il échoue. Sans aucune fiche avec horaires, il n'y a rien à mesurer et rien
  n'échoue sur ce motif.
- Mesuré à **2,2 %** juste après le cycle d'octobre et **3,3 %** deux semaines plus tard.
  L'ancien ordre de rachat en aurait laissé un tiers ; un balayage interrompu tôt, presque
  tout.
- Une fois le plan convergé, la règle de §2 s'ajoute et ne se remplace pas : une seule fiche
  périmée fait échouer.

### Ce que le cycle dit, et où

- Il rapporte l'échec de la **première** étape en échec, comme D33 le veut — une étape qui
  échoue à cause d'une autre ne doit pas enterrer la cause —, **et** l'alarme de péremption.
  Celle-ci n'est pas une étape en aval du balayage ; c'est sa conséquence pour le produit, et
  un balayage en échec ne doit plus la masquer.
- Sous GitHub Actions, tout cycle réel, vert ou rouge, laisse une annotation de niveau
  *notice* : cellules dues pour la période, part des fiches périmées, taille du plan face au
  plafond. *Notice* et non *warning* : un avertissement chaque mois serait le rouge mensuel
  un cran plus bas.
- Hors de GitHub Actions, rien n'est annoté. Le balayage lancé à la main imprime son résumé,
  qui dit déjà tout.

### Ce qui ne change pas

- Le plafond, le compteur, la période du Pacifique, le journal des dépenses : rien de ce qui
  protège le quota n'est touché. Un run `capped` a dépensé exactement ce que la période
  autorisait.
- Les étapes hors ligne tournent après un échec (D33). Le canari de l'appariement reste retenu
  tant que des cellules sont dues : il se décide sur le plan, pas sur un code de sortie.
- Les bandeaux de l'écran ne lisent pas le statut du balayage : ils comptent les cellules et
  les fiches. Rien n'y change.
- Le workflow garde son absence de `continue-on-error` : un défaut fait toujours échouer le
  job. Son commentaire, qui range une troncature non résolue et le dépassement de quota parmi
  les échecs, est à réaligner sur la table ci-dessus.

### Comment on saura que c'est en place

Le classement et le seuil sont des règles pures : ils se testent sans base et sans appel.

1. Plafond atteint et rien d'autre : `capped`, code 0, `error` vide, cellules dues au résumé.
2. Plafond atteint et une cellule irréductible : `failed`, et le motif nomme l'irréductible,
   pas le plafond.
3. Interruption HTTP avant le plafond : `failed`.
4. Troncature dont les cellules de reprise sont en attente : rapportée, sans être un motif.
   Troncature sans cellule de reprise : `failed`.
5. Plan convergé, aucun défaut : `succeeded`.
6. Un run `capped` terminé 23 jours plus tôt ne fait pas refuser le cycle ; un run
   `succeeded` le fait toujours.
7. Péremption : 10 % pile passe, au-dessus échoue ; plan convergé, une fiche suffit ; à sec,
   jamais d'échec.
8. Un cycle dont le balayage échoue **et** dont la péremption dépasse le seuil rapporte les
   deux motifs.
9. Hors de GitHub Actions, aucune annotation n'est imprimée.

Et le critère qui compte, celui qu'on ne verra qu'en vrai : **le 1er novembre, le job est
vert**, et son annotation annonce de l'ordre de 1 500 cellules dues et quelques pour cent de
fiches périmées. S'il est rouge, son motif doit être une ligne de la table ci-dessus — sinon
c'est la table qui est fausse.

---

## Comment on saura que c'est réparé

Tout se vérifie à sec, sur une copie locale de la production (`db:pull`), sans un seul appel
Google.

1. Le cycle mensuel en mode sec annonce ce que **la période en cours** permet encore, et non
   ce que le balayage a déjà dépensé depuis son ouverture.
2. Une reprise simulée dans une nouvelle période part d'une dépense nulle et annonce
   **601 cellules** à interroger.
3. Deux exécutions simulées dans la même période se partagent un plafond unique : la seconde
   annonce ce que la première a laissé, pas le plafond entier.
4. Aucun report d'une période sur la suivante, ni du dépensé ni du reste.
5. Le total cumulé du balayage reste lisible dans son journal de course.
6. Le nombre de fiches périmées est exposé : **0 aujourd'hui**, 3 466 au 28 septembre.
7. Le cycle échoue si un balayage mené jusqu'à convergence laisse une seule fiche périmée.
   > Toujours vrai, mais jamais atteint : le plan ne converge pas. Le critère qui porte
   > réellement l'alarme est le seuil de [§4](#4-ce-quun-cycle-rouge-veut-dire) (D36).

Et le critère qui compte le plus, celui qu'on ne verra qu'en vrai : **le 1er septembre, le job
dépense des appels.** S'il échoue en ayant dépensé zéro, rien n'a été réparé.
