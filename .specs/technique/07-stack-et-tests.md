# Stack et vérification

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

---

## Stack

| Domaine | Choix | Raison |
|---|---|---|
| Application | **Next.js 15** (App Router) + TypeScript | Rendu serveur pour la liste filtrée : la requête part de la base, pas du navigateur. Une seule base de code |
| Base | **Postgres** via Supabase (offre gratuite) | 4 000 établissements tiennent très largement dans les 500 Mo. Extension `pg_trgm` pour l'appariement de noms. **Pas de PostGIS** (D12) |
| Accès aux données | **Drizzle** | Orienté SQL, migrations lisibles, cohabite bien avec du SQL écrit à la main |
| Authentification | **Supabase Auth**, lien par email | Pas de mot de passe à gérer. Allowlist en table |
| Carte | **Google Maps JavaScript** | Gratuit à cette échelle et cohérent avec la source (D9) |
| Interface | **Tailwind** + shadcn/ui | Composants sobres, mise en page adaptative sans effort |
| Ingestion | Scripts **TypeScript** exécutés par `tsx` | Même langage que l'application, mêmes types de données |
| Planification | **GitHub Actions**, mensuelle | Suffisant pour une tâche par mois |
| Hébergement | **Vercel** | Intégration directe avec Next.js |

**Deux clés API distinctes** : une pour Places, côté serveur uniquement, restreinte à cette
API ; une pour la carte, côté navigateur, restreinte par domaine référent. Elles ne doivent
jamais être confondues.

---

## Tests unitaires — la priorité absolue

**Toute la valeur du produit repose sur la lecture correcte des horaires Google.** Un jeu
d'exemples réels, avec le profil attendu pour chacun, écrit **avant** le reste.

Cas obligatoires :

| Cas | Ce qu'il vérifie |
|---|---|
| Coupure classique (`12h-14h30 / 19h-22h30`) | Détection de l'écart, seuil de 120 min |
| Service continu (`11h-23h`) | Aucune coupure détectée |
| Midi seulement | Verdict `aucun`, pas `inconnu` |
| **Fermeture après minuit** | La fermeture porte le jour suivant |
| **Ouverture 24h/24** | Ouverture sans fermeture associée |
| **Jour fermé** | Absent de la liste des périodes, pas une plage vide |
| Aucun horaire renseigné | `has_hours` faux, pas une erreur |
| Écart court (`14h30-15h30`) | **Ne compte pas** comme une coupure |
| Fermeture dimanche + lundi | Deux jours consécutifs par parcours **circulaire** |

Les trois cas en gras sont ceux qui cassent silencieusement. Ils passent d'abord.

---

## Contrôles SQL après ingestion

- Nombre d'établissements, taux de géocodage
- **Cellules tronquées non résolues = 0**
- Appels consommés **vs** annoncés par le `--dry-run`
- Couverture des horaires : part d'établissements en « horaires inconnus »
- Établissements SIRENE non appariés — inspecter un échantillon : réellement fermés, ou trou
  de balayage ?
- Répartition des risques de coupure et des niveaux de fiabilité
- Part d'effectifs `NN` : mesure directe de la solidité de l'inférence

---

## Vérification terrain

Quinze restaurants lyonnais connus, profil calculé comparé à la réalité sur Google Maps.
**Cible : au moins 12 sur 15 corrects.**

À refaire après chaque modification des règles d'inférence — c'est le seul garde-fou contre
un ajustement de seuil qui améliore un cas et en casse dix.

---

## Test sémantique de bout en bout

Le plus parlant, et le seul qui teste la chaîne entière.

Lancer le filtre **« sans coupure + fermé le week-end »**. Doivent remonter en tête la
**restauration collective** et les **restaurants du midi des quartiers de bureaux** —
Part-Dieu, Vaise, Gerland.

**Si ce n'est pas le cas, l'inférence est cassée**, quels que soient les résultats des tests
unitaires. Ces établissements sont ceux dont on sait, sans aucun modèle, qu'ils ont ce
profil : s'ils n'apparaissent pas, quelque chose de structurel ne va pas.

Réciproquement, une brasserie touristique du Vieux Lyon qui remonterait dans ce filtre est un
signal d'alarme.

---

## Contrôle de coût

Après chaque balayage, en console de facturation :

- Consommation Nearby Search Enterprise ≈ 400
- **Aucune consommation sur le palier Atmosphere** — le moindre appel y signale un field mask
  élargi par mégarde
- Chargements de carte cohérents avec le nombre de visites, et non avec le nombre de clics
  sur les filtres

---

## Validation utilisateur

La seule qui compte vraiment : la personne concernée lance une recherche avec ses vrais
critères et juge si la liste lui paraît crédible.

À faire **dès que l'écran de recherche fonctionne**, avant d'investir dans le reste. Un
professionnel du secteur repérera en trente secondes une aberration qu'aucun test automatique
ne détecterait.
