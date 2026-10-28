# Agenda — ce qui se vérifie ou se fait à une date

> **Statut** : acté · **Dernière mise à jour** : 2026-10-28

Le projet vit au rythme de dates qu'on ne choisit pas : deux passes par mois, une échéance de
30 jours sur chaque horaire, un quota qui se renouvelle à minuit Pacifique, des stocks publiés
le 1er, des journaux qui s'effacent. Ce dossier dit, **jour par jour, ce qu'il faut vérifier ou
faire, et d'où ça vient**. Voir [D53](../DECISIONS.md#d53--les-échéances-vivent-dans-un-agenda-un-fichier-par-jour).

L'agenda ne décide rien. Chaque item renvoie à la décision, au choix ou à la spec qui le fonde.
Quand la source change, on la corrige d'abord, puis l'item.

## Un fichier par jour

`AAAA-MM-JJ.md`, et seulement pour les jours qui portent quelque chose. Le jour est celui où
l'item devient vérifiable ou celui où il doit être fait au plus tard. La première ligne est la
date en toutes lettres : `# Dimanche 1er novembre 2026`.

**En tête**, la liste : une case par item, `- [ ] **Verbe**, heure — ce qui est à faire.` Le
verbe est l'un de trois :
- **Vérifier** : lire un résultat et le comparer à ce qui est attendu. En lecture seule.
- **Faire** : une action, avec ce qu'elle touche.
- **Décider** : un choix ouvert qui a une date limite. Il se tranche dans
  [`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md) ou par une décision, pas ici.

**Puis `## Détail`**, une section `###` par item, **dans l'ordre de la liste**. Chacune porte
des champs, en italique en tête de ligne, selon le verbe :

| Verbe | Champs, tous requis |
|---|---|
| Vérifier, Faire | *Quand* — l'heure, et le retard possible · *Comment* — la commande, la requête ou le run à lire · *Attendu* — le chiffre ou l'état, avec sa date de mesure · *Sinon* — ce que ça veut dire, et vers quoi se tourner · *Vient de* |
| Décider | *Quand* — la date limite, et pourquoi · *Quoi* — les options, ou le choix qui les chiffre · *Si rien n'est décidé* — ce qui se passe par défaut · *Vient de* |

*Vient de* porte au moins un lien : la décision (`Dxx`), le choix (`Cx`) ou la section de spec.

**Une fois fait**, la case se coche, `- [x]`, et le détail finit sur une ligne
`- *Fait le AAAA-MM-JJ* :` qui dit ce qui a été observé, chiffres compris. Le fichier reste :
comme le journal des décisions, l'agenda se relit comme une chronologie.

**Un item qui glisse** change de jour. L'ancien jour garde, à la place de la case,
`- [x] **Déplacé** au [AAAA-MM-JJ](AAAA-MM-JJ.md) — ce qui était prévu.`, sans détail : le
détail suit l'item.

**Qui l'alimente.** Une décision, une annotation ou un choix qui crée une échéance ajoute son item
ici, dans le même commit.

**Ce qui le tient.**
- `tests/agenda.test.ts`, dans `npm test` et donc dans la CI, vérifie ce format sur chaque
  fichier : le titre et son jour de semaine, les verbes, un détail par item dans l'ordre, les
  champs, un lien dans *Vient de*, une ligne « Fait le » sur chaque case cochée et sur elles
  seules, un « Déplacé » qui pointe vers son jour, des liens qui mènent quelque part. Un fichier
  mal formé fait échouer la CI.
- La skill `agenda` (`.claude/skills/agenda/`) donne aux sessions la marche à suivre : quand un
  travail crée une échéance, comment l'écrire, la clore ou la déplacer, avec des modèles.

## Les heures

Tout est en **UTC**. Deux décalages reviennent sans cesse :
- **la période du quota** est le mois du Pacifique : elle s'ouvre le 1er à 07:00 UTC en heure
  d'été, 08:00 UTC en heure d'hiver ([D47](../DECISIONS.md#d47--la-période-du-quota-est-le-mois-du-pacifique)).
  La Californie change d'heure le 1er novembre 2026 ;
- **GitHub retarde** les planifications : jusqu'à 7 h 52 mesurées, 8 h retenues
  ([`technique/14`](../technique/14-cycle-d-import-mensuel.md) § 2). Une planification peut aussi
  être abandonnée.

## Ce qui revient

Ces vérifications n'ont pas de fichier à elles. Un jour n'en a un que si une occurrence porte
quelque chose de particulier, et il renvoie alors ici pour le reste.

| Rythme | Heure UTC planifiée | Quoi | Vient de |
|---|---|---|---|
| Chaque jour | 05:17 | le réveil de la base : des lectures par le pooler et par la Data API | [D35](../DECISIONS.md#d35--réveiller-la-base-chaque-jour-par-le-pooler-et-par-lapi-et-découpler-le-commit) |
| Chaque jour | 10:23 | la purge des horaires échus, en écriture | [D45](../DECISIONS.md#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus) r1 |
| Chaque jour | — | l'âge de la dernière passe — **décidé, pas construit** | [D50](../DECISIONS.md#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour) |
| Chaque lundi | 05:47 | le commit du réveil : sans commit pendant 60 jours, GitHub coupe toutes les planifications | [D19](../DECISIONS.md#d19--une-action-hebdomadaire-contre-les-deux-mises-en-veille), [D35](../DECISIONS.md#d35--réveiller-la-base-chaque-jour-par-le-pooler-et-par-lapi-et-découpler-le-commit) |
| Le 1er et le 16 | 09:00 | une passe du cycle : voir ci-dessous | [D38](../DECISIONS.md#d38--deux-passages-par-mois-le-1er-et-le-16) |
| Le 1er | 07:00 ou 08:00 | la période du quota se renouvelle | [D47](../DECISIONS.md#d47--la-période-du-quota-est-le-mois-du-pacifique) |
| Le 1er | — | INSEE publie le stock SIRENE ; aucune ré-ingestion n'est planifiée | [D13](../DECISIONS.md#d13--sirene-par-fichier-stock-parquet-pas-par-api), C4 |
| 30 jours après une passe | l'heure de la passe | ce qu'elle a rafraîchi expire, puis la purge le vide | [D7](../DECISIONS.md#d7--re-balayage-mensuel-complet), [D45](../DECISIONS.md#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus) |

### À chaque passe

En lecture seule, une fois le run de `sweep.yml` fini.

1. **Le run** est vert. Une passe qui s'arrête sur son plafond finit `capped`, en vert ; un rouge
   se lit dans le tableau du § 6 de [`technique/14`](../technique/14-cycle-d-import-mensuel.md)
   ([D39](../DECISIONS.md#d39--ce-qui-fait-échouer-le-cycle)).
2. **Le journal** a reçu une ligne pour la passe, avec la période, la passe, le statut et un
   `calls_made` égal au nombre d'appels que donne le log. Aucune ligne n'est restée `running`
   ([D52](../DECISIONS.md#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel)) :

   ```sql
   begin read only;
   select period, pass, status, calls_made, started_at, finished_at, github_run_id
     from sweep_execution order by started_at desc limit 3;
   select (select calls_made from sweep_run) as plan_total,
          (select sum(calls_made) from sweep_execution
            where run_id = (select id from sweep_run)) as journal_total;
   commit;
   ```

   `plan_total` et `journal_total` sont égaux.
3. **Les étapes hors ligne** ont tourné, même après un échec du balayage : `match:sirene` puis
   `compute:profiles` ([D33](../DECISIONS.md#d33--un-balayage-en-échec-nemporte-plus-les-étapes-hors-ligne)).
4. **La part des lieux renvoyés avec horaires**, que le résumé du balayage imprime : autour de
   80 %. Sous 50 %, Google ne renvoie plus les horaires et on arrête tout `--go`
   ([D48](../DECISIONS.md#d48--une-base-sans-échéance-ne-passe-pas-pour-fraîche) r2, pas encore
   construite : à lire dans le log).
5. **Le lendemain**, la console de facturation ne compte pas plus de `Nearby Search` que le
   journal pour la période ([D52](../DECISIONS.md#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel)).

## Ce qui s'efface

Une preuve qui expire se relève dans le fichier du jour, chiffres compris, avant de disparaître.

| Où | Durée |
|---|---|
| Logs d'exécution GitHub Actions | 90 jours |
| Logs d'exécution et de requêtes Vercel, offre Hobby | environ une heure |
| Horaires Google stockés | 30 jours, puis la purge les vide |
