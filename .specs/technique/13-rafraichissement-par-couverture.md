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
| Établissements | 4 653, dont 3 608 avec des horaires valides |
| Échéance de ces horaires | **toutes entre 15h54 et 16h24 UTC le 31 octobre** |
| Passage du 1er octobre | 653 cellules de profondeur 0 et 247 de profondeur 1, ~97 % de la base rafraîchie |
| File du 1er novembre sous la règle par `queried_at` | les 899 cellules filles interrogées en septembre |
| Fiches expirées jusqu'en décembre sous cette règle | ~1 280, soit 35 % |
| Cellules qui renvoient toujours zéro résultat | 97 |
| Re-troncature des cellules de reprise | 26,3 % à la profondeur 0, 24,1 % à 1, 22,2 % à 2 — ~4 filles chacune |
| Arbre convergé, tel que construit | ~3 100 appels par mois |
| Ce qu'annonce `plan:cells` | 1 170 — un plancher à un niveau de reprise |
| Rendement de la découverte | ~0,13 lieu nouveau par appel |
| Retard de GitHub sur la planification du 1er | jusqu'à 7 h |

Un correctif minimal part avant le 1er novembre : les cellules dues sont triées par profondeur,
la profondeur 0 d'abord. À sec au 1er novembre, ses 900 appels vont aux 653 cellules de
profondeur 0 et à 247 de profondeur 1, la forme du passage d'octobre. C'est le pont jusqu'à
cette spec, pas son remplacement.

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

### Ce qu'on couvre

Les fiches à rafraîchir sont celles qui portent des horaires. La couverture est **robuste** :
elle contient aussi chaque point SIRENE géocodé du périmètre, parce que c'est là que les
restaurants ouvrent avant d'avoir une fiche Google. Mesuré : bâtie sur les données d'avant le
1er octobre, la couverture des seules fiches connues a rattrapé 63 des 68 lieux apparus ce jour-là ;
la robuste, les 68.

| Ce que la couverture doit contenir | Cellules |
|---|---|
| Chaque fiche avec horaires | 567 |
| Chaque établissement | 587 |
| Chaque établissement et chaque point SIRENE géocodé | **703** |

### Avec quoi

Les candidates sont les cellules **complètes** du plan, celles qui ont renvoyé moins de 20
résultats à leur dernier appel. Une cellule complète renvoie tout ce qu'elle contient ; une
cellule tronquée en a caché une partie, et ne garantit rien.

Une fiche est contenue dans une cellule si elle est à l'intérieur du cercle d'**au moins 10 m**
(D45) — la marge absorbe l'écart entre notre calcul de distance et celui de Google.

### Comment

Gloutonnement, par échéance : on sert d'abord les fiches dont l'échéance tombe avant le passage
suivant augmenté de douze heures, en choisissant à chaque pas la cellule qui en contient le plus
qui ne soient pas encore couvertes ; puis le reste, par ordre d'échéance. On s'arrête au plafond
du passage (§ 4).

La couverture se **recalcule à chaque passage**, sur les derniers résultats. Une cellule de la
couverture qui tronque en sort ; ses filles complètes la remplacent, et le coût de la couverture
monte d'autant. Ce mouvement est rapporté.

### Les cellules vides

Une cellule qui a renvoyé zéro résultat à ses deux derniers appels sort de la couverture, et ses
points SIRENE ne comptent plus dans la contrainte robuste. Elle reste au plan et se rejoue une
fois par semestre, avant la découverte. Pour les 97 d'aujourd'hui, une quinzaine d'appels par
mois.

## 3. Ce que coûte un mois

Sous la couverture, l'arbre du plan n'est plus la facture mensuelle : c'est un arriéré de
découverte.

| | Appels par mois | Ce que c'est |
|---|---|---|
| Couverture robuste | ~700 | Le rafraîchissement : ce qu'un mois coûte |
| Plancher à un niveau | 1 170 | Ce que `plan:cells` affichait seul |
| Arbre convergé | ~3 100 | Avec une descendance presque critique — ~1,05, 0,96 et 0,89 cellule tronquée engendrée par cellule tronquée aux profondeurs 0, 1, 2 |

`plan:cells` annonce les trois, chacun nommé. **Le chiffre qui décide est la couverture**,
augmentée de ce que coûte le second passage ; la table de la règle 4 de D30 s'y applique telle
quelle. Il est sous 900 : la question du périmètre est close tant qu'il y reste.

Ce qui reste du quota va à la découverte, dépensée au rendement mesuré — lieux nouveaux par
appel, par commune, réévalué chaque mois —, les cellules les moins profondes d'abord à rendement
égal. Ce qui reste caché est compté par commune et dit dans le bandeau. À 0,13 lieu par appel,
c'est quelques dizaines de lieux par mois au mieux ; 40 % des cellules de reprise sont dans les
1er et 2e arrondissements, qui resteront les plus sous-comptés.

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
| Le 1er | 09:00 UTC | 600 appels |
| Le 16 | 09:00 UTC | le reste de la période, jusqu'à 900 |

09:00 UTC pour la même raison qu'aujourd'hui : la période du quota est le mois du Pacifique, et
il faut l'avoir franchi le jour même.

Chaque passage sert, dans l'ordre :

1. le contenu dont l'échéance tombe avant le passage suivant augmenté de douze heures ;
2. le reste du contenu, par ordre d'échéance ;
3. les cellules vides dues pour leur rejeu semestriel ;
4. la découverte.

Le plafond du premier passage est ce qui étale les échéances : ce qu'il ne sert pas, le passage
du 16 le sert, et ce contenu expirera le mois suivant au milieu du mois plutôt qu'à la fin. La
simulation du propriétaire (600 + 300, données du 17 octobre) garde la pire heure à 86,6 % de
fiches fraîches au lieu de 0 %, et la moyenne à 99,7 % au lieu de 98,3 %. Les deux plafonds se
recalibrent sur la couverture quand elle existe ; le critère, lui, ne bouge pas (§ 6).

Le refus de rejouer un balayage réussi depuis moins de 25 jours disparaît : il bloquerait le
passage du 16. Le plafond de la période (D28) borne ce qu'un mois peut dépenser, relances
manuelles comprises.

## 5. Ce qui fait échouer le cycle

Le cycle échoue quand, et seulement quand :

| Condition | Pourquoi c'est un défaut |
|---|---|
| Google refuse sur quota (`HTTP 429`) | Notre compteur devait parler avant |
| Le passage s'arrête avant d'avoir servi le contenu échu, avec du budget restant | Du contenu va expirer qui aurait dû être racheté |
| Le verrou est tenu par une session disparue, ou ne peut pas être rendu | Tous les passages suivants seront refusés |
| Le registre ne prouve pas ce qui a été dépensé dans la période | Le plafond ne garantit plus rien |
| La fraîcheur prévue passe sous **80 %** à la pire heure avant le passage suivant, retard de GitHub compris | La base va s'éteindre au-delà du creux structurel (~87 %) |
| Le nombre de cellules irréductibles monte | Un trou nouveau, que rien ne peut couvrir |

Sont rapportés, jamais rouges : l'arriéré de découverte, les troncatures non résolues, les
irréductibles déjà connues, la couverture du jour et son coût, la fraîcheur prévue.

L'alarme « balayage convergé et horaires périmés » disparaît : elle porte sur un état que le
plan n'atteint jamais.

Le canari de `match:sirene` s'enregistre quand le passage a servi toute sa couverture robuste —
chaque point SIRENE est alors dans une cellule complète interrogée. Sous la couverture des seules
fiches connues, il reste retiré, en le disant.

---

## Options écartées

Le détail et les raisons sont dans D36 à D39. En bref :

- *Ordre par `queried_at`* — produit l'alternance mesurée, 35 % expirés un mois sur deux.
- *Tri par profondeur en régime permanent* — juste par construction du plan, aveugle à ce que les
  troncatures cachaient, et paie les 97 cellules vides.
- *Couverture des seules fiches connues* — 116 appels de moins, 5 ouvertures sur 68 manquées.
  Elle reste le repli si la robuste ne tient pas dans le budget.
- *Décider sur le plan à sec, ou sur l'arbre convergé* — l'un est un plancher, l'autre n'est pas
  une facture mensuelle.
- *Un passage le 28 ou le 30, ou tous les 30 jours* — l'un ne change pas l'intervalle, l'autre
  met deux couvertures dans un mois.
- *Rouge sur les cellules dues, ou sur la moindre fiche expirée* — rouge chaque mois, donc muet.

---

## Comment on saura que c'est réparé

Tout se vérifie à sec, sur une copie locale de la production (`db:pull`), sans un appel Google.

1. Le cycle à sec annonce la couverture du jour : environ **567** cellules pour les fiches à
   horaires, **587** pour tous les établissements, **703** en robuste — ou explique l'écart avec
   ces chiffres.
2. Aucune cellule tronquée n'est dans la couverture.
3. Chaque fiche à horaires est à au moins 10 m à l'intérieur d'une cellule de la couverture ; en
   robuste, chaque point SIRENE géocodé aussi, sauf ceux des cellules vides sorties de la
   couverture.
4. Rejouée sur les données d'avant le 1er octobre, la couverture robuste contient les 68 lieux
   apparus ce jour-là.
5. `plan:cells` à sec annonce trois nombres nommés — couverture, plancher, arbre convergé — et
   aucun ne se présente comme le coût mensuel s'il ne l'est pas.
6. Une simulation sur douze mois, retards de GitHub de 0 à 7 h tirés au hasard, garde la pire
   heure **au-dessus de 85 %** de fiches fraîches, ne dépasse jamais 900 appels dans un mois du
   Pacifique, et jamais 600 au passage du 1er.
7. Un passage à sec sur une base où la fraîcheur prévue reste au-dessus de 80 % sort en succès,
   même avec un arriéré de découverte. Un `HTTP 429` simulé, un passage interrompu, un verrou
   tenu le font sortir en échec, chacun avec sa raison.
8. Le passage du 16 n'est pas refusé par un passage réussi le 1er.

Et le critère qu'on ne verra qu'en vrai : **le 31 décembre 2026 à 20:00 UTC, plus de 80 % des
fiches à horaires sont affichées.** Décembre a 31 jours, et c'est le premier mois où le passage
du 16 peut faire la différence — il doit exister le 16 décembre. S'il n'affiche rien ce soir-là,
rien n'a été réparé.
