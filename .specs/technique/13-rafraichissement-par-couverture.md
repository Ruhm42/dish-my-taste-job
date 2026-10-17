# Rafraîchissement par couverture, calendrier du cycle et ce qui le fait échouer

> **Statut** : acté · **Dernière mise à jour** : 2026-10-17

[`11-convergence-du-balayage.md`](11-convergence-du-balayage.md) a posé que la fraîcheur prime
sur la complétude, et l'a mis en œuvre en servant d'abord « les cellules dont le contenu expire,
de la plus ancienne à la plus récente ». Le principe tient. Sa mise en œuvre, non : elle lit
l'âge du contenu dans l'ancienneté de chaque cellule, alors que les cellules se recouvrent.

Cette spec dit comment choisir ce qu'on rafraîchit
([D36](../DECISIONS.md#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt)),
ce que coûte un mois ([D37](../DECISIONS.md#d37--la-prévision-compte-larbre-entier-et-le-périmètre-devient-un-budget-de-découverte)),
quand le cycle passe ([D38](../DECISIONS.md#d38--deux-passages-par-mois-le-1er-et-le-16)), et ce
qui doit le rendre rouge ([D39](../DECISIONS.md#d39--ce-qui-fait-échouer-le-cycle)).

Elle est écrite sous la lecture des conditions Google que D7 a retenue — 30 jours de
conservation. Cette lecture est mise en question par l'axe 0 de
[`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md) ; si elle tombe, cette spec tombe avec elle.

Rien de ce qui suit ne demande de dépenser un appel pour être décidé ou vérifié.

---

## L'état constaté, 17 octobre 2026

Lu en production.

| | Mesure |
|---|---|
| Établissements | 4 653 ; 3 730 avec des horaires, dont 3 608 valides |
| Échéance des horaires valides | **toutes entre 15h54 et 16h24 UTC le 31 octobre** |
| Passage du 1er octobre | 653 cellules de profondeur 0 et 247 de profondeur 1, ~97 % de la base rafraîchie |
| File du 1er novembre sous la règle par `queried_at` | les 899 cellules filles interrogées en septembre |
| Fiches expirées jusqu'en décembre sous cette règle | ~1 280, soit 35 % |
| Points SIRENE géocodés du périmètre | 5 682, tous dans un disque déjà interrogé |
| Cellules vides | 97 |
| Re-troncature des cellules de reprise | 26,3 % à la profondeur 0, 24,1 % à 1, 22,2 % à 2 — ~4 filles chacune |
| Arbre convergé, tel que construit | ~3 100 appels par mois |
| Ce qu'annonce `plan:cells` | 1 170 — un plancher à un niveau de reprise |
| Rendement de la découverte | ~0,13 lieu nouveau par appel |
| Retard de GitHub sur la planification du 1er | jusqu'à 7 h |

> **Annoté le 17 octobre 2026, au soir.** Le retard de GitHub est allé jusqu'à **7 h 52**,
> mesuré sur le réveil le 12 octobre ; la valeur retenue passe à 8 h
> ([D50](../DECISIONS.md#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour)). Et le code
> construit (commit `05058b4`) calcule, en passe à sec au 1er novembre, une couverture de **622**
> cellules en robuste et **560** en fiches connues. Ce sont les chiffres du jour ; les tables
> ci-dessous gardent ceux de la décision.

Le correctif minimal du 17 octobre trie les cellules dues par profondeur, la profondeur 0
d'abord. À sec au 1er novembre, ses 900 appels vont aux 653 cellules de profondeur 0 et à 247 de
profondeur 1, la forme du passage d'octobre. C'est le pont jusqu'à cette spec, pas son
remplacement.

---

## 1. Ce que le `queried_at` d'une cellule ne dit pas

Une cellule de profondeur 0 et ses quatre filles couvrent en grande partie le même terrain. Le
1er octobre, la mère a été interrogée et a retrouvé la plupart des restaurants de ses filles :
leurs horaires ont été recollectés, leur échéance repoussée au 31 octobre. Les filles, elles,
n'ont pas été interrogées : leur `queried_at` est resté en septembre.

Au 1er novembre, l'ordre par `queried_at` les sert donc en premier — elles sont les plus
anciennes —, alors que leur contenu a été rafraîchi par la mère un mois plus tôt et expire en
même temps que tout le reste. Il dépense ses 900 appels à racheter un contenu déjà rafraîchi, et
laisse expirer les 35 % que seules les mères retrouvent. Le mois suivant, l'inverse.

**L'âge du contenu se lit sur le contenu** — l'échéance de chaque fiche —, pas sur les cellules.

## 2. La couverture

### Ce qu'une cellule couvre : sa portée

L'appel classe ses résultats par distance. Ce qu'une cellule a renvoyé est donc exact jusqu'à
une certaine distance, sa **portée** :

- une cellule complète — moins de 20 résultats — a renvoyé tout son disque ;
- une cellule tronquée a renvoyé tout ce qui est plus proche que son 20e résultat, dont elle
  enregistre la distance.

Toute cellule interrogée est donc candidate, avec sa portée. Une fiche est dans une portée si
sa distance au centre ne dépasse pas le rayon de la portée, **à un millimètre près** : la base
sert les flottants tronqués à 15 chiffres significatifs, et les points qui définissent le rayon
d'une cellule sont posés exactement sur son bord — un test strict en perd ~116.

Aucune autre marge au choix des cellules. La marge de 10 m de
[D45](../DECISIONS.md#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus)
sert à constater une absence ; appliquée au choix, elle laissait 179 à 196 fiches hors de toute
couverture.

| Ce qu'une cellule couvre | Fiches à horaires | Robuste | Fiches hors de toute portée |
|---|---|---|---|
| Premier relevé, méthode non consignée | 567 | 703 | — |
| Cellules complètes seules, fiche à 10 m du bord au moins | 648 à 663 | 745 à 800 | 179 à 196 |
| Cellules complètes seules, sans marge | 583 à 599 | 678 à 747 | 31 |
| **Toute cellule interrogée, avec sa portée** | **528** | **~708** | **2** |

Les fourchettes viennent de deux recalculs indépendants du même jour, sur des ensembles de
fiches légèrement différents ; aucun ne reproduit le premier relevé.

### Ce qu'on couvre

Les fiches à horaires, et — couverture **robuste** — chaque point SIRENE géocodé du périmètre,
parce que c'est là que les restaurants ouvrent avant d'avoir une fiche Google. Bâtie sur les
données d'avant le 1er octobre, la couverture des seules fiches connues a rattrapé 63 ou 64 des
68 lieux apparus ce jour-là ; la robuste, 67 ou 68.

### Comment on choisit

Gloutonnement, la cellule qui ajoute le plus de fiches à couvrir à chaque pas, dans l'ordre de
priorité du § 4. L'ordre est **total** — 97 % des choix sont des ex-aequo : à gain égal passe la
cellule dont une fiche ajoutée expire le plus tôt, puis la moins profonde, puis la plus
anciennement interrogée, puis l'identifiant. Sans ordre total, le mode sec et le mode réel
n'achètent pas les mêmes cellules.

La couverture se **recalcule à chaque passage**, sur les derniers résultats. Une cellule dont la
portée rétrécit — elle tronque, ou son 20e résultat se rapproche — couvre moins, et d'autres
prennent le relais. Les fiches qu'aucune portée ne contient sont nommées à chaque passage.

### Les cellules vides

Zéro résultat à son dernier appel, et aucune fiche jamais vue dans son cercle : 97 aujourd'hui.
Elles sortent de la couverture, et leurs points SIRENE ne comptent plus dans la contrainte
robuste. Elles restent au plan et se rejouent une fois par semestre, sur une part réservée du
passage du 16 — une quinzaine d'appels par mois.

## 3. Ce que coûte un mois

Sous la couverture, l'arbre du plan n'est plus la facture mensuelle : c'est un arriéré de
découverte.

| | Appels par mois | Ce que c'est |
|---|---|---|
| Couverture robuste | ~710 | Une couverture complète du contenu |
| Plancher à un niveau | 1 170 | Ce que `plan:cells` affichait seul |
| Arbre convergé | ~3 100 | Avec une descendance presque critique — ~1,05, 0,96 et 0,89 cellule tronquée engendrée par cellule tronquée aux profondeurs 0, 1, 2 |

`plan:cells` annonce les trois, chacun nommé. **Le chiffre qui décide est la couverture**,
augmentée de ce que coûte le second passage ; la table de la règle 4 de D30 s'y applique telle
quelle. Il est sous 900 : la question du périmètre est close tant qu'il y reste.

Mais sous deux passages, la couverture ne laisse rien : tout le contenu est dû à chaque passage,
et les deux passages dépensent la période entière à le racheter (§ 4). **La découverte ne reçoit
rien en régime permanent.** Le jour où elle a un budget, elle se dépense au rendement mesuré —
lieux nouveaux par appel, par commune —, les cellules les moins profondes d'abord à rendement
égal ; ce qui reste caché est compté par commune et dit dans le bandeau. Les 1er et 2e
arrondissements, qui portent 40 % des cellules de reprise, resteront les plus sous-comptés.

## 4. Le calendrier

### Pourquoi un passage par mois ne suffit pas

Une fiche rafraîchie une fois par mois calendaire attend, d'un rafraîchissement au suivant, la
longueur d'un mois. Sept fois par an, c'est 31 jours, pour une conservation de 30. Douze
rafraîchissements espacés d'au plus 30 jours couvrent 360 jours : **une fiche rafraîchie une
seule fois par mois passe au moins cinq jours par an expirée**, quel que soit le jour choisi.

Aujourd'hui, toute la base est rafraîchie dans la même demi-heure, donc expire dans la même
demi-heure : la liste par défaut est vide 17 à 30 heures chaque mois de 31 jours, environ
138 heures par an.

### Deux passages

| Passage | Heure | Plafond |
|---|---|---|
| Le 1er | 09:00 UTC | **450 appels** — celui qui maximise la pire heure en simulation |
| Le 16 | 09:00 UTC | le reste de la période, jusqu'à 900 |

09:00 UTC pour la même raison qu'aujourd'hui : la période du quota est le mois du Pacifique, et
il faut l'avoir franchi le jour même.

Simulé sur douze mois à partir du 1er novembre, retards de GitHub tirés au hasard, sur une
couverture « cellules complètes, 10 m » :

| Plafond du 1er | 600 | 500 | **450** | 400 |
|---|---|---|---|---|
| Pire heure | 74,3 % | 82,7 % | **85,9 %** | 82,2 % |

La première simulation du propriétaire (600 + 300, 86,6 %) n'est pas reproduite sur une
couverture. Le plafond se recalcule sur la règle de couverture du § 2, plus petite que celle de
la simulation, et la simulation qui le fixe est consignée.

> **Consignée le 17 octobre 2026, sur la couverture du § 2 telle que construite.**
> `simulate:passes --from=2026-11-01T09:00:00Z`, graines 1 à 10, sur une copie du jour :
> - pire heure **91,5 %** à 450, quelle que soit la graine ;
> - `lowest forecast` 91,5 % ;
> - au plus 900 appels par période et 450 avant le 16.
>
> Relevé à 600, ou à 622 tous les mois : 85,5 % et 83,2 % (graine 1). Le plafond de 450 est
> confirmé. Voir [`14-cycle-d-import-mensuel.md`](14-cycle-d-import-mensuel.md) § 2.

### L'ordre de chaque passage

Sous deux passages, **tout le contenu est dû à chaque passage** : ce que le 1er a rafraîchi
expire avant le 1er suivant augmenté de douze heures, donc le passage du 16 le compte. Servir
« le plus de fiches dues par appel » reprendrait sans cesse les mêmes cellules denses et
affamerait ce qui vient d'expirer. D'où l'ordre :

0. au passage du 16, la part réservée aux cellules vides dues pour leur rejeu semestriel ;
1. le contenu expiré, ou qui expire avant maintenant augmenté de douze heures ;
2. le contenu qui expire avant le passage suivant augmenté de douze heures ;
3. le reste du contenu, par ordre d'échéance ;
4. la découverte.

Le plafond du 1er est ce qui étale les échéances : ce qu'il ne sert pas, le passage du 16 le
sert, et ce contenu expirera le mois suivant au milieu du mois plutôt qu'à la fin.

Le refus de rejouer un balayage réussi depuis moins de 25 jours disparaît, au plus tard avec le
premier passage piloté par la couverture : il bloquerait le passage du 16 dès qu'un passage du
1er sort `succeeded`. Le plafond de la période (D28) borne ce qu'un mois peut dépenser,
relances manuelles comprises.

## 5. Ce qui fait échouer le cycle

### Trois statuts

| Statut | Quand | Sortie | `error` |
|---|---|---|---|
| `capped` | arrêt sur un plafond prévu — la période, ou les 450 du 1er —, sans défaut | succès | vide ; le résumé dit ce qui reste |
| `succeeded` | aucun défaut, plus rien de dû | succès | vide |
| `failed` | au moins un défaut | échec | les défauts, tous et eux seuls |

`sweep_run.status` est du texte libre : aucune migration. Le commentaire du schéma qui énumère
les valeurs déclenche le garde-fou de D32 quand on le modifie ; il se pousse par un
déclenchement manuel.

### Ce qui est un défaut

| Défaut | Pourquoi |
|---|---|
| Interruption autre qu'un plafond prévu : erreur HTTP, `429`, signal d'arrêt, base injoignable | Du contenu dû n'a pas été racheté ; un `429` dit en plus que notre compteur n'a pas parlé avant Google |
| Cellule en échec | Payée, sans résultat |
| Cellule irréductible | Un trou que rien ne couvre ; en accepter une est une décision à part entière |
| Troncature sans aucune cellule de reprise | La reprise s'est perdue |
| Refus de démarrer : verrou tenu, journal des dépenses qui ne prouve pas ce qui a été dépensé, plafond déjà atteint | Le motif dit ce qu'il attend |
| Fraîcheur prévue sous **80 %** à la pire heure d'ici au passage suivant, retard de GitHub de 7 h compris | La base va s'éteindre au-delà du creux structurel (~86 %) |

La prévision se calcule sur la **portée attendue** des cellules choisies, sans marge : avec la
marge de 10 m, elle lisait environ sept points sous la pire heure réelle. Elle se construit
**avec** les deux passages, jamais avant : avec un seul passage par mois, chaque mois s'éteint au
moins le temps du retard de GitHub, et elle serait rouge chaque mois.

### Ce qui est rapporté, et où

L'arriéré de découverte, les troncatures dont la reprise attend son tour, la couverture du jour
et son coût face au plafond, la fraîcheur prévue et l'heure de sa pire échéance. Sous GitHub
Actions, chaque cycle réel, vert ou rouge, les laisse dans une annotation de niveau *notice* —
un *warning* chaque mois serait le rouge mensuel un cran plus bas.

Le cycle rapporte la première étape en échec (D33) **et** l'échec de fraîcheur : celui-ci n'est
pas une étape en aval du balayage, c'est sa conséquence pour le produit, et un `429` ne doit pas
le masquer.

L'alarme « balayage convergé et horaires périmés » disparaît : elle porte sur un état que le
plan n'atteint jamais, et la prévision la remplace.

Le canari de `match:sirene` s'enregistre quand le passage a servi toute sa couverture robuste —
chaque point SIRENE est alors dans la portée d'une cellule interrogée. Sous la couverture des
seules fiches connues, il reste retenu, en le disant.

---

## Options écartées

Le détail et les raisons sont dans D36 à D39. En bref :

- *Ordre par `queried_at`* — produit l'alternance mesurée, 35 % expirés un mois sur deux.
- *Tri par profondeur en régime permanent* — juste par construction du plan, aveugle à ce que les
  troncatures cachaient, et paie les 97 cellules vides.
- *Cellules complètes seules, ou la marge de 10 m au choix* — 179 à 196 fiches hors de toute
  couverture, qui expireraient en silence.
- *Une cellule tronquée couvre tout son disque* — faux : elle n'a renvoyé que ses vingt plus
  proches.
- *Couverture des seules fiches connues* — ~150 appels de moins, des ouvertures manquées. Elle
  reste le repli si la robuste ne tient pas dans le budget.
- *Décider sur le plan à sec, ou sur l'arbre convergé* — l'un est un plancher, l'autre n'est pas
  une facture mensuelle.
- *Un passage le 28 ou le 30, ou tous les 30 jours* — l'un ne change pas l'intervalle, l'autre
  met deux couvertures dans un mois.
- *600 appels le 1er* — 74,3 % à la pire heure sur une couverture.
- *Rouge sur les cellules dues, ou sur la moindre fiche expirée* — rouge chaque mois, donc muet.

---

## Comment on saura que c'est réparé

Tout se vérifie à sec, sur une copie locale de la production (`db:pull`), sans un appel Google.

1. Le cycle à sec annonce la couverture du jour selon la règle du § 2 : de l'ordre de **530**
   cellules pour les fiches à horaires valides, **~710** en robuste — ou explique l'écart.
   *Annoté le 17 octobre 2026 : le code annonce 560 et 622. L'écart avec les relevés de la
   décision est consigné, pas expliqué ; il ne change pas la conclusion, la couverture tient
   sous 900.*
2. Chaque cellule choisie a une portée, et une cellule tronquée n'y compte que jusqu'à son
   20e résultat.
3. Chaque fiche à horaires est dans la portée d'une cellule de la couverture, à un millimètre
   près, sauf celles que le rapport nomme comme hors de toute portée (2 aujourd'hui) ; en
   robuste, chaque point SIRENE géocodé aussi, sauf ceux des cellules vides.
4. Deux exécutions à sec sur la même base choisissent exactement les mêmes cellules.
5. Rejouée sur les données d'avant le 1er octobre, la couverture robuste contient au moins 67
   des 68 lieux apparus ce jour-là, et le rapport dit où est le 68e.
6. `plan:cells` à sec annonce trois nombres nommés — couverture, plancher, arbre convergé — et
   aucun ne se présente comme le coût mensuel s'il ne l'est pas.
7. Une simulation sur douze mois, retards de GitHub de 0 à 7 h tirés au hasard, garde la pire
   heure **au-dessus de 85 %**, ne dépasse jamais 900 appels dans un mois du Pacifique, ni le
   plafond du 1er — et dit quel plafond elle a retenu.
8. Le passage du 1er qui atteint son plafond sans autre défaut sort `capped`, en succès, même
   avec un arriéré de découverte. Un `HTTP 429` simulé, un passage interrompu, un verrou tenu,
   une cellule irréductible le font sortir `failed`, chacun avec sa raison. Une prévision sous
   80 % aussi — et elle est rapportée même quand une autre étape a déjà échoué.
9. Le passage du 16 n'est pas refusé par le passage du 1er, qu'il soit `capped` ou `succeeded`.
   *Annoté le 17 octobre 2026 : vrai pour sa première exécution. Mais toute relance après lui
   dans la période — reprise d'une interruption comprise — est refusée par le contrôle de
   cohérence des dépenses, que les rachats du 16 font mentir. Voir
   [`14-cycle-d-import-mensuel.md`](14-cycle-d-import-mensuel.md) § 4.*
10. Sous GitHub Actions, un cycle réel laisse une annotation *notice* ; hors d'Actions, aucune.

Et le critère qu'on ne verra qu'en vrai : **le 31 décembre 2026 à 20:00 UTC, plus de 80 % des
fiches à horaires sont affichées.** Décembre a 31 jours, et c'est le premier mois où le passage
du 16 peut faire la différence — il doit exister le 16 décembre. S'il n'affiche rien ce soir-là,
rien n'a été réparé.
