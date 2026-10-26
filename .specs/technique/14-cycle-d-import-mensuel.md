# Le cycle d'import mensuel des points d'intérêt

> **Statut** : acté, sauf les sections marquées *brouillon* · **Dernière mise à jour** : 2026-10-26

Cette spec est la référence consolidée du cycle de rafraîchissement : ce qui tourne, quand,
dans quel ordre, ce que chaque pièce écrit, ce qui la fait échouer et quoi faire alors. Elle ne
rejoue pas les arbitrages de [D36 à D39](../DECISIONS.md#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt) :
le choix de ce qu'on rafraîchit vit dans [`13`](13-rafraichissement-par-couverture.md), le
budget dans [`02`](02-budget-google-et-garde-fous.md), la reprise dans [`10`](10-reprise-du-balayage.md).

Les pièces du cycle :

- `sweep.yml` lance `cron-refresh.ts`, qui enchaîne `sweep:google`, `match:sirene` et
  `compute:profiles` ;
- s'y ajoutent la purge (`purge.yml`), le réveil de la base (`keepalive.yml`) et les ingestions
  SIRENE et BAN, faites à la main.

Elle est écrite sous la lecture des conditions Google que D7 a retenue : 30 jours de
conservation. Cette lecture est mise en question par l'axe 0 de
[`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md). Tout ce qui dépend de la rétention est isolé au
§ 14 et rendu conditionnel.

Les sections *brouillon* exposent ce qui revient au propriétaire. Elles donnent les options et
leurs conséquences, sans trancher. Les choix eux-mêmes sont listés dans
[`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md), section « Le cycle d'import ».

Aucune mesure de cette spec n'a coûté un appel Google. Aucune ne contient de contenu Places :
le dépôt est public, et seuls des agrégats et des identifiants de cellule ou de run y entrent.

---

## 0. L'état mesuré, 17 octobre 2026

**Sources.**
- La production, en `SELECT` dans une transaction en lecture seule, à 16:59 et 17:08 UTC.
- Une copie locale, dont les colonnes que lit le balayage ont la même empreinte que la
  production à 17:00 UTC : `cell` (statut, `queried_at`, `google_count`), `restaurant`
  (échéance, statut, SIRET, `last_seen_at`) et `sirene_establishment`. Seuls les profils
  diffèrent, recalculés en production à 11:04 UTC.
- Les logs GitHub Actions.
- Le fichier stock SIRENE du 1er octobre, lu en place par DuckDB.
- OpenStreetMap, par l'API Overpass.

Les requêtes sont en annexe.

| | Mesure |
|---|---|
| Plan | 2 408 cellules : 1 364 `done`, 435 `truncated`, 609 `pending`. 239 cellules de profondeur 0 portent plus de 12 points SIRENE, le plafond de D30 règle 3 |
| `sweep_run` | **une seule ligne** pour tout le plan, statut `failed` (statut d'avant D39), `calls_made` = 2 700. Ouverte le 28/08 à 23:55 UTC, dernière fin le 01/10 à 16:24 UTC |
| Tampons par mois Pacifique | 2026-08 : **0** · 2026-09 : 899 · 2026-10 : 900. Août a payé 900 appels, mais un rachat déplace le tampon de la cellule (§ 4) |
| Quota | 900 appels sur la période 2026-10 : plus aucune marge avant le 01/11 07:00 UTC |
| Fiches | 4 653 : 4 410 `OPERATIONAL`, 243 `CLOSED_TEMPORARILY`, **0** `CLOSED_PERMANENTLY` |
| Fiches avec une échéance | 3 730 : 3 608 valides, et 122 échues dont les horaires sont encore stockés |
| Échéance des horaires valides | **toutes le 31/10, entre 15:54 et 16:24 UTC** |
| Fiches sans échéance | 923, dont les 243 `CLOSED_TEMPORARILY`. Aucune couverture ne les rachète exprès |
| Fiches fantômes au sens de D44 | 505 : `OPERATIONAL`, sans horaires, sans téléphone ni SIRET |
| SIRENE | 6 010 lignes, dernière ingestion le 28/08 à 23:54 UTC. 0 `NN` et 3 525 tranches nulles : `NN` est replié à l'ingestion. `imported_at` est réécrit à chaque upsert |
| Candidatures | 0 |
| Couverture du 01/11, passe à sec | robuste **622** cellules, fiches connues **560** ; 2 fiches hors de toute portée ; 97 cellules vides |

## 1. Les pièces et leur cadence

| Pièce | Où | Quand | Ce qu'elle écrit | Dépense | Mode sec | Décisions |
|---|---|---|---|---|---|---|
| `sweep.yml` → `cron-refresh.ts --go` | Actions | Le 1er et le 16, 09:00 UTC ; `workflow_dispatch` | tout ce que ses étapes écrivent | oui, par `sweep:google` | `cron:refresh` sans `--go` | D38, D33, D39 |
| `plan:cells` | dans le cycle | **sauté en `--go`** dès qu'un plan existe ; joué à sec | rien à sec, un nouveau plan avec `--write` | non | par défaut | D22, D36, D37 |
| `sweep:google` | dans le cycle | à chaque passe | `cell`, `restaurant`, `sweep_run` | **le seul poste payant** | par défaut ; `--as-of=` | D28, D36, D38, D39 |
| `match:sirene` | dans le cycle, même après un échec | à chaque passe | SIRET et effectif des fiches, profils de celles dont l'effectif change | non | `--dry-run` | D31, D33, D39 r6 |
| `compute:profiles` | dans le cycle, même après un échec | à chaque passe | profil de chaque fiche, `schedule` compris | non | `--check` | D29, D33 |
| `purge.yml` → `purge-expired.ts --write` | Actions | chaque jour, 10:23 UTC ; `workflow_dispatch` **écrit par défaut** | vide les horaires échus et ce qui en dérive | non | `--dry-run` | D45 r1 |
| `keepalive.yml` | Actions | lectures chaque jour à 05:17 UTC ; commit le lundi à 05:47 UTC | un horodatage, le lundi | non | — | D19, D35 |
| `ingest:sirene`, `ingest:geocode` | poste local | « trimestriel », à la main | `sirene_establishment` | non | **aucun** | D13, D41 |
| `simulate:passes` | poste local | avant de toucher `CYCLE` ou la couverture | rien | non | toujours sec | D38 |

Les étapes hors ligne tournent même quand le balayage a échoué ; seul un signal d'arrêt les
emporte (D33). Le premier échec est conservé et fait sortir le cycle en rouge.

Le job du balayage a 60 minutes. Le 1er octobre, 900 appels ont pris 30 minutes, et l'étape
`compute:profiles` 2 minutes 20.

## 2. Le calendrier d'un mois

### La période du quota

C'est le **mois du Pacifique**, celui sur lequel Cloud Billing renouvelle le quota gratuit
([D47](../DECISIONS.md#d47--la-période-du-quota-est-le-mois-du-pacifique)). Il commence à 07:00 UTC
en heure d'été et à 08:00 UTC en heure d'hiver. Le 1er novembre 2026 est le jour du
changement d'heure en Californie : la période 2026-11 ouvre à 07:00 UTC.

### Deux passes

| | Le 1er | Le 16 |
|---|---|---|
| Planifiée à | 09:00 UTC | 09:00 UTC |
| Plafond, sur le total de la période | 450 (`firstPassCeiling`) | 900 |
| Réserve | — | 15 appels pour les cellules vides dues |
| Ordre de service | contenu expiré ou dû sous 12 h ; dû avant la passe suivante + 12 h ; le reste par échéance ; découverte (D38 r3) | idem, après la réserve |

Le plafond se lit sur le total de la **période**, pas de l'exécution : une relance du 3 partage
les 450 de la passe du 1er.

### Les retards de GitHub, mesurés

GitHub retarde les planifications, d'autant plus à l'heure ronde. Sa documentation, lue le
17 octobre 2026, dit aussi qu'une exécution planifiée **peut être abandonnée** sous forte
charge.

| Workflow, planification | Retards observés |
|---|---|
| `sweep.yml`, 09:00 | 01/09 : 4 h 51 · 01/10 : 6 h 54 |
| `keepalive.yml`, 05:17 | 31/08 : 6 h 21 · 07/09 : 5 h 10 · 14/09 : 5 h 28 · 21/09 : 5 h 31 · 28/09 : 6 h 24 · 01/10 : 6 h 19 · 05/10 : 6 h 58 · 08/10 : 6 h 44 · **12/10 : 7 h 52** · 15/10 : 4 h 36 |
| `keepalive.yml`, jeudi 24/09 | **aucune exécution planifiée** : seul un lancement manuel à 06:40 |

Le maximum mesuré, 7 h 52, dépasse les 7 h que suppose `CYCLE.maxScheduleDelayHours`.
[D50](../DECISIONS.md#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour) fixe la valeur à
8 h. Rejouée avec 8 h, la simulation garde la même pire heure, 91,5 %.

La documentation de GitHub, lue le 17/10, permet un fuseau IANA dans `on.schedule`. Ce qu'il
permettrait est un choix du propriétaire, au § 9.

### La simulation qui fixe le plafond du 1er, consignée

D38 r1 demande que la simulation qui fixe le plafond soit consignée.

- **Commande** : `simulate:passes --from=2026-11-01T09:00:00Z --seed=N`, N de 1 à 10.
- **Données** : la copie du 17/10 décrite au § 0.
- **Résultat** : pire heure **91,5 %** pour chaque graine (le 15/06/2027 entre 13:00 et
  16:00 UTC), moyenne 99,5 %.
- **`lowest forecast`** : **91,5 %**.
- **Plafonds** : au plus 900 appels par période et 450 avant le 16, jamais dépassés.
- **Le reste** : 120 rejeux de cellules vides et 0 appel de découverte.

Le 1er novembre n'est pas couvert par ce chiffre : la simulation ne commence à mesurer qu'après
la première passe. La passe à sec du 01/11 à 09:00 UTC (`sweep:google --dry-run
--as-of=2026-11-01T09:00:00Z`) prévoit **95,9 %** au 16/11 16:00 UTC et finirait `capped`.
Les fiches que ses 450 cellules ne rachètent pas, environ 4 %, restent échues du 31/10 au
16/11. La coupure elle-même est au § 9.

## 3. Ce qu'une passe écrit, et ce qu'elle ne garde pas

- **`sweep_run`** : **une ligne par plan**, réécrite à chaque exécution. `calls_made` cumule
  tout le plan ; `status`, `error` et `finished_at` sont ceux de la dernière exécution. Un
  refus de démarrer n'écrit rien, par construction : il est pris avant l'ouverture de la ligne,
  pour ne pas effacer la raison de l'arrêt précédent.
- **`cell.queried_at`** : **un seul tampon par cellule**, celui de son dernier appel.
- **`restaurant`** : upsert sur `google_place_id`.
  - Les horaires et leur échéance (+ 30 jours) sont écrits, ou mis à nul si l'appel n'en
    renvoie pas.
  - `business_status` est écrasé, sans historique.
  - `last_seen_at` est daté de l'appel ; `first_seen_at` est conservé.

Il n'existe donc **aucun historique par passe** en base. Il n'existe que dans les logs Actions,
gardés 90 jours : celui du 01/09 expire vers le 30/11, celui du 01/10 vers le 30/12. Leurs
agrégats, recopiés ici sans aucun nom :

| Passe | Run | Départ (retard) | Appels | Arrêt | Fiches renvoyées | dont avec horaires | Troncatures résolues / en attente | Cellules en échec |
|---|---|---|---|---|---|---|---|---|
| 01/09 | `33515957346`, `d55074b` | 13:51 UTC (4 h 51) | 737 | `HTTP 500` | 2 894 | 2 309 (80 %) | 97 / 297 | 1 |
| 04/09 | **aucun** | 17:06–17:10 UTC | 163 | — | — | — | — | — |
| 01/10 | `36887894355`, `9b76ff6` | 15:54 UTC (6 h 54) | 900 | plafond | 4 472 | 3 608 (81 %) | 104 / 331 | 0 |

Le 01/10, `match:sirene` a apparié 1 622 fiches sur 4 653 et retenu le canari, faute de
couverture servie en entier. 82 fiches à horaires étaient déjà échues à la fin du cycle.

Les 163 appels du 04/09 n'ont **ni acteur ni run** : un lancement local, que rien ne trace.

> **Annoté le 26 octobre 2026.** D52 donne cet historique : le journal du § 5, une ligne par
> exécution. Ses lignes du passé sont celles de ce tableau, plus août. Jusqu'à sa construction,
> ce qui précède reste vrai.

## 4. Le garde-fou de dépense, et son défaut depuis D38

### Ce qu'il lit

Avant de dépenser, le balayage impute à la période le **maximum de deux lectures** :

- les cellules dont le `queried_at` tombe dans la période (« stamped ») ;
- un plancher tiré de `sweep_run` (« logged »). Il retranche de `calls_made` 900 appels pour
  chaque **autre** période où le plan a été actif.

Si le plancher dépasse les tampons de plus de 5 (`LEDGER_SLACK`), il refuse : des lignes auraient
disparu.

### Pourquoi les deux lectures ont cessé d'être justes

D38 fait racheter par la passe du 16 des cellules que celle du 1er a déjà achetées, **dans la
même période** : tout le contenu est dû à chaque passe. Une cellule n'a qu'un tampon, donc deux
appels n'en laissent qu'un. Le commentaire de `spentIn` affirme qu'un rachat ne peut sous-compter
que « a period already closed, never the one being spent » : c'est faux depuis D38.

Le plancher, lui, n'est exact que si chaque autre période a dépensé exactement 900. Une période
restée en dessous le relâche d'autant, **pour toutes les périodes suivantes**.

### Mesuré sur la copie du 17/10, sans un appel

Les choix réels de `planPass` ont été rejoués pour le 01/11 et le 16/11, aux heures de la
simulation, puis tamponnés dans une base d'expérience locale. Le balayage à sec a ensuite lu
cette base.

| Scénario | Lecture du balayage | Effet |
|---|---|---|
| Les deux passes de novembre, complètes | **234 cellules** achetées le 1er et rachetées le 16. 900 appels prouvés, 666 tampons | Tout lancement en novembre après le 16 est **refusé** : `the cell ledger is missing at least 234 call(s)`. Rouge sous D39 |
| La passe du 16/11 interrompue après 200 appels, comme le 01/09 sur un `HTTP 500` | 23 rachats parmi ces 200. 650 prouvés, 627 tampons | La **reprise est refusée** (`missing at least 23`). La période reste à 650 |
| Ce même novembre, puis un décembre complet | Novembre a relâché le plancher de 250. En décembre : 900 réels, 651 tampons, plancher 650 | **Aucun refus.** Le balayage croit la période à 651 et autorise **249 appels** : un `--go` manuel le 20/12 porterait décembre à **1 149** appels réels, 149 au-delà du gratuit |

Les deux conséquences s'enchaînent. Une passe du 16 interrompue ne peut plus reprendre, sa
période reste sous 900, et c'est précisément ce qui relâche le plancher pour la suite. Le
plafond journalier de Google ne protège pas : le dépassement se fait un autre jour. L'alerte
budget constate après coup.

Le brief de cette session annonçait « au moins ~263 » rachats (450 + 435 − 622). La mesure en
donne 234 : les choix du 16 ne viennent pas tous de la couverture entière, et cette borne n'en
est pas une.

Aucun test ne couvre ce cas. Les tests de `loggedFloor` supposent une cellule par appel.

### Rejoué sur douze mois, 26 octobre 2026

Même copie, même graine, sans un appel. Un script local rejoue `simulate:passes` en suivant
chaque tampon, les appels réels, et ce que lirait chaque garde-fou. Il retrouve la pire heure de
la simulation, 91,5 %.

| Passe du 16 | Rachats | Tampons de la période | Plancher | Lecture actuelle | Journal (D52) |
|---|---|---|---|---|---|
| 16/11/2026 | 234 | 666 | 900 | refus, manque 234 | 900 |
| 16/12/2026 à 16/10/2027 | 186 à 249 | 651 à 714 | 900 | refus, chaque mois | 900 |
| 16/11 coupée à 200 appels | 23 | 627 | 650 | refus de la reprise | 650 ; la reprise dépense 250 |
| puis 16/12, complète | 249 | 651 | 650 | **651**, aucun refus | 900 |

Le défaut revient donc à chaque passe du 16, et non une fois.

**L'option qui interdit au 16 de racheter**, simulée avec le même script, graines 1 à 3 :
- pire heure **69,5 %** au lieu de 91,5 %, le 31/03/2027 ; moyenne 99,1 % au lieu de 99,5 % ;
- onze passes du 16 sur douze prévoient entre **69,5 et 74,8 %**, sous les 80 % de D39 r3 —
  février excepté, à 99,9 %.

Les tampons y redeviendraient exacts, au prix d'un rouge par mois.

### Ce qui est décidé

[D52](../DECISIONS.md#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel) :
la dépense de la période se lit dans le journal du § 5, où chaque appel est réservé avant d'être
fait. Les tampons des cellules ne servent plus que de contrôle. Le plancher tiré de `sweep_run`
disparaît. **Le code est sur `main` avant le 16 novembre 2026, 09:00 UTC.**

D'ici là, la règle provisoire tient : **aucun `--go` ni `workflow_dispatch` de `sweep.yml`
entre le 16 et la fin du mois Pacifique.** Un refus « ledger missing » après le 16 n'est pas
une perte de lignes : c'est ce défaut, et il ne faut pas « restaurer » quoi que ce soit pour le
lever.

Si la date est manquée, la passe du 16 elle-même part : l'ancien garde-fou ne refuse qu'après
elle. Ce sont sa reprise et tout ce qui la suit dans le mois qui sont refusés, et une passe
coupée relâche décembre.

## 5. Le journal des exécutions

> **Acté** par [D52](../DECISIONS.md#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel)
> le 26 octobre 2026, sauf « ce qu'est un bon mois », qui reste *brouillon*.

**Ce qu'il remplace.** La ligne unique de `sweep_run` comme registre de dépense, et les logs
Actions comme seul historique. `sweep_run` reste la ligne du plan.

**Une ligne par exécution du balayage en `--go`**, refus compris. Le mode sec n'écrit rien. Une
ligne écrite à la main — le passé, une réconciliation — porte `source = hand` et une note qui
donne sa source.

### Les colonnes

Table `sweep_execution`. Les noms sont indicatifs ; ils suivent la règle du dépôt, en anglais.

| Colonne | Contenu | Requise le 16/11 |
|---|---|---|
| `id` | identifiant | oui |
| `run_id` | le plan parcouru : clé étrangère vers `sweep_run`, **sans cascade** — supprimer un plan ne doit pas effacer sa dépense. Nulle pour une réconciliation qu'aucun plan ne porte | oui |
| `source`, `note` | `sweep` ou `hand` ; d'où vient le chiffre, obligatoire pour `hand` | oui |
| `trigger`, `actor`, `commit_sha`, `github_run_id` | l'origine : `schedule`, `workflow_dispatch` ou `local`, puis l'acteur, le SHA et le run GitHub quand ils existent | oui |
| `started_at`, `finished_at` | début et fin ; fin nulle tant que l'exécution tourne, ou si elle a été tuée | oui |
| `period` | la période Pacifique, `2026-11` (`monthKey`) | oui |
| `pass` | `first` ou `second` ; nulle pour le passé d'avant D38 | oui |
| `pass_ceiling`, `spent_at_start` | le plafond de la passe et la dépense de la période, lus au départ | oui |
| `calls_made` | **les appels réservés, un par un, avant chaque requête** | oui |
| `status`, `error` | `running`, `refused`, `capped`, `succeeded`, `failed`, et `recorded` pour une ligne à la main ; les défauts de D39, ou la raison du refus | oui |
| `cover`, `cover_planned`, `cover_served` | la couverture servie, robuste ou fiches connues ; ses cellules servies sur prévues | non |
| `empty_replays`, `discovery_calls` | rejeux de cellules vides, appels de découverte | non |
| `fresh_at_start`, `forecast_at_start`, `forecast_at_end` | part des fiches utilisables au départ ; prévision du plan, puis prévision stockée à la fin | non |
| `out_of_reach_records` | fiches hors de toute portée, comptées | non |
| `places_returned`, `places_with_hours`, `places_new` | lieux renvoyés, dont avec horaires (D48 r2), et fiches nouvelles | non |

Un index sur `period`.

Les colonnes de compte rendu sont nullables : si le temps manque avant le 16, le code les laisse
vides, jamais l'inverse. Elles entrent pourtant dans la même migration, parce que c'est
l'application à la main qui coûte. Les fiches absentes de D45 r2 attendent leur propre colonne.

**Aucun contenu Places** : des comptes, des dates et des identifiants, rien sur un établissement
nommé. C'est une métadonnée à nous, sans échéance de conservation.

### Comment il compte

- **Réserver.** Avant chaque requête, une instruction incrémente `calls_made` sur la ligne de
  l'exécution. La requête ne part que si l'instruction a réussi.
- **Lire la période.** La somme des `calls_made` des lignes de la période, `running` comprises :
  une exécution tuée a laissé son compte. Le plafond est imputé du maximum de cette somme et des
  cellules tamponnées dans la période.
- **Une exécution, une passe, une période.** `spendOne` ne remet plus le compteur à zéro au
  changement de période. Il arrête l'exécution avant le premier appel d'une autre passe, et à
  moins d'une minute de minuit Pacifique en fin de période. L'arrêt sort `capped`.
- **Contrôler**, sous le verrou, avant d'ouvrir la ligne :
  - les tampons de la période ne dépassent pas la somme de son journal, plus un ;
  - `sweep_run.calls_made` du plan ne dépasse pas la somme du journal du plan.

  Si l'un manque, c'est un refus, écrit comme une ligne `refused`. Son message dit la sortie : la
  dépense réelle établie en console, une ligne `hand` qui la porte, puis une relance.
- **Clore.** À chaque fin d'exécution, la ligne reçoit son statut, et `sweep_run.calls_made`
  devient la somme du journal du plan. Une ligne laissée `running` par une exécution tuée est
  close en `failed` par la suivante, qui tient le verrou ; ses appels restent comptés.
- **Le verrou consultatif ne change pas.** C'est lui qui empêche deux exécutions de lire la même
  marge.

### La migration

Appliquée à la main en production, **avant la fusion** du code, puisque `sweep.yml` exécute
`main` à chaque planification. Ni le 1er ni le 16 avant que la passe du jour ait fini. En une
transaction :

1. la table, telle que `drizzle-kit` la génère depuis `schema.ts`. Jamais `db:push` vers la
   production ;
2. la RLS activée, sans politique. Les privilèges par défaut du schéma `public` donnent tous les
   droits à `anon` sur une table nouvelle : sans RLS, la clé publiable, publique, pourrait effacer
   le journal ;
3. les lignes du passé, `source = hand`, `status = recorded`, sur le plan en place :

   | Période | Appels | Note |
   |---|---|---|
   | 2026-08 | 900 | premier balayage, 28 et 29/08 UTC, lancé d'un poste |
   | 2026-09 | 737 | run `33515957346`, planifié, 01/09, arrêté sur `HTTP 500` |
   | 2026-09 | 163 | lancement local du 04/09, sans run |
   | 2026-10 | 900 | run `36887894355`, planifié, 01/10, arrêté au plafond |

   et une ligne de plus par exécution de l'ancien code depuis, d'après son log ;
4. la vérification : la somme de ces lignes égale `sweep_run.calls_made`. Sinon, `rollback`.

Puis la fusion. Le déploiement échoue sur le garde-fou de `schema.ts`, comme prévu, et se
relance par `workflow_dispatch` (D32).

Comparées aux tampons, ces lignes disent ce que le § 0 laissait voir : août vaut 900 appels au
journal et **0** tampon. Les rachats de septembre et d'octobre ont déplacé tous ses tampons.

### Critères d'acceptation

Joués à sec, sans un appel Google, sur une base de travail créée dans le conteneur
`dmtj-db-cycle` depuis `dmtj` (`create database … template dmtj`). Jamais sur `dmtj_exp`, qui
porte les tampons fictifs de l'expérience du § 4, ni sur `dmtj` lui-même.

1. **La migration.** La table existe, RLS active. Quatre lignes du passé, de somme 2 700 =
   `sweep_run.calls_made`. Par période : 900, 900, 900, là où les tampons disent 0, 899, 900.
2. **Octobre plein.** `sweep:google --dry-run --as-of=2026-10-28T12:00:00Z` : 900 dépensés, rien
   à dépenser ; le seul refus est « already spent ».
3. **Novembre neuf.** `--as-of=2026-11-01T09:00:00Z` : 0 dépensé, 450 possibles.
4. **Deux passes, avec rachats.** Les choix de `planPass` pour le 01/11 et le 16/11, aux heures
   de `simulate:passes` graine 1, sont rejoués comme au § 4 : tampons écrits comme le balayage
   les écrit, une ligne de journal par passe avec ses appels, `sweep_run.calls_made` réécrit
   comme en fin d'exécution. À sec au 20/11 : **900** dépensés, 666 tampons, rien à dépenser,
   aucun refus de perte. L'ancien code y lit « missing at least 234 ».
5. **Le 16 coupé.** Même rejeu, passe du 16 arrêtée à 200 appels : 650 dépensés, 627 tampons,
   **250** possibles, aucun refus.
6. **Le mois d'après.** Ce novembre à 650, puis un décembre complet : à sec au 20/12, **900**
   dépensés, 651 tampons, rien à dépenser. L'ancien code y lit 651 et autorise 249 appels.
7. **Ce qui échappe au journal.** La ligne du 16/11 supprimée : refus, dont le message nomme
   l'écart et la sortie. `sweep_run.calls_made` relevé de 10 à la main : refus sur le total du
   plan.
8. **Les tests**, dans `npm test` : la réservation précède la requête ; aucune requête si elle
   échoue ; l'arrêt à la borne de passe et à moins d'une minute de minuit Pacifique ; la lecture
   de la période et les deux contrôles, sur les cas 4 à 7. PGlite sert déjà aux tests de la
   purge.
9. **En production, après la migration.** `relrowsecurity` vrai. La Data API, avec la clé
   publiable, renvoie `[]` sur la table, qui a pourtant quatre lignes. À sec, la dépense de la
   période égale la somme de son journal.

Et le critère qu'on ne verra qu'en vrai : **le 16 novembre 2026, la passe du 16 dépense. La somme
du journal de 2026-11 égale les appels que donnent les logs de ses exécutions, et la console de
novembre ne dit pas plus.**

Le test de bout en bout, deux passes sur PGlite contre une fausse API, reste le choix C10.

### Ce qu'il permet en plus

- La vérification quotidienne du § 7 (D50), sur une donnée exacte. Elle lit les lignes finies, et
  ne compte pas un refus comme une passe.
- La part de lieux renvoyés avec horaires de D48 r2, consignée à chaque passe.
- La définition d'un bon mois, ci-dessous.
- Une comparaison d'une passe à l'autre qui ne dépend plus d'un log qui expire.

### Ce qu'est un bon mois — *brouillon*

> **Brouillon** — proposé, non tranché par D52.

- les deux passes ont eu lieu, sans défaut D39 ;
- aucune période n'a imputé moins que la dépense réelle, et la console de facturation le
  confirme ;
- la purge et le réveil ont été verts chaque jour ;
- la fraîcheur **constatée** — et non seulement prévue — n'est jamais descendue sous 80 % ;
- le canari, quand il a été enregistré, ne signale aucune commune.

Ce verdict mensuel n'existe pas aujourd'hui.

## 6. Ce qui fait échouer une passe, et quoi faire

Les défauts sont ceux de [D39](../DECISIONS.md#d39--ce-qui-fait-échouer-le-cycle) et de
[D48](../DECISIONS.md#d48--une-base-sans-échéance-ne-passe-pas-pour-fraîche). Pour chacun : ce
qu'il veut dire, quoi regarder, quoi faire, et ce qu'il ne faut pas faire.

| Raison affichée | Ce qu'elle veut dire | À regarder d'abord | À faire | À ne pas faire |
|---|---|---|---|---|
| `interrupted: HTTP 5xx` | Google a répondu en erreur ; la passe s'est arrêtée au premier échec | le log : appel en cours, cellules restant dues | Avant le 16 : une relance manuelle reprend dans le plafond de la passe. **Après le 16 : rien** tant que le § 4 n'est pas corrigé | relancer en boucle |
| `Google refused on quota` (`HTTP 429`) | Google a refusé avant notre compteur : un plafond console a changé, ou un autre projet consomme le même compte (§ 12) | la console : plafonds et consommation du jour, par projet | Le propriétaire lit la console. On ne relance pas avant | relancer : c'est le mur de la facture |
| `interrupted: … signal` / `stopped by` | annulation, ou dépassement des 60 minutes | le motif du runner | comme une interruption HTTP | `cancel-in-progress` |
| base injoignable, `ENOTFOUND tenant/user` | la base est en pause | l'historique de `keepalive.yml` | le propriétaire la reprend depuis le tableau de bord, puis on relance si la période le permet | se connecter en boucle : une pause ne se lève pas ainsi |
| `N failed cell(s)` | un appel payé, sans résultat | — | rien : la passe suivante la rejoue en découverte | — |
| `N irreducible cell(s)` | un trou que rien ne couvre | la cellule, par son identifiant | une décision explicite (C6) ; **rouge à chaque passe** jusque-là. Aujourd'hui compté sur tout le plan, non sur le cycle qui l'atteint (écart D39) | l'acquitter en silence |
| `truncated cell(s) without any recovery cell` | une reprise s'est perdue | les cellules filles | à instruire ; aucun cas observé | — |
| `refused to start: lock held` | un balayage tourne, ou un verrou a fui par le pooler | la requête sur `pg_locks` que donne le message | si aucun balayage ne tourne : terminer le backend qui le tient | lancer un second balayage |
| `refused to start: … ledger missing` | **avant le 16** : des lignes de `cell` ont disparu. **Après le 16** : le défaut du § 4 | la date, puis `select count(*)` des cellules tamponnées dans la période | avant le 16 : retrouver les lignes ou la dépense réelle en console. Après le 16 : attendre le 1er | supprimer des cellules, éditer `calls_made` |
| `refused to start: … already spent` | la passe n'a plus rien à dépenser | — | attendre le 16 ou le 1er. Si une passe manuelle a précédé la planifiée, ce rouge est attendu | relever le plafond |
| `forecast freshness … under 80 %` | la liste va s'éteindre au-delà du creux structurel | la couverture servie et la part des lieux renvoyés avec horaires | à instruire. Une passe manquée se rattrape à la main avant le 16 | masquer le rouge |
| *(D48)* lieux renvoyés avec horaires sous 50 % | Google ne renvoie plus les horaires : masque de champs ou réponse changés | le masque, la réponse brute d'une cellule | arrêter tout `--go` jusqu'à comprendre | relancer : chaque passe effacerait d'autres horaires |

> **Annoté le 26 octobre 2026.** Deux lignes de ce tableau changent quand D52 est construite.
> - `interrupted: HTTP 5xx` : après le 16, une relance reprend jusqu'au plafond de la période.
> - `refused to start: … ledger missing` disparaît. Le remplacent deux refus : des cellules
>   tamponnées dans la période, ou un total de plan dans `sweep_run`, au-delà de ce que le journal
>   a réservé. Ils veulent dire qu'une dépense n'est pas passée par le journal — un ancien code
>   lancé d'un poste, une ligne effacée. À regarder : la console. À faire : une ligne à la main qui
>   porte la dépense réelle et sa source (§ 5). À ne pas faire : éditer `calls_made` d'une ligne
>   existante.

Un cycle rouge envoie aujourd'hui un **e-mail GitHub, et rien d'autre**. Les 8, 12 et 15
octobre, le réveil a été rouge trois fois sans que rien ne bouge, et la base est restée en pause
neuf jours. Le canal est un choix du propriétaire (C5).

## 7. Ce qui se vérifie chaque jour

[D50](../DECISIONS.md#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour).

- **L'âge de la dernière passe.** Chaque jour, une vérification échoue si aucune passe n'a fini
  depuis la dernière date planifiée augmentée de 8 heures de retard et d'une heure de job. Elle
  lit `sweep_run` aujourd'hui, le journal demain. C'est la seule chose qui verrait une passe
  abandonnée par GitHub. Elle vit dans un job à elle : le réveil a appris ce que coûte un
  couplage (D35).
- **Le réveil** : vert chaque jour, ou la base se met en pause.
- **La purge** : verte chaque jour, ou du contenu échu reste stocké.

Une vérification planifiée meurt avec les autres planifications. Si GitHub désactive le dépôt
après 60 jours sans commit, ou cesse de planifier, rien de ce qui précède ne le dit. Un témoin
**extérieur** le dirait : c'est le choix C5.

**À surveiller dans les prochains jours, en lecture seule.**
- Le premier réveil planifié de D35 : le 18/10 à 05:17 UTC.
- La première purge en écriture : le 18/10 à 10:23 UTC. Le lancement manuel du 17/10 à 11:34 UTC
  était à sec : 122 fiches.
- `ubuntu-latest` bascule sur Ubuntu 26.04 du 19/10 au 19/11 (annonce `actions/runner-images`
  n° 14748). La liste du logiciel de l'image 26.04 porte PostgreSQL 18.6 : le `psql` que suppose
  le réveil reste préinstallé, d'après la documentation lue le 17/10.

**Observé du 18 au 26 octobre**, relevé le 26/10 à 17:40 UTC :
- **Le réveil** a été vert chaque jour. Il démarre entre 09:32 et 11:07 UTC, soit 4 h 15 à
  5 h 50 de retard. Les deux commits du lundi sont partis.
- **La purge** a été verte chaque jour. Elle démarre entre 14:02 et 17:01 UTC, soit 3 h 39 à
  6 h 38 de retard. La première écriture, le 18/10 à 14:03 UTC, a vidé les **122** fiches
  échues ; les suivantes, 0. Aucun contenu échu n'est plus stocké.
- **L'image** de tous ces runs est encore `ubuntu-24.04`.
- **La production** n'a pas bougé : même plan, même `sweep_run`, aucune ré-ingestion SIRENE.
  3 608 horaires valides, échéance inchangée le 31/10 entre 15:54 et 16:24 UTC. La prévision à
  sec du 1er novembre, 95,9 %, tient donc.

## 8. L'exclusion mutuelle

[D49](../DECISIONS.md#d49--la-purge-rattrape-ce-quune-étape-hors-ligne-réécrit).

**Le risque.** `compute:profiles` et `match:sirene` lisent les fiches, calculent, puis
réécrivent `schedule` et le profil. Si la purge vide une fiche entre la lecture et l'écriture,
l'étape hors ligne remet la grille horaire et le profil d'un horaire échu.

La purge ne la reprend jamais : elle ne vise que les fiches qui portent encore leurs horaires
bruts. Les recalculs, eux, l'ignorent désormais comme « purgée ». Le contenu reste stocké
jusqu'à ce qu'une passe renvoie le lieu.

**La fenêtre.**
- Les passes ont fini vers 14:21 UTC le 01/09 et 16:24 UTC le 01/10.
- Le 01/10, les étapes hors ligne ont tourné de 16:24 à 16:27 UTC ; `compute:profiles` a duré
  2 min 20.
- Les neuf premières purges planifiées, du 18 au 26 octobre, ont démarré **entre 14:02 et
  17:01 UTC** : la même plage horaire.

Rare, mais pas impossible, et le dommage dure.

**La règle.**
1. La purge vise tout ce qui dérive d'un horaire échu, pas seulement les fiches qui portent
   encore leurs horaires bruts. Une fiche réécrite après la purge est donc vidée le lendemain.
2. Les étapes hors ligne n'écrivent une fiche que si ses horaires n'ont pas changé depuis leur
   lecture.

Pas de verrou partagé, ni de groupe de concurrence commun aux workflows : D49 dit pourquoi.

## 9. Lancements manuels, rattrapage, coupure — *brouillon*

> **Brouillon** — les faits sont mesurés ; les choix sont C2, C3 et C6.

**Ce qui existe.**
- `workflow_dispatch` sur `sweep.yml` n'a **aucune entrée** et dépense pour de vrai. Il partage
  le plafond de la passe en cours.
- `workflow_dispatch` sur `purge.yml` **écrit par défaut** : il faut cocher `dry_run` pour le
  rendre sec.
- Un `--go` local est possible depuis tout poste qui détient la clé, et ne laisse aucune trace
  hors de la base (04/09).
- Une passe complète lancée à la main rafraîchit d'un coup tout ce qu'elle sert, et
  **resynchronise les échéances** : c'est l'étalement que D38 a construit qui se défait.

**La coupure du 31/10 au 01/11.**
- Les 3 608 horaires valides expirent tous le 31/10 entre 15:54 et 16:24 UTC.
- La période 2026-11 ouvre le 01/11 à 07:00 UTC, la passe est planifiée à 09:00 avec jusqu'à
  7 h 52 de retard, et ses 450 appels prennent environ 15 minutes.
- La liste par défaut est donc vide de **17 à 25 heures** environ.
- Un lancement manuel à 07:00 UTC la ramènerait à environ 15 heures. La passe planifiée de 09:00
  serait alors refusée (« already spent in this pass »), et ce refus est rouge sous D39.

**Une passe manquée.**
- Le 1er manqué : une relance avant le 16 rattrape dans le plafond de 450.
- Le 16 manqué : la relance n'est sûre qu'avant toute autre dépense de la seconde moitié (§ 4).
  *Annoté le 26/10 : une fois D52 construite, elle l'est jusqu'à la fin du mois Pacifique.*
  Le 1er suivant ne peut pas rattraper au-delà de 450 sans changer la règle.

**Aucun acquittement** n'existe pour une cellule irréductible : D39 en fait un rouge à chaque
passe, « jusqu'à ce qu'on en décide ».

## 10. Le sous-cycle SIRENE — *brouillon*

> **Brouillon** — choix C4.

**Le stock et son rythme.** Le stock est mensuel, publié le 1er. D13 le savait et a choisi un
rythme trimestriel. Il n'a jamais été rejoué depuis le 28/08, et D41 r5 le rend dû.

**Mesuré sur le stock du 1er octobre, lu le 17/10.**

| | Mesure |
|---|---|
| Établissements actifs du filtre (codes d'activité × communes) | 5 995 |
| dont `NN` | 3 265, soit 54,5 % |
| dont `NN` créés après l'année de référence 2024 | **1 129**, soit 35 % des `NN` : ceux que D41 r2 laisse inconnus |
| Lignes de notre table **radiées** depuis | **120**, dont 10 appariées à une fiche |
| Lignes de notre table sorties du filtre | 11 |
| Établissements actifs absents de notre table | 116 |
| Tranches d'effectif changées | 1 259, mise à jour annuelle du 1er octobre |
| Nomenclature d'activité | NAF rév. 2 pour toutes les lignes |

**Ce que le cycle ne fait pas.**
- Un établissement radié n'est **jamais supprimé** : il garde son point dans la contrainte
  robuste et son effectif sur la fiche appariée.
- Une adresse changée n'est **jamais regéocodée** : `ingest:geocode` ne reprend pas une ligne
  déjà placée.
- `imported_at` est réécrit à chaque upsert : il ne dit pas depuis quand une ligne existe.

**Le passage à la NAF 2025**, attendu vers le 5-6 janvier 2027, est absent des specs.
- L'ingestion filtre sur six codes de la NAF rév. 2 (`config.ts:33-39`). Sur un stock recodé, le
  filtre ne ramènerait plus rien.
- Le garde-fou de 3 000 lignes minimum ferait échouer l'ingestion bruyamment : c'est le bon sens
  de l'erreur, mais il faut une table de correspondance avant cette date.

**Ce qu'une ré-ingestion déplace.**
- Les points de la couverture robuste changent : 116 nouveaux, 120 radiés.
- Le calibrage à 450 du plafond du 1er, mesuré sur les points d'aujourd'hui, ne tient plus.
- Toute ré-ingestion se fait donc **suivie d'un géocodage, d'une simulation et, s'il le faut,
  d'un nouveau plafond, avant la passe suivante**.
- Aucune n'est proposée avant la passe du 1er novembre (choix C4).

**La migration commune.** D41, D42 et D45 la partagent ; elle porte les colonnes de date de
création et d'année d'effectif. Le choix d'un rythme d'ingestion se fait avec elle.

## 11. L'évolution côté Google — *brouillon*

> **Brouillon** — choix C7.

| | Mesure, copie du 17/10 |
|---|---|
| Fiches à au moins 10 m à l'intérieur de la portée d'une cellule interrogée le 01/10, et non renvoyées par la passe | **64**, dont 46 `OPERATIONAL` — requête approchée, distance de `lib/grid.ts` |
| Fiches qu'aucun appel du 01/10 n'a renvoyées | 181, dont 154 `OPERATIONAL` |
| `CLOSED_PERMANENTLY` | 0 — le statut est écrasé à chaque passe, sans historique |
| Fiches sans échéance | 923, dont 243 `CLOSED_TEMPORARILY`. La couverture ne vise que les fiches à horaires et les points SIRENE : celles-ci ne sont rachetées que par hasard |
| Doublons probables | 7 paires à 7 m ou moins, avec une similarité de nom d'au moins 0,6 ; 4 à moins de 2 m. Environ 5 crédibles. L'upsert se fait sur `google_place_id` : un identifiant qui change fait un doublon |
| Fantômes au sens de D44 | 505 |

**Ce qui n'est pas construit.** D45 r2-3 : la fiche absente, sans colonne aujourd'hui.

**Ce qui reste ouvert.** Combien de temps garder une fiche absente, et ce qu'elle devient à
l'écran.

## 12. Les hypothèses de coût

**Ce qui est vérifié, et quand.**

| Hypothèse | État au 17/10 |
|---|---|
| Quota gratuit *Nearby Search Enterprise* : 1 000 par mois | doc, D5 |
| Plafond journalier `SearchNearbyRequest` | **1 000**, lu en console le 29/08 ; jamais relu depuis. Les specs écrivent 100 (`08`), 500 (`08`), 800 (`02`, `09`, `11`) et 1 000 (`02`) |
| Alerte budget | 1 $ selon D8, 1 € selon `08` : le propriétaire lit la console |
| Compteur du script | 900 par période ; il **ne garantit plus la dépense réelle** depuis D38 (§ 4). *Le 26/10 : D52 le rétablit, à construire avant le 16/11* |
| Masque de champs | une constante unique ; **aucun test ne la fige** ; le commentaire de `config.ts:78-81` sur `places.rating` est faux (D43) |

**Ce que coûterait une clé qui fuit.**
- Le plafond journalier porte sur la **méthode**, pas sur le palier : il borne une clé volée à
  1 000 appels par jour.
- Cela fait 29 000 à 30 000 appels facturés par mois, à 35 $ le mille : environ **1 015 à
  1 050 $**.
- L'alerte budget ne bloque rien.

**Ce que le compteur ne voit pas.** Google agrège l'usage de tous les projets liés au compte de
facturation. Un compte partagé avec un autre projet entamerait les 1 000 gratuits sans que notre
compteur le sache.

Tout cela se lit en console, et c'est le propriétaire qui la lit (C9).

## 13. Les tests — *brouillon*

> **Brouillon** — choix C10.

Ce qui manque :
- un test d'intégration d'une passe ou du cycle. PGlite sert déjà à `purge` et à `name-match`.
  Deux passes jouées contre une fausse API auraient montré le § 4 ;
- un test qui fige `FIELD_MASK` ;
- un test qui vérifie l'accord entre le cron de `sweep.yml` et `CYCLE.scheduleDays` /
  `scheduleHourUtc` : seul un commentaire les lie ;
- `simulate:passes` ne modélise **aucun** changement de la base — ouvertures, fermetures,
  ré-ingestion SIRENE, portées qui rétrécissent.

## 14. La rétention, conditionnelle à l'axe 0 — *brouillon*

> **Brouillon** — tout ce qui suit tient ou tombe avec la lecture des conditions de Google
> ([`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md), axe 0).

**Ce qui, dans le cycle, dépend de la rétention.**
- L'échéance de 30 jours des horaires.
- La purge de D45 r1, qui **tient quelle que soit la réponse** : elle va dans le sens de la
  conformité.
- L'identité stockée sans échéance : nom, adresse, téléphone, position. Le commentaire de
  `schema.ts:35` la dit « the only Google data we may store durably », ce que l'axe 0 contredit :
  à signaler à la session de code.
- Les profils, peut-être du « contenu dérivé ».
- La carte, qui affiche ce contenu.

**Ce que chaque option ferait au cycle.**

| Option de l'axe 0 | Balayage | Purge | Profils et écran |
|---|---|---|---|
| 1. Vérifier l'adresse de facturation, puis une lecture juridique | inchangé jusqu'à la réponse | D45 r1 tourne | inchangés |
| 2. Interroger le support Google | idem | idem | idem |
| 3. OSM, le plan B de D3 | ne dépense plus rien ; le cycle devient une extraction gratuite. 64 % des lieux OSM portent des horaires, contre 80 % des fiches Google — d'après le comptage du 17/10, sans juger de leur fraîcheur | sans objet pour OSM | recalculés sur une autre source ; l'appariement change |
| 4. Ne garder que l'identifiant et la position, recalculer à chaque passe | inchangé en coût. Chaque passe ne recalcule que ce qu'elle renvoie : le reste de la base n'a plus de profil entre deux passes | s'étend à l'identité | profil sans horaires stockés, si le profil n'est pas du contenu dérivé |
| 5. Statu quo | inchangé | D45 r1 | inchangés |

**Ce qui fuit déjà, quelle que soit la réponse.**
- Le balayage écrit dans son plan, en `--go` comme à sec, le nom et la position de jusqu'à dix
  fiches hors de toute portée.
- Sous Actions, ces lignes vont dans un log gardé 90 jours et lisible par tous, puisque le dépôt
  est public. Le run du 1er novembre sera le premier à le faire.
- Le comptage suffit au rapport. À retirer à l'occasion, sans urgence : dix noms de restaurants
  déjà publics sur la carte de Google, dans un log que personne ne lit. Le propriétaire l'a jugé
  non grave le 26 octobre. C'est une affaire de cohérence avec la règle du dépôt, pas un risque.

**Ce qu'une purge de l'identité coûterait.**
- Par `DELETE`, elle supprimerait les candidatures en cascade (`schema.ts:91`).
- Par `UPDATE`, elle demande une migration : `name`, `lat` et `lng` sont `NOT NULL`.
- Le test d'appartenance de la couverture — une position Places dans le disque d'une cellule —
  est peut-être l'analyse que la ToS §3.2.3(c)(iv) vise. C'est une des quatre questions
  juridiques de l'axe 0, pas une règle à appliquer ici.

---

## Comment on saura que c'est en ordre

Tout se vérifie à sec, sur une copie locale, sans un appel Google.

1. Deux passes du même mois rejouées sur une copie, avec rachats : la dépense imputée à la
   période est égale à la dépense réelle — 900 et non 666. Une relance après le 16 annonce
   0 appel, sans « ledger missing ».
2. Une passe du 16 interrompue se reprend jusqu'au plafond, sans refus.
3. Un mois resté sous 900 ne relâche pas le mois suivant : après lui, un `--go` simulé après le
   16 n'annonce aucun appel.
4. Une passe dont aucun lieu ne revient avec horaires sort `failed` ; une base sans échéance
   prévoit 0 %, pas 100 % (D48).
5. Une fiche vidée par la purge puis réécrite par `compute:profiles` est vidée au passage suivant
   de la purge (D49).
6. Aucune passe finie depuis la date planifiée + 9 h : la vérification quotidienne est rouge
   (D50).
7. `simulate:passes` consigne sa ligne `lowest forecast`, et le plafond du 1er cite la simulation
   qui le fixe.

Les points 1 à 3 sont précisés, avec les chiffres attendus et la façon de les jouer, par les
critères d'acceptation de D52 au § 5.

Et le critère qu'on ne verra qu'en vrai : **le 16 novembre 2026, la passe du 16 dépense, et rien
de ce qui suit dans le mois ne peut dépasser 900 appels réels.**

---

## Annexe — les requêtes

Les mesures en production passent par une transaction ouverte en `read only`.

- **État des cellules** : `select status, count(*) from cell group by status` ; et
  `count(*) where depth = 0 and sirene_count > 12`.
- **Tampons par période** : comptage de `cell.queried_at` entre les bornes Pacifique, par
  exemple `>= '2026-10-01T07:00:00Z'`.
- **Échéances** : `count(*)` sur `restaurant` selon `hours_expires_at > now()`, `<= now()` avec
  `raw_opening_hours is not null`, et `is null` ; `min` et `max` des échéances valides.
- **Fantômes** : `hours_expires_at is null and business_status = 'OPERATIONAL' and phone is null
  and siret is null`.
- **Absentes** : fiches à au moins 10 m à l'intérieur de la portée — disque, ou distance du 20e
  résultat — d'une cellule interrogée à partir du 01/10, dont `last_seen_at` précède le 01/10.
  Distance équirectangulaire de `lib/grid.ts`, 111 100 m par degré.
- **Doublons** : paires à 7 m ou moins, `similarity(name, name) >= 0.6` (`pg_trgm`).
- **Défaut du § 4** : script local qui rejoue `planPass` aux heures de la simulation (graine 1)
  et tamponne une base d'expérience. Puis `sweep:google --dry-run --as-of=…` sur cette base.
- **Douze mois du § 4, 26/10** : script local, en mémoire, sur `dmtj` en lecture seule. Il rejoue
  la boucle de `simulate:passes` — même graine, mêmes heures, mêmes choix de `planPass` — et suit
  le dernier tampon de chaque cellule, les appels réels de chaque période, le plancher que
  `loggedFloor` tirerait d'une ligne `sweep_run` cumulée, et la somme qu'en ferait le journal.
  L'option sans rachat retire de la couverture, à chaque passe, les cellules déjà tamponnées dans
  la période. Il retrouve la pire heure de `simulate:passes`, 91,5 %.
- **SIRENE** : DuckDB sur le permalien de `config.ts`, même filtre que `ingest:sirene`, comparé
  par SIRET à la copie locale.
- **OSM** : Overpass, `amenity` ∈ {restaurant, fast_food, cafe, bar, pub} dans les communes INSEE
  69123 et 69266, en `out count`.
