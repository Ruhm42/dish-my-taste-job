# Journal des décisions

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

Format : *contexte → options écartées → décision → conséquences*. Une décision sans
alternative écartée n'est pas une décision, c'est une note.

---

## D1 — Annuaire de prospection, pas job board

**Contexte.** En restauration, l'essentiel du recrutement se fait par candidature spontanée :
on repère un établissement, on y dépose un CV. Le besoin exprimé est de « lister et chercher
des restaurants », pas de consulter des offres.

**Options écartées**
- *Job board avec filtres horaires* — suppose que des employeurs publient des offres.
  Démarrage à froid rédhibitoire : sans employeurs inscrits, la base est vide et l'outil
  inutile.
- *Annuaire enrichi d'un signal « recrute actuellement »* — séduisant, mais le signal est
  coûteux à obtenir (scraping de sites d'emploi, saisie manuelle) et peu fiable.

**Décision.** On liste **tous** les restaurants d'une zone et on les filtre par profil
d'horaires. L'utilisateur en tire une short-list et va démarcher.

**Conséquences.** Aucune dépendance à un tiers qui devrait alimenter la plateforme. L'outil
est utile dès le premier jour. En contrepartie, il ne dit jamais si un établissement recrute :
c'est à l'utilisateur d'aller voir.

---

## D2 — Périmètre : Métropole de Lyon, en configuration

**Contexte.** Il faut choisir une zone de démarrage. La France entière compte ~175 000
restaurants.

**Options écartées**
- *France entière* — volume ingérable pour un MVP, qualité des horaires très hétérogène,
  impossible à vérifier à la main.
- *Une région* — volume ×10 sans gain de pertinence, la donnée se dégrade en zone rurale.

**Décision.** Métropole de Lyon (EPCI 200046977, 59 communes), soit ~4 000 établissements.
La zone est un **paramètre de configuration**, jamais une valeur en dur.

**Conséquences.** Volume vérifiable à la main. Le changement de ville est une modification de
configuration et une réexécution des scripts, pas une réécriture.

---

## D3 — Google Places comme source de référence des horaires

**Contexte.** Le produit repose entièrement sur la qualité des horaires d'ouverture. Trois
sources possibles : OpenStreetMap, Google Places, saisie manuelle.

**Options écartées**
- *OpenStreetMap seul* — gratuit et redistribuable (ODbL), format `opening_hours` normalisé
  et bien outillé, mais couverture partielle et fraîcheur incertaine.
- *Contribution communautaire* — la donnée la plus juste (les salariés savent), mais suppose
  une communauté qui n'existe pas.

**Décision.** Google Places est la source de référence : c'est la plus fiable, la plus à jour
et la plus complète, et c'est celle que les restaurateurs eux-mêmes tiennent à jour.

**Conséquences.** Dépendance à une API commerciale, avec ses tarifs et ses CGU — d'où D5, D7,
D8 et D11. La couche source doit rester isolée derrière une interface : si les conditions
changent, OSM reste un plan B gratuit.

---

## D4 — SIRENE pour l'effectif

**Contexte.** Les horaires d'ouverture ne disent pas si un salarié subit une coupure (voir
[`technique/05-inference-des-horaires.md`](technique/05-inference-des-horaires.md)). Il faut
connaître la taille de l'équipe.

**Options écartées**
- *Déduire la taille du nombre d'avis Google ou de la gamme de prix* — corrélation faible et
  invérifiable.
- *Ne pas modéliser la taille* — reviendrait à signaler une coupure sur tout établissement
  ouvert midi et soir, soit la majorité. Le filtre perdrait son sens.

**Décision.** La base SIRENE (data.gouv, gratuite et exhaustive) fournit
`trancheEffectifsEtablissement`, seule source ouverte sur la taille des équipes.

**Conséquences.** Il faut apparier Google et SIRENE, ce qui est imparfait. La tranche vaut
souvent `NN` (non renseignée), précisément chez les petites structures où l'information
compte le plus — d'où un mécanisme de repli et une fiabilité affichée.

---

## D5 — `Nearby Search`, jamais `Place Details`

**Contexte.** Le champ `regularOpeningHours` relève du tier **Enterprise** de la Places API,
dont le quota gratuit est de **1 000 appels par mois**.

**Options écartées**
- *`Place Details` par établissement* — l'approche évidente, et le piège : **1 restaurant par
  appel**. Sur 4 000 établissements, le quota gratuit est consommé en une fois, puis c'est
  20 $/1000 à chaque rafraîchissement. Projet payant à vie.
- *`Text Search`* — accepte aussi les horaires et pagine jusqu'à 60 résultats, mais chaque
  page est un appel facturé : aucun gain par appel, et un SKU plus cher.

**Décision.** Utiliser **`Nearby Search` (New)** avec `places.regularOpeningHours` dans le
field mask. Même tier, même quota — mais **jusqu'à 20 établissements par appel**.

**Conséquences.** ~400 appels pour couvrir tout Lyon au lieu de 4 000, soit 40 % du quota
gratuit mensuel. C'est la décision qui rend le projet gratuit ; tout le reste en découle
(D7). En contrepartie, `Nearby Search` plafonne à 20 résultats sans pagination et n'accepte
qu'une restriction circulaire : il faut un maillage adaptatif (D6).

---

## D6 — SIRENE et la BAN pilotent le maillage du balayage

**Contexte.** `Nearby Search` tronque silencieusement au-delà de 20 résultats. Un maillage
naïf laisserait des trous invisibles dans les zones denses — et un restaurant absent ne se
voit pas dans l'interface.

**Options écartées**
- *Grille régulière sur la bounding box* — gaspille des appels sur les 534 km² majoritairement
  vides de la Métropole, et reste aveugle aux troncatures.
- *Quadtree partant d'une seule grande cellule* — converge, mais dépense des appels en
  subdivisions à l'aveugle.

**Décision.** SIRENE (gratuit, exhaustif) géocodé par la BAN (gratuit, sans clé) donne la
position de tous les restaurants **avant** le premier appel Google. Le maillage est calculé à
partir de cette densité connue, en visant ≤ 15 établissements par cellule.

**Conséquences.** Zéro appel gaspillé sur les zones vides. Surtout : on sait combien
d'établissements *devraient* remonter par cellule, ce qui donne un **détecteur de
troncature**. Recoupé avec la distance du 20ᵉ résultat, le balayage devient auto-vérifiant.

---

## D7 — Re-balayage mensuel complet

**Contexte.** Les CGU Google Maps Platform limitent la mise en cache du contenu Places à
**30 jours** (le `place_id` seul est stockable indéfiniment). Or les horaires changent, et la
donnée doit rester fraîche.

**Options écartées**
- *Rafraîchissement par rotation* (un tiers de la base chaque mois) — étale la charge mais
  laisse des données dépasser 30 jours, en écart avec les CGU.
- *Rafraîchissement à la demande* — ne fonctionne pas ici : il faut les horaires de **tous**
  les établissements pour pouvoir filtrer, pas seulement de ceux qu'on consulte.

**Décision.** Un balayage complet le **1er de chaque mois**, qui remplace intégralement les
horaires stockés.

**Conséquences.** ~400 appels sur les 1 000 gratuits : gratuit en régime permanent. La donnée
n'a jamais plus de 30 jours, donc **la conformité aux CGU est obtenue par construction**, pas
par vigilance. Le sweep est calé au 1er du mois pour que le remplacement précède l'expiration.

---

## D8 — Garde-fous de coût avant le premier appel

**Contexte.** Contrainte ferme du projet : **zéro euro**. Une boucle accidentelle dans un
script d'ingestion peut générer une facture en quelques minutes.

**Options écartées**
- *Se fier au calcul théorique et à la relecture du code* — le calcul peut être juste et le
  code buggé.
- *Se fier au crédit d'ouverture de 300 $* — c'est un filet temporaire (90 jours), pas un
  garde-fou.

**Décision.** Trois protections posées **avant** le premier appel, et un principe :
1. **Quota dur** dans la console GCP (`Nearby Search Enterprise requests per day` ≈ 100) :
   un dépassement devient une erreur HTTP, pas une ligne de facture.
2. **Alerte budget à 1 $** sur le compte de facturation.
3. **Clé API restreinte** à la seule Places API, côté serveur uniquement.
4. Tout script consommant du quota expose **`--dry-run`**, qui affiche le nombre d'appels
   qu'il *ferait* sans en émettre un seul.

**Conséquences.** Le « zéro euro » est garanti par la plateforme et non par l'attention du
développeur. Le coût est toujours connu avant d'être engagé, jamais découvert après.

---

## D9 — Carte Google Maps JS

**Contexte.** L'écran principal affiche une carte des résultats.

**Options écartées**
- *MapLibre GL + tuiles Protomaps/MapTiler* — écarté après vérification : le raisonnement
  initial supposait que Google Maps coûterait cher, ce qui est faux. Dynamic Maps relève du
  tier **Essentials**, soit **10 000 chargements gratuits par mois** — très au-dessus des
  besoins d'un outil privé. Et les CGU Places demandent que les données Places soient
  affichées sur une carte Google : MapLibre créait une ambiguïté que Google Maps supprime.

**Décision.** Carte Google Maps JavaScript.

**Conséquences.** Gratuit à cette échelle, et cohérent avec la source de données.
**Précaution impérative** : un « map load » se compte à chaque `new google.maps.Map()`, pas
au pan/zoom. La carte est instanciée **une seule fois** par visite et on ne met à jour que
les marqueurs — sinon chaque changement de filtre consommerait un chargement.

---

## D10 — Lecture seule sur les établissements

**Contexte.** Une fonction de correction manuelle des horaires avait été envisagée : elle
comble les trous de Google et fait progresser la base avec l'usage.

**Options écartées**
- *Corrections partagées entre utilisateurs* — effet cumulatif intéressant, mais impose une
  table multi-sources, une résolution de priorité entre sources, une gestion des conflits et
  un écran d'édition.
- *Corrections privées* — même complexité technique, sans le bénéfice collectif.

**Décision.** Aucune édition, aucune correction. Les données d'établissement sont en
**lecture seule**. L'outil ne fait que chercher, filtrer et afficher.

**Conséquences.** Simplification majeure : plus de table multi-sources, plus de résolution de
priorité, plus d'écran d'édition. Le modèle passe de 8 tables à 4.
**Contrepartie assumée** : un établissement sans horaires chez Google reste « horaires
inconnus » sans recours. On l'affiche tel quel avec un lien vers sa fiche Google — un
établissement masqué ne se voit pas, un établissement marqué « à vérifier » se vérifie en un
clic.

---

## D11 — Allowlist fermée

**Contexte.** L'accès nécessite un compte. Reste à savoir qui peut en créer un.

**Options écartées**
- *Inscription libre* — fait basculer le projet dans le domaine public. Les CGU Google
  interdisent de constituer un annuaire concurrent : l'exposition deviendrait réelle. S'y
  ajouteraient modération, RGPD et gestion des abus.
- *Sur invitation* — permettrait la diffusion dans un réseau professionnel, au prix d'une
  table d'invitations et d'un écran de gestion, pour un besoin qui n'existe pas encore.

**Décision.** Une liste d'emails autorisés, alimentée à la main. Un email absent ne reçoit
pas de lien de connexion.

**Conséquences.** Le plus simple à construire, et l'usage reste strictement privé — ce qui
lève toute ambiguïté vis-à-vis des CGU Google. Ouvrir l'accès plus tard sera une décision
explicite, à réexaminer avec ses conséquences juridiques, pas un glissement.

---

## D12 — Pas de PostGIS

**Contexte.** Le projet manipule des points géographiques : affichage sur carte, filtre par
arrondissement, appariement Google ↔ SIRENE par proximité.

**Options écartées**
- *PostGIS* — le choix par défaut pour du géospatial en Postgres. Mais ici : le filtre par
  zone se fait sur un code arrondissement/commune (pas de géométrie), et l'appariement porte
  sur ~4 000 points, où une présélection par rectangle englobant suivie d'un calcul de
  distance en SQL est parfaitement suffisante.

**Décision.** Deux colonnes `lat`/`lng` en flottants. Extension `pg_trgm` conservée pour la
similarité de noms lors de l'appariement.

**Conséquences.** Une extension de moins, un type de moins, des requêtes lisibles par
quiconque. Si un besoin réellement géométrique apparaît (recherche par polygone, isochrones),
la décision se rouvrira — elle n'est pas coûteuse à revenir.
