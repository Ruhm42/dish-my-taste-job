# Modèle de données

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

Trois tables. La lecture seule sur les établissements (D10) fait tomber toute la mécanique
multi-sources et sa résolution de priorité qui avait été envisagée ; l'allowlist est portée
par le service d'authentification et n'a pas de table applicative (D14).

---

## `restaurant`

Table centrale. Elle contient à la fois le registre, les horaires brutes et le **profil de
rythme dénormalisé** — c'est-à-dire ce sur quoi porteront toutes les requêtes de filtrage.

### Identité et localisation

| Champ | Rôle |
|---|---|
| `id` | Identifiant interne |
| `google_place_id` | Identifiant Google, **unique**. Seule donnée Google stockable indéfiniment |
| `name` | Nom affiché |
| `formatted_address` | Adresse complète |
| `lat`, `lng` | Coordonnées, en flottants — pas de PostGIS (D12) |
| `insee_code`, `commune` | Commune de la Métropole |
| `arrondissement` | 1 à 9 pour Lyon, nul ailleurs. Alimente le filtre de zone |
| `google_types` | Types Google bruts |
| `business_status` | Actif, fermé temporairement, fermé définitivement |
| `category` | Type d'établissement dérivé : bistrot, brasserie, gastronomique, rapide, collectivité, bar, pizzeria… |

### Rattachement SIRENE

| Champ | Rôle |
|---|---|
| `siret`, `siren` | Nuls si non apparié |
| `naf_code` | Code d'activité |
| `effectif_code` | Tranche d'effectifs SIRENE. **Souvent non renseignée** — voir [`05`](05-inference-des-horaires.md) |
| `match_score` | Score d'appariement, pour audit |

### Horaires

| Champ | Rôle |
|---|---|
| `raw_opening_hours` | Réponse Google d'origine, telle quelle |
| `hours_fetched_at` | Date de récupération |
| `hours_expires_at` | `hours_fetched_at` + 30 jours. Conformité aux conditions Google |
| `schedule` | Fenêtres normalisées, pour l'affichage de la grille hebdomadaire |

**On conserve les horaires brutes à côté du profil calculé.** C'est ce qui permet de
réajuster les règles de déduction et de tout recalculer sans redépenser un appel Google.

### Profil de rythme — les colonnes qu'on filtre

| Champ | Rôle |
|---|---|
| `has_hours` | Faux quand Google n'a rien. Affiché « Horaires inconnus » |
| `open_days_count` | Nombre de jours d'ouverture par semaine |
| `closed_saturday`, `closed_sunday`, `closed_weekend` | Filtre week-end |
| `max_consecutive_days_off` | Calcul **circulaire** : dimanche→lundi compte comme consécutif |
| `split_days_count` | Nombre de jours comportant une coupure d'ouverture |
| `coupure_risk` | `aucun` · `faible` · `moyen` · `eleve` · `inconnu` |
| `fiabilite` | `confirme` · `probable` · `a_verifier` — affichée telle quelle, en mots |
| `service_pattern` | `midi_seul` · `soir_seul` · `coupure` · `continu` · `mixte` |
| `earliest_open_min`, `latest_close_min` | Amplitude, en minutes depuis minuit |
| `weekly_open_minutes` | Sert au repli quand l'effectif est inconnu |
| `profile_computed_at` | Date du dernier calcul |

> **`fiabilite` est une énumération de mots, pas un score numérique.** La spec fonctionnelle
> interdit d'afficher un pourcentage de confiance ; stocker un nombre ne servirait qu'à le
> reconvertir en mots à l'affichage, avec un seuil arbitraire à maintenir des deux côtés.

### Suivi

| Champ | Rôle |
|---|---|
| `first_seen_at` | Première apparition dans un balayage |
| `last_seen_at` | Dernier balayage l'ayant vu. Une absence prolongée suggère une fermeture |

### Convention sur les horaires

Toutes les heures sont exprimées en **minutes depuis minuit du jour d'ouverture**, la
fermeture pouvant dépasser 1440. Un service qui finit à 1h30 se note `1530`, pas `90` au
jour suivant.

Cette convention évite toute gymnastique de dates et rend le calcul des coupures trivial :
un écart entre deux fenêtres est une simple soustraction.

### Index

- `google_place_id` unique
- Index trigramme sur `name` (appariement SIRENE et recherche par nom)
- Index composite sur les colonnes de filtrage les plus courantes : `coupure_risk`,
  `closed_weekend`, `arrondissement`
- Index sur `lat`, `lng` pour la présélection par rectangle englobant lors de l'appariement

---

## `application` — suivi des candidatures

| Champ | Rôle |
|---|---|
| `id` | Identifiant |
| `user_id` | Propriétaire. **Seul endroit où l'utilisateur écrit** |
| `restaurant_id` | Établissement concerné |
| `status` | `a_contacter` · `cv_depose` · `relance` · `rdv` · `retenu` · `refuse` |
| `notes` | Texte libre |
| `created_at`, `updated_at` | `updated_at` alimente le tri par relance à faire |

Unicité sur (`user_id`, `restaurant_id`) : un établissement n'apparaît qu'une fois dans la
liste de quelqu'un.

Isolation stricte par utilisateur, appliquée au niveau de la base et non seulement de
l'application.

---

## L'allowlist n'est pas une table

Elle est portée par le service d'authentification : l'inscription y est désactivée et les
comptes sont créés à la main. Une demande de connexion pour une adresse inconnue est refusée
sans créer de compte.

La liste des utilisateurs **est** l'allowlist. Une table applicative en parallèle serait une
seconde source de vérité à tenir synchronisée, pour aucun gain (D14). Voir
[`08-infrastructure.md`](08-infrastructure.md).

---

## `sweep_run` — traçabilité des balayages

| Champ | Rôle |
|---|---|
| `id`, `started_at`, `finished_at` | Exécution |
| `cells_planned` | Cellules prévues par le `--dry-run` |
| `cells_queried` | Cellules réellement interrogées, subdivisions comprises |
| `calls_made` | **Appels consommés — à comparer au prévisionnel** |
| `truncated_unresolved` | Cellules tronquées non résolues. **Doit valoir zéro** |
| `irreducible_cells` | Cellules ayant atteint la limite de profondeur |
| `places_found` | Établissements remontés |
| `sirene_unmatched` | Établissements SIRENE non appariés — le canari |
| `status`, `error` | Réussite, échec, message |

Cette table est le journal de bord du seul poste coûteux du projet. Sans elle, une dérive de
consommation ou une base incomplète passeraient inaperçues.

---

## Ce qui a été retiré du modèle

Traces des simplifications, pour ne pas les redécouvrir :

- **Table multi-sources d'horaires** — n'avait de sens qu'avec les corrections manuelles (D10)
- **File de validation des appariements** — remplacée par un seuil conservateur : en cas de
  doute, on laisse l'effectif vide
- **Table de fenêtres horaires relationnelle** — jamais interrogée relationnellement, elle ne
  sert qu'à l'affichage de la grille. Un champ structuré sur `restaurant` suffit
- **Types géographiques PostGIS** — deux flottants suffisent à cette échelle (D12)
- **Table d'emails autorisés** — redondante avec la liste des comptes du service
  d'authentification (D14)
