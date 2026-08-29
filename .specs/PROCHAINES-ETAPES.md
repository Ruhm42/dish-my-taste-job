# Prochaines étapes

> **Statut** : brouillon · **Dernière mise à jour** : 2026-08-29

Ce document n'est pas un journal de décisions : rien ici n'est acté. C'est l'état mesuré du
produit au 29 août 2026 et les axes qui en découlent, chacun avec ses options, pour que
l'arbitrage se fasse sur des chiffres et non sur une impression. Ce qui sera tranché
rejoindra [`DECISIONS.md`](DECISIONS.md).

Toutes les quantités ci-dessous sont **lues dans la base de production**, pas estimées.

---

## Ce que la base dit aujourd'hui

| | Mesure | Lecture |
|---|---|---|
| Établissements | 4 465 | pour 5 720 SIRENE géocodés en périmètre |
| Avec horaires | 3 466 (78 %) | 999 sont affichés « Horaires inconnus » |
| Avec effectif | 974 (22 %) | **c'est la charnière du verdict, et elle manque 4 fois sur 5** |
| Verdict « confirmé » | 2 623 (59 %) | dont 2 236 par absence de coupure dans les horaires |
| Verdict « probable » | 843 (19 %) | coupure déduite de la seule amplitude, sans effectif |
| Sans coupure **et** week-end libre | 329 | la recherche que la vision désigne comme l'essentiel |
| Candidatures suivies | 0 | la table existe, l'écran n'existe pas |
| Cellules du balayage | 1 501 | 688 faites · 212 tronquées non résolues · **601 jamais interrogées** |

Deux chiffres méritent d'être lus ensemble : le balayage a coûté 900 appels et il en reste
au moins 1 200 à faire ; le quota gratuit est de 1 000 par mois.

---

## 1. Le balayage ne repartira pas tout seul — il est en interblocage

> **Spécifié le 29 août** — voir D28 et
> [`technique/10-reprise-du-balayage.md`](technique/10-reprise-du-balayage.md), qui couvre
> aussi les axes 2 et 3 ci-dessous. Reste à construire.

**Constat.** Le plafond de 900 appels est compté **par balayage**, pas par mois :
`previousCalls` est repris depuis `sweep_run.calls_made`, et le garde-fou compare le cumul
du *run*. Le run en cours affiche `calls_made = 900`, statut `failed`.

Le 1er septembre, `cron:refresh` détectera 601 cellules en attente, sautera la planification
comme prévu par D22, lancera le balayage sur ce même run — et le tout premier appel sera
refusé : `900 + 0 >= 900`. Le job échouera **en ayant dépensé zéro appel**. Et le mois
suivant reproduira exactement la même chose, indéfiniment.

Le plafond par run est délibéré et son motif est juste — dix reprises ne doivent pas
autoriser dix fois le plafond. Mais D22 a décidé de reprendre le balayage **au renouvellement
du quota mensuel**, et le compteur, lui, ne connaît pas les mois. Les deux règles sont
individuellement défendables et mutuellement bloquantes.

**Pourquoi ça compte.** C'est le seul défaut de cette liste qui empêche le produit de
progresser sans intervention. Tant qu'il tient, la base reste à 4 465 établissements, avec un
centre-ville sous-compté (voir plus bas).

**Options**
- *Indexer le plafond sur la période du quota* — compter les appels du mois calendaire en
  cours, puisque c'est exactement la contrainte réelle chez Google. Le total par run reste
  utile au rapport, mais ne pilote plus le refus.
- *Remettre `calls_made` à zéro à chaque nouveau mois* — plus simple, mais efface l'historique
  de coût du run, qui est précisément ce qui a permis d'écrire D22.
- *Un plafond par exécution* — c'est ce que le commentaire du code écarte explicitement, et à
  raison : trois relances manuelles dans la même journée dépasseraient le quota.

**Ce que je ferais.** La première option. Le garde-fou doit être adossé à la période du quota
qu'il protège ; aujourd'hui il protège un quota mensuel avec un compteur qui n'a pas de mois.

## 2. Les horaires expirent le 27 septembre, et rien ne le verra

**Constat.** Les horaires ont été récupérés les 28 et 29 août ; `hours_expires_at` est donc
posé aux 27 et 28 septembre — les 30 jours de rétention imposés par les CGU (D7). Or
`hours_expires_at` est **écrit et jamais lu** : ni par l'application, ni par le balayage, ni
par le cycle mensuel. Aucune requête du produit ne le mentionne.

Aujourd'hui la base compte 0 établissement expiré. Au 28 septembre elle en comptera 4 465, et
l'écran continuera de les afficher comme s'ils étaient frais.

S'y ajoute la règle de reprise : les cellules `done` ne sont pas rejouées. Même si l'axe 1
est corrigé, le balayage de septembre ira chercher les 601 cellules manquantes — il ne
rafraîchira pas les 688 déjà faites, dont les horaires auront dépassé 30 jours.

D7 affirme que « la conformité aux CGU est obtenue par construction, pas par vigilance ».
C'est vrai d'un balayage qui tient dans le mois. Ça ne l'est plus d'un balayage qui déborde,
et le premier a débordé.

**Pourquoi ça compte.** C'est le mode de défaillance que le projet nomme comme le pire :
une base qui se dit à jour et ne l'est pas. La différence avec une liste incomplète, c'est
qu'ici rien ne le signale — pas même une ligne de journal.

**Options**
- *Rendre l'expiration mesurée et visible* — la compter, l'afficher dans la bannière au même
  titre que l'avancement du balayage, et faire échouer le cycle mensuel si elle dépasse un
  seuil. Coût quasi nul, et cela transforme une dérive silencieuse en fait constaté.
- *Purger les horaires expirés* — strictement conforme, mais transforme d'un coup 4 465
  fiches en « Horaires inconnus » : le produit s'éteint plutôt que de vieillir.
- *Rejouer les cellules les plus anciennes en priorité* — fait sens une fois le balayage
  convergé, mais aggrave l'axe 1 tant qu'il ne l'est pas.

**Ce que je ferais.** La mesure d'abord, la politique ensuite. On ne peut pas décider quoi
faire d'une donnée périmée avant de savoir combien il y en a et depuis quand.

## 3. Le coût du balayage complet dépasse le gratuit, et il faut le trancher

**Constat.** D16 promettait 692 cellules pour 1 000 appels gratuits. Le réel : 653 cellules
mères, 212 tronquées, 664 filles créées au premier niveau, 184 au second. 900 appels dépensés,
601 cellules encore en attente — et celles-ci vont tronquer à leur tour, au rythme mesuré
d'une sur quatre. Il reste donc de l'ordre de **1 200 appels pour converger**, soit deux mois
de quota, sans compter le re-balayage mensuel que D7 impose ensuite.

Un chiffre le confirme au passage : `GOOGLE_TO_SIRENE_RATIO` vaut 1,16 dans la configuration,
alors que le ratio observé est de **0,78** (4 465 pour 5 720). Le commentaire de `GRID.maxRadius`
cite toujours le calibrage sur 8 cellules que D22 a invalidé. Une constante fausse ne fait pas
de mal ici : elle fait juste mentir la prévision de coût du plan, qui est l'outil de décision.

**Pourquoi ça compte.** Le « zéro euro » est posé comme contrainte ferme. Il ne tient plus
arithmétiquement au périmètre actuel. Continuer sans le dire, c'est découvrir la facture.

**Options**
- *Replanifier depuis les cellules feuilles mesurées* plutôt que depuis la densité SIRENE.
  Le balayage suivant paierait la couverture réelle et non sa redécouverte : les 212 appels
  de cellules mères tronquées sont, chaque mois, du pur gâchis. Nécessaire, pas suffisant.
- *Réduire encore le périmètre* — Villeurbanne, c'est 568 établissements ; les 4e, 8e et 9e
  réunis, 684. C'est la voie qui garde le gratuit, au prix d'un morceau de ville.
- *Accepter le dépassement le temps de converger* — quelques euros une fois, puis retour au
  gratuit avec un plan stabilisé. Rompt la contrainte, mais sur une durée bornée et connue.
- *Espacer les balayages* — déjà écarté en D7, et l'axe 2 explique pourquoi : au-delà de 30
  jours on sort des CGU.

**Ce que je ferais.** Mesurer d'abord le coût d'un plan convergé (la première option se joue
à sec, sans dépenser), puis arbitrer périmètre contre euros avec ce chiffre en main. Pas
l'inverse.

---

## 4. La carte ne montre plus qu'un échantillon alphabétique

**Constat.** Depuis la pagination, la carte reçoit les lignes **chargées**, soit 50 sur les
4 465 possibles, triées par nom. Sur la recherche emblématique — sans coupure et week-end
libre, 329 résultats — l'utilisateur voit 50 points choisis par ordre alphabétique, donc
répartis au hasard dans la ville.

La spec fonde pourtant la carte sur une promesse précise : « un quartier entier peut se juger
en un regard ». Ce n'est plus vrai. Le regroupement des points qu'elle prévoit n'existe pas
non plus — il n'était pas nécessaire tant que la liste était plafonnée, il le devient dès que
la carte reçoit tout.

**Pourquoi ça compte.** C'est la seule vue qui donne une lecture géographique, et le ciblage
est un travail géographique. C'est aussi une régression : la carte montrait davantage avant
la pagination.

**Tranché le 29 août — voir D27 et [`fonctionnel/04-carte.md`](fonctionnel/04-carte.md).** La
carte porte tous les résultats filtrés ; c'est la pagination qui est découplée, pas le
contenu. Reste à le construire.

**Ce que ça demande.** Une requête de points distincte de la liste — identifiant, position,
risque de coupure, rien d'autre. Trois colonnes sur 4 465 lignes, c'est quelques centaines de
kilo-octets. Séquentielle, jamais en `Promise.all` (D23). Et le regroupement des points
devient alors indispensable, pas décoratif.

## 5. Le suivi des candidatures n'existe pas

**Constat.** La table `application` est en base, l'énumération des étapes aussi. Zéro ligne,
zéro écran, zéro action serveur : hors du schéma, le mot n'apparaît nulle part dans le code.

**Pourquoi ça compte.** La spec en fait la différence entre « un annuaire qu'on consulte une
fois » et « un outil qu'on rouvre tous les jours ». C'est aussi le seul endroit où
l'utilisateur écrit, et le seul axe de cette liste dont la valeur ne dépend ni de Google ni de
SIRENE : il ne coûte pas un appel.

**Point d'attention.** Les tables ont RLS activé sans politique, et l'application passe par
`DATABASE_URL`. Le cloisonnement entre utilisateurs reposera donc entièrement sur le filtrage
serveur par identifiant. C'est aujourd'hui la seule barrière ; elle mérite d'être posée
explicitement plutôt que d'être supposée.

## 6. L'usage est mobile, la mise en page ne l'est pas

**Constat.** La grille bascule à `lg`. En dessous, le panneau de filtres — six blocs — se
déroule **au-dessus** de la liste : sur un téléphone, il faut faire défiler tous les filtres
avant d'apercevoir un seul résultat. La spec prévoit exactement l'inverse : la carte au-dessus
de la liste, et les filtres dans un panneau qui s'ouvre.

**Pourquoi ça compte.** Le public est en tournée, avec un téléphone. Et l'axe 5 — noter
« CV déposé », « demander Karim » — est une fonction de terrain : elle sera utilisée debout,
sur un trottoir, ou pas du tout.

---

## 7. L'effectif manque là où il décide, et c'est structurel

**Constat.** 1 585 établissements sont appariés à SIRENE (35 %), mais seuls 974 en retirent un
effectif (22 %) : SIRENE lui-même ne connaît la tranche que pour 2 485 de ses 6 010
enregistrements. **Même un appariement parfait plafonnerait autour de 41 %.** Améliorer
l'appariement est utile, mais ne rendra jamais le verdict « confirmé » majoritaire.

Conséquence mesurée : 843 établissements portent un verdict de coupure déduit de la seule
amplitude hebdomadaire, sans aucun effectif. La règle de repli est aujourd'hui binaire — plus
ou moins de 70 heures d'ouverture par semaine.

Et un signal qui mérite l'œil : le risque `low` ne concerne que **8 établissements sur 4 465**.
L'option de filtre « Oui ou probablement » ajoute donc huit lignes à « Oui ». Trois choix pour
deux résultats : soit la règle qui produit `low` est trop étroite — elle exige à la fois un
grand effectif connu et une coupure aux horaires —, soit l'option ment sur ce qu'elle promet.

**Pourquoi ça compte.** C'est la justesse du verdict, donc la valeur du produit. La vision dit
« et que cette liste soit juste ».

**Options**
- *Enrichir la règle de repli avec ce qui est déjà en base et gratuit* — la durée réelle de la
  coupure (deux heures et cinq heures ne se valent pas), le nombre de jours concernés, la
  catégorie (une boulangerie, un fast-food et un bistrot n'ont pas la même mécanique
  d'équipe). Aucun appel, aucune source nouvelle : uniquement mieux lire ce qu'on a.
- *Remonter le taux d'appariement* — 4 135 SIRENE non appariés sur 5 720. Un gain direct sur
  la part « confirmée », sans coût.
- *Assumer le plafond et mieux le dire* — si 40 % de verdicts pleinement confirmés est le
  maximum atteignable, l'écran doit le porter clairement plutôt que de le diluer.

**Ce que je ferais.** La première, d'abord : c'est la seule qui améliore la justesse sans
dépendre d'une source extérieure, et elle se vérifie hors ligne avec `compute:profiles`, sans
toucher au quota.

---

## 8. Petites choses, effet immédiat

| Constat | Mesure | Effet |
|---|---|---|
| La recherche est sensible aux accents | « cafe » trouve 40 fiches, « café » en trouve 222 | 918 noms portent un accent. Sur un clavier de téléphone, on tape sans. `pg_trgm` est là, `unaccent` non |
| Liste et carte ne se répondent pas | la carte ne reçoit ni sélection ni rappel | le survol et le clic croisés prévus par la spec n'existent pas |
| `google.maps.Marker` est déprécié | la bibliothèque `marker` est déjà chargée | remplacement sans coût, avant qu'il ne devienne obligatoire |
| Le tri est figé sur le nom | contrainte du curseur de pagination | chercher un emploi par ordre alphabétique n'a pas de sens ; un tri par rythme demande un curseur composite |
| Le centre est le plus sous-compté | 112 cellules en attente sur le 1er, 111 sur le 2e | la bannière annonce un manque global ; il est concentré là où l'on cherche du travail |
| Aucun test sur les filtres ni la pagination | `grid`, `hours` et `category` en ont | c'est pourtant le chemin qui décide de ce qui s'affiche |

---

## Ordre proposé

1. **Axe 1** — sans lui rien n'avance, et l'échéance est le 1er septembre.
2. **Axe 2** — l'échéance est le 27 septembre, et la mesure coûte presque rien.
3. **Axe 4** — régression sur la promesse centrale, correction bornée.
4. **Axe 3** — arbitrage périmètre/euros, à instruire avec le coût d'un plan convergé.
5. **Axe 5** puis **6** — ce qui fait revenir l'utilisateur, et le terrain où il est.
6. **Axe 7** — le plus profond, le moins urgent : il améliore une base qui tourne déjà.
7. **Axe 8** — au fil de l'eau, en accompagnement des précédents.

## Ce que je n'ai pas retenu, et pourquoi

- *Filtrer par cuisine* — D24 vient de trancher l'inverse : la cuisine est une information,
  pas un axe de rythme.
- *Afficher un score de fiabilité chiffré* — la vision l'interdit explicitement : des mots,
  jamais un pourcentage.
- *Étendre le périmètre à d'autres communes* — l'axe 3 dit qu'on ne finance déjà pas celui-ci.
- *Mettre en cache les résultats de recherche* — les pages tiennent en quelques millisecondes ;
  ce serait de la complexité sans problème à résoudre.
- *Alerter sur les nouveaux établissements sans coupure* — la spec exclut les notifications, et
  le balayage mensuel ne donnerait de toute façon qu'une fraîcheur de trente jours.
