# Sources de données

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

Trois sources, chacune avec un rôle précis et non substituable.

---

## Google Places — les horaires

**Ce qu'on en tire** : la liste des établissements, leur nom, leur adresse, leurs
coordonnées, leur type, leur statut d'activité et surtout **leurs horaires d'ouverture**.

**Pourquoi elle** : c'est la source la plus fiable, la plus à jour et la plus complète — et
la seule que les restaurateurs eux-mêmes maintiennent, parce que leurs clients la consultent.
Voir [`../DECISIONS.md`](../DECISIONS.md) — D3.

**API utilisée** : `Nearby Search` (New), **jamais** `Place Details`. Cette contrainte est le
verrou économique du projet et fait l'objet d'une spec dédiée :
[`02-budget-google-et-garde-fous.md`](02-budget-google-et-garde-fous.md).

**Champs demandés** — cette liste est une **constante unique et partagée**, jamais construite
dynamiquement :

```
places.id
places.displayName
places.formattedAddress
places.location
places.types
places.businessStatus
places.regularOpeningHours
```

> ⚠️ La facturation s'applique au champ le plus cher demandé. Ajouter `places.rating` ou
> `places.reviews` bascule la requête sur un palier supérieur. Toute modification de cette
> liste doit être une décision consciente, mesurée en console avant et après.

**Contraintes de conservation** : les conditions d'utilisation limitent la mise en cache du
contenu Places à **30 jours**. Seul l'identifiant de lieu (`place_id`) est stockable
indéfiniment. C'est ce qui impose le re-balayage mensuel (D7).

**Structure des horaires** — trois pièges à traiter avant tout le reste :

| Piège | Détail |
|---|---|
| Numérotation des jours | `0` = dimanche, pas lundi |
| Fermeture après minuit | La fermeture porte le jour **suivant** : un service qui finit à 1h30 le samedi soir a un jour de fermeture au dimanche |
| Ouverture continue | Un établissement 24h/24 renvoie une ouverture **sans fermeture associée** |

Les horaires sont exprimées en `{heure, minute}` et non en chaîne de caractères. Certains
établissements n'ont **aucun horaire renseigné** : c'est un cas normal, pas une erreur.

---

## SIRENE — les effectifs

**Ce qu'on en tire** : la liste exhaustive des établissements de restauration en activité,
avec leur SIRET, leur adresse, leur code d'activité et surtout leur **tranche d'effectifs**.

**Pourquoi elle** : les horaires d'ouverture ne disent pas si un salarié subit une coupure —
seule la taille de l'équipe le permet. C'est la seule source ouverte sur ce point. Voir
[`05-inference-des-horaires.md`](05-inference-des-horaires.md).

**Deuxième usage, tout aussi important** : SIRENE sait où sont les restaurants **avant**
qu'on interroge Google. C'est ce qui permet de calculer un maillage de balayage efficace et
de détecter les zones tronquées. Voir
[`03-algorithme-de-balayage.md`](03-algorithme-de-balayage.md).

**Filtres appliqués**
- Codes d'activité : `56.10A` (restauration traditionnelle), `56.10B` (cafétérias),
  `56.10C` (restauration rapide), `56.29A` et `56.29B` (restauration collective),
  `56.30Z` (débits de boissons)
- Établissements actifs uniquement
- Communes de la Métropole de Lyon (EPCI 200046977, 59 communes)

**Limite majeure et assumée** : la tranche d'effectifs vaut très souvent **non renseignée**,
et précisément chez les petites structures — là où l'information est la plus décisive. Le
mécanisme de repli est décrit dans [`05-inference-des-horaires.md`](05-inference-des-horaires.md).
Cette limite doit rester visible dans l'interface, jamais masquée derrière un verdict net.

**Coût** : gratuit, données ouvertes, redistribuables.

---

## Base Adresse Nationale — le géocodage

**Ce qu'on en tire** : les coordonnées des adresses SIRENE, qui n'en contiennent pas.

**Pourquoi elle** : gratuite, sans clé d'API, et elle accepte des envois en masse au format
CSV — quelques milliers d'adresses en une requête. Utiliser le géocodage Google ici serait
payant sans aucun gain.

**Coût** : gratuit.

---

## Ce qui n'est pas utilisé

**OpenStreetMap** — écarté comme source principale (D3) : couverture partielle des horaires
et fraîcheur incertaine. **Conservé explicitement comme plan B** : son format `opening_hours`
est normalisé, bien outillé, et sa licence permet la redistribution. Si les conditions Google
deviennent intenables, c'est là qu'on se replie — d'où l'isolation de la couche source.

**Google Geocoding, Google Place Details, Google Text Search** — payants et sans bénéfice par
rapport aux choix ci-dessus.
