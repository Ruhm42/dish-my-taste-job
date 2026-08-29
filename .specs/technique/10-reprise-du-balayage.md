# Reprise du balayage et fraîcheur des horaires

> **Statut** : acté · **Dernière mise à jour** : 2026-08-29

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

### Le plafond journalier est une contrainte distincte, et il est plus bas

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

Et le critère qui compte le plus, celui qu'on ne verra qu'en vrai : **le 1er septembre, le job
dépense des appels.** S'il échoue en ayant dépensé zéro, rien n'a été réparé.
