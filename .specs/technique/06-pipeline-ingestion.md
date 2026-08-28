# Pipeline d'ingestion

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

Sept scripts en ligne de commande, **idempotents et rejouables**. Une exécution interrompue
se reprend sans dégât et sans double facturation.

---

## Enchaînement

| # | Script | Rôle | Coût |
|---|---|---|---|
| 1 | `ingest:sirene` | Registre des établissements + effectifs | Gratuit |
| 2 | `ingest:geocode` | Coordonnées via la BAN, en masse | Gratuit |
| 3 | `plan:cells` | Maillage adaptatif depuis la densité SIRENE | Gratuit |
| 4 | `sweep:google` | Balayage `Nearby Search` | **~400 appels** |
| 5 | `match:sirene` | Appariement Google ↔ SIRENE | Gratuit |
| 6 | `compute:profiles` | Normalisation des horaires + profils de rythme | Gratuit |
| 7 | `cron:refresh` | Enchaîne 3→6 le 1er du mois | ~400 appels/mois |

**Un seul script coûte de l'argent.** Tous les autres peuvent être relancés autant de fois
que nécessaire, notamment `compute:profiles`, qui permet de réajuster les règles d'inférence
gratuitement.

---

## 1. `ingest:sirene`

Télécharge le **fichier stock des établissements au format Parquet** (~830 Mo, sans compte
ni clé) et le filtre sur place :
- Codes d'activité `56.10A`, `56.10B`, `56.10C`, `56.29A`, `56.29B`, `56.30Z`
- Établissements en activité uniquement
- Communes de la Métropole de Lyon (EPCI 200046977)

Sortie : ~4 000 établissements avec adresse, code d'activité et tranche d'effectifs.

## 2. `ingest:geocode`

Envoie les adresses SIRENE à la Base Adresse Nationale au format CSV, en lots. Gratuit, sans
clé, quelques milliers de lignes par requête.

Les adresses non géocodées sont consignées : elles ne participeront pas au maillage, ce qui
peut créer un angle mort. Un taux d'échec anormal doit être traité avant de continuer.

## 3. `plan:cells`

Calcule le plan de balayage à partir de la densité connue : des cercles dimensionnés pour
contenir **au plus 15 établissements**, posés uniquement là où il y en a.

**`--dry-run` est le mode par défaut de ce script.** Il affiche le nombre de cellules et
donc le nombre d'appels que le balayage consommera. Voir
[`03-algorithme-de-balayage.md`](03-algorithme-de-balayage.md).

> **Point d'arrêt** : si le plan annonce nettement plus de ~600 appels, on retravaille le
> maillage avant de dépenser. On ne lance pas un balayage dont on n'a pas validé le coût.

## 4. `sweep:google`

Le seul script coûteux.

- `Nearby Search` avec `rankPreference: DISTANCE`
- Liste de champs **constante et partagée**, jamais construite dynamiquement
- Subdivision automatique de toute cellule tronquée, jusqu'à convergence
- Consigne tout dans la traçabilité des balayages : cellules prévues, interrogées, appels
  consommés, troncatures non résolues

**Échoue bruyamment** si une cellule tronquée n'a pas pu être résolue. Une base
silencieusement incomplète est pire qu'un script en erreur.

Reprise sur interruption : les cellules déjà traitées ne sont pas rejouées.

## 5. `match:sirene`

Apparie les établissements Google aux enregistrements SIRENE : proximité géographique sous 75
mètres et similarité de nom après normalisation.

En dessous du seuil, l'établissement est conservé **sans effectif** plutôt qu'apparié à tort.

Produit le compte d'établissements SIRENE non appariés — **le canari du balayage**. Une
concentration géographique d'établissements non appariés signale une zone manquée.

## 6. `compute:profiles`

Normalise les horaires brutes puis calcule les profils de rythme, selon
[`05-inference-des-horaires.md`](05-inference-des-horaires.md).

**Aucun appel réseau.** C'est le script qu'on rejoue à volonté pour ajuster les règles.

## 7. `cron:refresh`

Le 1er de chaque mois, via une tâche planifiée : enchaîne `plan:cells`, `sweep:google`,
`match:sirene` et `compute:profiles`, et remplace intégralement les horaires stockées.

Le calage au 1er du mois garantit que le remplacement précède l'expiration des 30 jours. Voir
[`02-budget-google-et-garde-fous.md`](02-budget-google-et-garde-fous.md).

`ingest:sirene` et `ingest:geocode` ne sont pas dans la boucle mensuelle : le registre
d'entreprises évolue lentement. Une réexécution trimestrielle suffit.

---

## Contrôles après exécution

À vérifier avant de considérer un cycle réussi :

- Appels consommés **vs** annoncés par le `--dry-run`
- **Cellules tronquées non résolues = 0**
- Cellules irréductibles inspectées une par une
- Taux d'établissements SIRENE non appariés, et absence de concentration géographique
- Couverture des horaires : combien d'établissements en « horaires inconnus »
- Répartition des risques de coupure et des niveaux de fiabilité
- Console de facturation : consommation Enterprise ≈ 400, **rien sur le palier Atmosphere**

---

## Ordre de construction

Les scripts 1 à 6 n'ont **aucune interface**. Ils se valident entièrement en SQL.

C'est délibéré : inutile de construire une interface au-dessus de données dont la qualité
n'est pas démontrée. L'application web ne commence qu'une fois les profils calculés et
contrôlés.
