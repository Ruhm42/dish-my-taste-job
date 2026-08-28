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
- **Lyon 1er-9e (`69381`-`69389`) + Villeurbanne (`69266`)** — périmètre resserré, voir D16

> ⚠️ **Piège des arrondissements, vérifié sur les données.** SIRENE code les établissements
> lyonnais par **arrondissement** (`69381`-`69389`), jamais par la commune globale `69123` —
> alors que l'API géographique de l'État, elle, ne renvoie que `69123` pour Lyon. Filtrer sur
> la liste de communes telle qu'elle est fournie fait donc disparaître **la totalité de
> Lyon** : 5 639 établissements, soit 55 % du jeu de données, dont toute la Presqu'île, le
> Vieux Lyon et la Part-Dieu. Aucune erreur ne serait remontée, la base serait simplement
> amputée. Marseille et Paris ont le même découpage.

**Volumes mesurés** (extraction du 2026-08-28) : 10 328 établissements actifs en division 56
sur la Métropole, dont **9 100 dans le périmètre d'activités retenu** — soit plus du double
de l'estimation initiale de ~4 000. Après géocodage, **9 321 adresses positionnées de façon
fiable (90,3 %)**, dont 6 129 dans le périmètre resserré.

**Limite majeure et assumée, désormais chiffrée** : la tranche d'effectifs vaut **`NN` dans
65,2 % des cas** — mesuré, et non plus supposé « souvent ». Elle manque précisément chez les
petites structures — là où l'information est la plus décisive. Le
mécanisme de repli est décrit dans [`05-inference-des-horaires.md`](05-inference-des-horaires.md).
Cette limite doit rester visible dans l'interface, jamais masquée derrière un verdict net.

**Accès** : le **fichier stock des établissements** se télécharge directement, **sans compte
ni clé**, en Parquet (~830 Mo) ou en ZIP (~1,1 Go). Le format Parquet est retenu : il se
filtre sur place, sans décompresser plusieurs giga-octets de CSV.

L'API Sirene existe aussi mais suppose un compte, une souscription et un jeton, pour une
limite de 30 requêtes par minute. Le fichier stock évite tout cela (D13).

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
