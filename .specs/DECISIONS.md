# Journal des décisions

> **Statut** : acté · **Dernière mise à jour** : 2026-10-26

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

**Décision.** Métropole de Lyon (EPCI 200046977, 58 communes), soit ~4 000 établissements.
La zone est un **paramètre de configuration**, jamais une valeur en dur.

**Conséquences.** Volume vérifiable à la main. Le changement de ville est une modification de
configuration et une réexécution des scripts, pas une réécriture.

> **Amendée par [D16](#d16--réduire-le-périmètre-au-cœur-dense)** — la mesure a donné
> **9 100 établissements et non ~4 000**, et le périmètre est ramené à Lyon 1er-9e +
> Villeurbanne. Les chiffres ci-dessus sont conservés comme état de la connaissance au moment
> de la décision.

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
(D7). *Chiffre revu à **692 appels** après mesure (D16, D17) — la décision elle-même reste
entière, c'est son volume qui a changé.* En contrepartie, `Nearby Search` plafonne à 20 résultats sans pagination et n'accepte
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

> **Amendée par [D17](#d17--maillage-par-courbe-de-hilbert-avec-plafond-de-rayon)** — le
> critère « ≤ 15 établissements par cellule » s'est révélé insuffisant à la mesure : il faut
> aussi **plafonner le rayon à 200 m**. Le principe du pilotage par SIRENE, lui, est validé.

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

**Conséquences.** 692 appels mesurés sur les 1 000 gratuits : gratuit en régime permanent,
avec 308 d'avance. La donnée n'a jamais plus de 30 jours, donc **la conformité aux CGU est
obtenue par construction**, pas par vigilance. Le sweep est calé au 1er du mois pour que le remplacement précède l'expiration.

> **Deux affirmations de cette entrée sont fausses, relevé le 17 octobre 2026.** Le calage au
> 1er ne fait pas précéder l'expiration sept mois sur douze : un mois de 31 jours s'éteint 17 à
> 30 heures — voir [D38](#d38--deux-passages-par-mois-le-1er-et-le-16). Et les conditions ne
> limitent pas « le contenu Places » à 30 jours : elles n'autorisent ce délai que pour la
> latitude et la longitude — voir [`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), axe 0, ouvert.
>
> **Annoté le 17 octobre 2026.** Le cycle qui met en œuvre cette entrée est consolidé dans
> [`technique/14`](technique/14-cycle-d-import-mensuel.md). Ce qui y dépend de la rétention est
> isolé et rendu conditionnel à l'axe 0.

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

---

## D13 — SIRENE par fichier stock Parquet, pas par API

**Contexte.** Il faut récupérer ~4 000 établissements de la Métropole de Lyon avec leur
tranche d'effectifs. L'INSEE propose deux voies.

**Options écartées**
- *API Sirene* — nécessite un compte sur le portail INSEE, une souscription et un jeton, et
  impose une limite de 30 requêtes par minute. Un compte de plus à créer et à maintenir, pour
  une extraction faite une fois par trimestre.
- *Fichier stock au format ZIP* — téléchargeable sans compte, mais impose de décompresser
  plusieurs giga-octets de CSV pour n'en garder que quelques milliers de lignes.

**Décision.** Le **fichier stock des établissements au format Parquet** (~830 Mo),
téléchargeable directement sans compte ni clé, filtré sur place par code d'activité et
commune.

**Conséquences.** Aucune inscription supplémentaire, aucun jeton à stocker, aucune limite de
débit à gérer. Le format Parquet permet de filtrer sans décompression préalable. En
contrepartie, la donnée est mensuelle et non temps réel — sans importance ici : le registre
des entreprises évolue lentement, une réextraction trimestrielle suffit.

> **Annoté le 17 octobre 2026.** La réextraction n'a jamais été rejouée depuis le 28 août, et
> [D41](#d41--nn-veut-dire--sans-salarié-déclaré--pas--effectif-inconnu-) la rend due.
>
> Le stock du 1er octobre, comparé à la table :
> - 120 lignes radiées depuis, dont 10 appariées à une fiche ;
> - 116 établissements actifs absents ;
> - 1 259 tranches d'effectif changées.
>
> Le registre bouge donc plus que « lentement » ne le laissait entendre. Le passage à la NAF
> 2025, attendu vers janvier 2027, videra le filtre par code d'activité. Le rythme est à rouvrir :
> [`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), C4, et
> [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 10.

---

## D14 — L'allowlist est portée par le service d'authentification

**Contexte.** L'accès est restreint à une liste d'adresses (D11). Le modèle de données
prévoyait initialement une table applicative d'emails autorisés.

**Options écartées**
- *Table applicative d'emails autorisés* — impose de la tenir synchronisée avec la liste
  réelle des comptes. Deux sources de vérité pour la même information, donc une occasion de
  divergence : une adresse retirée de la table mais dont le compte existe encore continuerait
  d'accéder à l'outil.
- *Inscription libre bridée par un contrôle applicatif* — le compte serait créé avant d'être
  rejeté, laissant des comptes fantômes.

**Décision.** L'inscription est **désactivée** au niveau du service d'authentification. Les
comptes sont créés à la main. Une demande de connexion pour une adresse inconnue est refusée
**sans créer de compte**. La liste des utilisateurs *est* l'allowlist.

**Conséquences.** Une table de moins, et surtout une seule source de vérité. Retirer un accès
est une action unique. L'ajout d'un utilisateur devient une opération manuelle dans un
tableau de bord plutôt qu'une insertion en base — ce qui convient à un usage où l'on ajoute
quelqu'un deux fois par an.

---

## D15 — Mettre à zéro le quota des appels qu'on s'interdit

**Contexte.** La décision D5 pose que le projet n'utilise que `Nearby Search`, jamais
`Place Details`, `Text Search`, `Autocomplete` ni les photos. Écrite dans une spec, cette
règle repose sur la discipline de celui qui code — or c'est précisément le genre d'erreur qui
ne se voit qu'à la facture.

**Options écartées**
- *S'en tenir à la règle écrite et au field mask constant* — protège du champ ajouté par
  mégarde, mais pas d'un appel au mauvais point d'entrée.
- *Détecter après coup en console de facturation* — ne protège de rien, constate seulement.

**Décision.** Plafonner à **0** les quotas journaliers de `GetPlaceRequest`,
`SearchTextRequest`, `AutocompletePlacesRequest` et `GetPhotoMediaRequest`. Et fixer
`SearchNearbyRequest` à **800/jour** — assez pour un balayage complet (692 appels d'un seul
tenant, chiffre mesuré depuis), 94 fois sous le défaut de 75 000.

**Conséquences.** D5 cesse d'être une convention : un `Place Details` appelé par erreur
échoue côté Google et ne coûte rien. Vérifié en conditions réelles — `HTTP 429`,
`RESOURCE_EXHAUSTED`.

Contrepartie assumée : si un besoin légitime de `Place Details` apparaît un jour, l'appel
échouera avec un message de quota qui peut dérouter. C'est le prix de la garantie, et
l'erreur pointe elle-même vers sa cause.

> Corrige au passage une erreur de `technique/02` qui annonçait un plafond de ~100/jour :
> un balayage complet aurait échoué.

> **Le 800/jour posé ici a été relevé à 1 000 le 28 août**, et c'est cette valeur qui est
> tabulée et vérifiée dans [`technique/02`](technique/02-budget-google-et-garde-fous.md).
> Motif : le compteur local du script est à 900, donc **au-dessus** de 800 — c'était le
> `HTTP 429` opaque de Google qui se serait déclenché en premier, jamais notre message.
> Le chiffre de cette entrée est conservé tel quel : il dit ce qui a été posé ce jour-là.

---

## D16 — Réduire le périmètre au cœur dense

**Contexte.** D2 posait la Métropole entière (58 communes). La mesure a invalidé les chiffres
qui fondaient cette décision : **9 100 établissements en périmètre et non ~4 000**, et un
balayage sûr demanderait **1 200 à 1 900 appels par mois** contre 1 000 gratuits. La
contrainte « zéro euro » ne tenait plus.

**Options écartées**
- *Accepter ~10 €/mois* — 300 appels au-delà du gratuit. Simple et complet, mais rompt une
  contrainte posée comme ferme.
- *Balayer tous les 2 mois* — rentre dans le gratuit, mais la donnée atteint 60 jours : cela
  sort de la limite de cache de 30 jours des CGU et annule le bénéfice de D7.
- *Restreindre les types Google au seul `restaurant`* — **mesuré** : ne fait passer les
  cellules tronquées que de 6/8 à 5/8. La densité lyonnaise est réelle, pas un artefact du
  choix de types.
- *Exclure restauration rapide et débits de boissons* — aurait divisé le volume par deux,
  mais ce sont précisément les établissements en service continu ou en service du soir, donc
  **structurellement sans coupure** : les meilleures cibles pour l'utilisateur. Les retirer
  aurait vidé le produit de sa valeur.

**Décision.** Périmètre ramené à **Lyon 1er-9e + Villeurbanne** : 6 129 établissements
géocodés sur ~62 km² au lieu de 534.

**Conséquences.** **692 cellules**, soit 308 appels de marge sous le quota gratuit pour
absorber les subdivisions sur troncature. Le « zéro euro » tient. C'est aussi la zone où la
recherche d'emploi a réellement lieu, desservie par les transports. Les autres communes
restent ajoutables plus tard, une par une, selon le quota restant — la zone demeure un
paramètre de configuration (D2).

---

## D17 — Maillage par courbe de Hilbert, avec plafond de rayon

**Contexte.** D6 posait un maillage adaptatif visant « ≤ 15 établissements par cellule ».
Deux mesures ont montré que c'était insuffisant.

**Options écartées**
- *Quadtree* — implémenté puis abandonné : il découpe l'espace uniformément, donc une zone
  dense force ses voisines clairsemées à se subdiviser. **1 316 cellules mesurées** pour un
  minimum théorique de 564, soit 2,3 fois trop.
- *Contrainte sur le seul nombre de points* — **réfutée par le calibrage** : sur 8 appels
  réels, 6 cellules à 15 établissements SIRENE étaient déjà tronquées. Le ratio
  Google/SIRENE vaut **1,16**, alors que la spec supposait implicitement moins de 1.

**Décision.** Découpage le long d'une **courbe de Hilbert** — qui préserve la proximité
géographique tout en permettant un découpage par nombre de points — sous **deux** contraintes :
au plus 15 établissements par cellule **et un rayon plafonné à 200 m**, seuil au-delà duquel
la troncature apparaît dans les mesures.

**Conséquences.** 692 cellules au lieu de 1 316, avec un rayon médian de 134 m. C'est
désormais la contrainte de rayon qui est dominante, pas celle du nombre de points — ce qui
correspond à ce qu'on observe : la densité Google, pas la densité SIRENE, est le facteur
limitant.

> Le calibrage a coûté 16 appels, pris sur le quota gratuit. C'est ce qui a permis de
> remplacer deux hypothèses fausses par des mesures avant d'engager un balayage complet.

---

## D18 — Le balayage écrit en production, on n'embarque pas d'instantané

**Contexte.** Le quota Google est de 1 000 appels gratuits par mois et un balayage en
consomme ~650. La production ne peut donc pas balayer de son côté : il faut balayer **une
fois** et acheminer le résultat. Reste à choisir comment.

**Options écartées**
- *Embarquer un instantané des données dans le dépôt* — séduisant : les établissements sont
  en lecture seule, ~6 000 lignes, moins d'1 Mo compressé. Vercel les servirait
  statiquement, sans base de données, et le filtrage se ferait côté navigateur.
  **Rédhibitoire** : les CGU Google limitent la conservation du contenu Places à 30 jours,
  or l'historique git conserve indéfiniment — et le dépôt est public. Un instantané commité
  aujourd'hui reste lisible dans deux ans. C'est exactement la limite que toute
  l'architecture respecte par construction (D7).
- *Balayer depuis la production, à la demande* — rappellerait Google à chaque consultation
  et consommerait le quota de façon imprévisible.
- *Déposer un instantané sur un stockage objet* — fonctionnerait, mais ajoute un support de
  plus à administrer pour un résultat que la base fait déjà.

**Décision.** Le balayage tourne dans **GitHub Actions** et **écrit directement dans la base
Supabase de production**, dont le contenu est remplacé chaque mois. C'est cette écriture qui
constitue l'« upload » du résultat.

**Conséquences.** Le quota n'est consommé qu'une fois. La production ne rappelle jamais
Google : elle lit une table. La donnée ne dépasse jamais 30 jours puisqu'elle est remplacée
mensuellement. En contrepartie, la clé Places doit vivre dans les secrets du dépôt — ce qui
reste préférable à un balayage manuel qu'on oublie de lancer.

> **Annoté le 17 octobre 2026.** Le contenu n'est plus « remplacé chaque mois » en bloc. Deux
> passes par mois rachètent une couverture ([D36](#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt),
> [D38](#d38--deux-passages-par-mois-le-1er-et-le-16)). Une fiche que plus aucune passe ne renvoie
> reste en base, faute de D45 r2-3. Et la prémisse — « la donnée ne dépasse jamais 30 jours » —
> dépend de l'axe 0. Voir [`technique/14`](technique/14-cycle-d-import-mensuel.md).

---

## D19 — Une action hebdomadaire contre les deux mises en veille

**Contexte.** Les deux offres gratuites utilisées mettent en veille ce qui ne sert pas :
- **Supabase** met un projet en pause après **7 jours** d'inactivité, et une pause prolongée
  finit en suppression du projet ;
- **GitHub** désactive un workflow planifié après **60 jours** sans activité sur le dépôt —
  or une exécution de workflow ne compte pas comme activité, seul un commit compte.

Sur un outil consulté sporadiquement par deux personnes, les deux se déclencheraient. Le
second est le plus vicieux : **le balayage mensuel s'arrêterait de lui-même, sans rien
signaler**, et la base vieillirait en silence.

**Options écartées**
- *Compter sur les visites des utilisateurs* — c'est précisément l'hypothèse que le profil
  d'usage contredit.
- *Deux mécanismes séparés* — une tâche pour réveiller la base, une autre pour l'activité du
  dépôt. Deux choses à maintenir pour un même besoin.
- *Passer à une offre payante* — résout tout, mais rompt la contrainte du projet.

**Décision.** **Une seule action hebdomadaire** qui interroge la base *et* commite un
horodatage. La requête remet à zéro le compteur d'inactivité Supabase, le commit remet à
zéro celui de GitHub.

**Conséquences.** Un seul fichier à maintenir. Le workflow porte en commentaire l'explication
de son double rôle : sans elle, il ressemble à du bruit et la prochaine personne qui le lira
le supprimera — ce qui casserait le balayage soixante jours plus tard, très loin de la cause.

> **Révisée par [D35](#d35).** Le modèle « 7 jours sans activité, une connexion suffit » était
> faux. La base est réveillée chaque jour, par le pooler et par l'API ; le commit reste
> hebdomadaire, dans un job séparé du même fichier.

---

## D20 — Mot de passe plutôt que lien envoyé par email

**Contexte.** D14 posait un accès par **lien magique** : on saisit son adresse, on reçoit un
lien, on clique. Rien à retenir, rien à réinitialiser — c'était le plus adapté à un public
qui n'a pas envie d'apprendre une interface.

**Options écartées**
- *Lien magique* — écarté à la mise en œuvre. Il dépend entièrement de l'envoi d'emails, or
  le service intégré de l'offre gratuite est plafonné à quelques messages par heure. Un
  accès qui échoue parce qu'un quota d'emails est atteint est bien plus pénible qu'un mot
  de passe, et le diagnostic en est opaque pour l'utilisateur.
- *Configurer un service SMTP tiers* — lèverait le plafond, mais ajoute un compte, une
  configuration et un mode de panne supplémentaires pour deux utilisateurs.
- *Mot de passe unique partagé, sans comptes* — le plus simple à écrire, mais supprime toute
  notion d'identité : le suivi de candidatures, qui est personnel par nature, deviendrait
  impossible à cloisonner.

**Décision.** **Email et mot de passe**, comptes créés à la main depuis le tableau de bord
de la base. Aucune réinitialisation en ligne : le mot de passe se définit et se change au
même endroit.

**Conséquences.** Aucune dépendance à l'envoi d'emails, donc aucun plafond à subir. Chaque
utilisateur garde une identité propre, ce dont le suivi de candidatures a besoin. En
contrepartie, il faut transmettre un mot de passe à chaque nouvel arrivant — acceptable
quand on en ajoute deux par an.

---

## D21 — Pas d'écran d'administration des comptes

**Contexte.** Un back-office pour ajouter des utilisateurs avait été demandé.

**Options écartées**
- *Écran d'administration dans l'application* — il faudrait une page protégée, la notion de
  rôle administrateur, un formulaire de création, la gestion des erreurs et la clé de
  service côté serveur. Soit une surface d'attaque et du code à maintenir, pour reproduire
  moins bien quelque chose qui existe déjà.

**Décision.** Le **tableau de bord de l'hébergeur de la base fait office de back-office**.
Ajouter quelqu'un y est une opération de trois clics : adresse, mot de passe, valider.

**Conséquences.** Zéro ligne de code, zéro surface d'attaque supplémentaire, et une
interface mieux faite que la nôtre. En contrepartie, la gestion des comptes se fait hors de
l'application — ce qui convient à un usage où l'on ajoute quelqu'un deux fois par an, et
correspond exactement à ce que D14 avait déjà acté.

> ⚠️ **Ce que cette décision suppose** : l'inscription en ligne doit être **désactivée** côté
> service d'authentification. Tant qu'elle est ouverte, la liste des comptes n'est plus une
> allowlist — n'importe qui peut s'en créer un, puisque la clé publiable est publique par
> conception. C'est un réglage à faire à la main, et c'est la seule chose qui tient
> réellement la porte fermée.

---

## D22 — Le calibrage sur échantillon n'était pas représentatif

**Contexte.** D17 fixait le maillage à partir d'un calibrage sur **8 cellules** : ratio
Google/SIRENE de 1,16, troncature apparaissant vers 265 m de rayon, et une prédiction de
**zéro cellule** atteignant les 20 résultats. Le premier balayage réel a mesuré tout autre
chose.

| | Prédit | Mesuré sur 653 cellules |
|---|---|---|
| Cellules tronquées | 0 | **166 (25 %)** |
| Appels pour couvrir la zone | 653 | **> 1 700**, non terminé à 900 |
| Rayon où la troncature apparaît | ~265 m | **dès 40 m** |

Des cellules renvoient 20 résultats dans un rayon de **40 mètres** : il y a plus de vingt
établissements Google dans quarante mètres, en Presqu'île. Un échantillon de huit cellules
ne pouvait pas voir ça — il a mesuré la densité moyenne, alors que le coût est gouverné par
la densité **extrême**.

**Options écartées**
- *Payer le dépassement* (~25 €) — rompt la contrainte zéro euro pour trois jours d'avance.
- *S'en tenir à la couverture obtenue* — 4 465 établissements, tous quartiers représentés,
  mais sous-comptés précisément là où l'on cherche du travail.
- *Réduire encore le périmètre* — reviendrait à abandonner des arrondissements entiers pour
  un problème qui se résout en attendant trois jours.

**Décision.** Reprendre le balayage au renouvellement du quota mensuel. Les cellules déjà
interrogées ne sont pas rejouées ; seul le reste est payé. `cron:refresh` détecte désormais
un balayage inachevé et **saute la planification** au lieu d'en créer un nouveau.

**Conséquences.** Le garde-fou a fait exactement son travail : arrêt net à 900 appels, sous
le quota gratuit de 1 000, **aucune facturation**. Et le script a signalé l'échec plutôt que
de prétendre avoir réussi — une base incomplète qui se dit complète aurait été le pire des
résultats.

**Leçon, et elle vaut au-delà de ce projet** : un calibrage doit échantillonner les
**extrêmes** de la distribution, pas sa moyenne, quand c'est la queue qui gouverne le coût.
Les 8 cellules avaient été choisies réparties du plus petit au plus grand rayon — ce qui
échantillonnait la taille des cellules, pas la densité Google qu'elles contenaient.

---

## D23 — Jamais de requêtes concurrentes sur une connexion poolée

**Contexte.** La production est tombée : `GET /recherche` échouait après **300 secondes**,
alors que la requête en cause s'exécute en **5,35 ms** (`EXPLAIN ANALYZE`, plan optimal, base
à 9 connexions sur 60). Le message réel, trouvé dans les journaux de l'hébergeur, était
`57014 canceling statement due to statement timeout` : Postgres tuait une requête qui
**attendait**, pas une requête lente.

La page était passée de 2 à 4 requêtes en `Promise.all`, en deux ajouts successifs — un
compteur de données de démonstration, puis un compteur de couverture du balayage. Aucun
n'était coûteux. **C'est leur concurrence qui l'était.**

Le pooling en mode transaction attribue un backend **par transaction**, et le client
serverless ne tient qu'une seule connexion. Des requêtes pipelinées sur cette connexion
peuvent attendre un backend qui n'arrive jamais, jusqu'à expiration.

**Options écartées**
- *Augmenter le nombre de connexions du client* — annule la raison d'être du pooling
  transactionnel en serverless : une instance par requête, chacune avec son pool.
- *Passer au pooling en mode session* — supporte le pipelining, mais garde les connexions
  ouvertes ; l'offre gratuite en compte 60, quelques dizaines d'instances suffiraient à les
  épuiser.
- *Allonger le `statement_timeout`* — traiterait le symptôme et transformerait une page en
  erreur en une page qui met deux minutes.

**Décision.** Les requêtes de la page s'exécutent **séquentiellement**, jamais en
`Promise.all`. Et `connect_timeout` / `idle_timeout` sont posés sur le client : sans eux, une
connexion qui n'aboutit pas attend indéfiniment, ce qui transforme une erreur immédiate en
blocage de 300 secondes.

**Conséquences.** Trois allers-retours au lieu de quatre requêtes concurrentes, pour un coût
négligeable : chacune tient en quelques millisecondes. Vérifié en production sous la
condition qui déclenchait la panne — 15 chargements successifs puis 12 requêtes simultanées,
**tous en HTTP 200**.

**Leçon de méthode.** J'avais validé le déploiement précédent sur **un seul** chargement
réussi. Sur un défaut intermittent, un essai ne prouve rien : c'est la répétition sous
charge qui vérifie, pas la première réponse encourageante.

> Corollaire adopté au passage : la page ne fait plus `SELECT *`. Elle ne lisait jamais
> `raw_opening_hours`, la colonne la plus volumineuse de la table. Le type de ligne est
> restreint aux colonnes réellement affichées, de sorte qu'ajouter un champ au rendu sans
> l'ajouter à la requête **ne compile pas**.

---

## D24 — Catégories par rythme de travail, cuisine en information

**Contexte.** Le filtre « type d'établissement » était inexploitable : **41,6 %** des 4 465
établissements en « autre », et 1,9 % de bistrots — à Lyon. La cause tenait en une ligne :
la déduction réduisait les types Google à un `Set`, **détruisant leur ordre**, alors que
`types[0]` est le type principal et règle à lui seul 94,8 % des cas. Elle testait aussi le
code d'activité « débit de boissons » avant tout le reste, ce qui aurait rangé en `bar` les
**600 établissements à la fois bar et restaurant** — le café-restaurant français ordinaire.

**Options écartées**
- *Une catégorie « cuisine du monde »* — ferait tomber le générique de 46 % à 28 %, mais
  mettrait un japonais gastronomique et un kebab assis dans le même sac.
- *Un filtre cuisine complet* — ajouterait une quatrième dimension à un panneau qui en a
  déjà trois, pour une information qui ne dit rien du rythme.
- *Sortir boulangeries et traiteurs du périmètre* — ce sont des employeurs légitimes du
  secteur, et une boulangerie a même un rythme très recherché : tôt le matin, sans coupure.
- *Garder « gastronomique » et « collectivité » dans le filtre* — 7 et 2 établissements.
  Une puce qui ne renvoie jamais rien est pire qu'une puce absente.

**Décision.** Neuf catégories filtrables, ordonnées par **rythme de travail et non par
cuisine** : restaurant, bistrot/brasserie, restauration rapide, pizzeria, bar, café,
boulangerie/pâtisserie, traiteur/livraison, autre. `brasserie` est fusionnée dans `bistro` —
Google n'a pas ce type et rien dans les données ne les sépare. `canteen` et `fine_dining`
restent dans l'énumération mais sortent du panneau : `canteen` court-circuite l'inférence
de coupure.

**La cuisine devient une information affichée sur la fiche**, jamais un filtre. C'est le bon
axe de fond : un japonais et un bouchon ont le même profil d'horaires ; ce qui les distingue
relève du métier, pas du planning.

**Conséquences, mesurées.** « Autre » passe de **41,6 % à 2,1 %**, et les 94 restants sont
des commerces correctement écartés. 1 397 établissements portent une cuisine. La répartition
des risques de coupure est **strictement inchangée** — 50,1 % / 23,1 % / 22,4 % — ce qui
confirme que seule la catégorisation a bougé.

> **Deux pièges trouvés en vérifiant sur échantillon, pas en relisant le code.**
>
> **61 supermarchés classés en « restauration rapide ».** Le balayage demande le type
> `meal_takeaway`, donc un Carrefour City remonte, et le repli trouvait ce type. Une liste
> de types explicitement non-restauration coupe court. Les hôtels en sont volontairement
> absents : l'hôtel-restaurant est un vrai employeur.
>
> **`other` a deux sens, et un seul doit écraser.** Venant d'un établissement sans aucun
> type, c'est « aucune idée » — il ne doit pas effacer une catégorie déjà connue. Venant
> d'un établissement avec de vrais types, c'est un **verdict** : un supermarché n'est pas un
> lieu de restauration. Sans cette distinction, le garde-fou ci-dessus ne modifiait aucune
> ligne.

**Gratuit au passage** : `places.primaryType` est ajouté au field mask. Ce champ relève du
palier Pro, or `regularOpeningHours` place déjà l'appel en Enterprise et la facturation suit
le champ le plus cher. Le prochain balayage aura donc la classification officielle de Google
au lieu de la déduire de `types[0]`.

---

## D25 — Copie de la production vers le local en une commande

**Décision** : `npm run db:pull` recopie la base de production dans la base locale. Le sens
est unique et vérifié à l'exécution : le script **refuse de démarrer** si `DATABASE_URL` ne
pointe pas sur une adresse de bouclage.

**Pourquoi.** La base locale contenait 37 établissements fictifs et **zéro cellule** de
balayage. Toute la logique qui compte — répartition des catégories, bandeau de progression,
pagination sur 4 465 lignes, filtres de rythme — était donc intestable ailleurs qu'en
production. Vérifier une modification directement en production est précisément ce qui a
causé la panne actée en [D23](#d23).

**Ce qui ne voyage pas.** Seul le schéma `public` est copié. Le schéma `auth` de Supabase —
comptes réels et empreintes de mots de passe — n'est jamais lu. L'authentification locale
continue de s'adresser au vrai projet Supabase, donc se connecter en local fonctionne sans
qu'aucun secret ne soit dupliqué sur le poste.

`application.user_id` est un `uuid` sans clé étrangère vers `auth.users` : ce découplage,
choisi pour d'autres raisons, est ce qui rend cette séparation possible.

**Trois détails qui font échouer une copie naïve.**

- **Le port 6543 est le pooler transactionnel**, qui n'implémente pas assez du protocole
  pour `pg_dump`. Le script bascule sur le port 5432, pooler en mode session, qui lui le
  supporte.
- **`pg_dump` refuse de dialoguer avec un serveur plus récent que lui.** Le poste avait un
  client 15.8 face à une production en 17.6. Le script lit la version du serveur et lance un
  conteneur `postgres:<majeure>-alpine` : rien à installer, et aucune étiquette figée qui
  pourrira au prochain changement de version de Supabase.
- **La version locale doit avoir la même majeure.** `docker-compose.yml` passe de
  `postgres:16-alpine` à `17-alpine` : un dump produit par `pg_dump` 17 contient
  `SET transaction_timeout`, que Postgres 16 rejette.

**Le schéma local est reconstruit, pas rapiécé.** `DROP SCHEMA public CASCADE`, puis
`db:push` depuis `lib/db/schema.ts`. C'est ce qui a révélé le problème : le schéma local
avait dérivé — pas de colonne `cuisine`, énumération `category` encore pourvue de
`brasserie`. Restaurer des données dans un schéma périmé aurait échoué à mi-parcours.

> Cette suppression emporte l'extension `pg_trgm`, installée dans `public`, dont dépend
> `match:sirene` pour `similarity()`. Le script la réinstalle. C'est une régression que la
> copie elle-même introduisait.

**Options écartées.**

- *Copier aussi le schéma `auth`* — dupliquerait des empreintes de mots de passe réelles sur
  un poste de développement, pour un gain nul : l'authentification locale vise déjà le vrai
  projet.
- *Lister les tables à copier à la main* — une table ajoutée plus tard serait omise en
  silence. `--schema=public` exclut `auth` par construction **et** ne peut rien oublier.
- *Copier aussi le schéma depuis la production* — entraînerait les politiques RLS et les
  droits accordés aux rôles Supabase, inexistants en local. `lib/db/schema.ts` est la
  référence du schéma ; la production ne l'est pas.
- *Ne recopier que les données, sans toucher au schéma* — c'est ce qui a échoué en premier.

**Vérification** : le script compare les comptes ligne à ligne entre les deux bases et
échoue si l'un diffère. Un `COPY` incomplet est exactement le genre de panne qui ne se voit
qu'au moment où une requête renvoie trop peu de résultats.

---

## D26 — Liens sortants vers les sites d'offres, par métier et jamais par établissement

**Contexte.** D1 assume que l'outil ne dit jamais si un établissement recrute : « c'est à
l'utilisateur d'aller voir ». Mais aller voir, aujourd'hui, c'est quitter l'outil et retaper
sa recherche ailleurs. Le manque n'est pas une donnée de plus, c'est un **panneau
indicateur**.

Deux points rendent la chose recevable. D1 a écarté le signal « recrute actuellement » pour
son **coût d'obtention et sa fiabilité**, pas par principe — un lien statique n'a ni l'un ni
l'autre défaut. Et le lien sortant est déjà un motif accepté : D10 affiche un établissement
« horaires inconnus » *avec un lien vers sa fiche Google*, parce qu'« un établissement marqué
à vérifier se vérifie en un clic ».

**Options écartées**
- *Un lien de recherche par nom sur chaque fiche* — l'option la plus évidente, et la plus
  mauvaise. Les sites d'offres n'ont pas d'identifiant stable par établissement : ce serait
  une recherche sur « Le Bistrot », cas que le commentaire de `googleMapsUrl` a déjà tranché
  — *pire que pas de lien du tout*. S'y ajoute un faux négatif propre au sujet : une
  recherche vide se lit « il ne recrute pas », ce que l'outil n'a pas le droit de laisser
  entendre.
- *Le signal « recrute » via une API ou du scraping* — rejeté par D1, et incompatible avec
  `technique/00` : l'app en ligne n'appelle aucune API externe.
- *Une page dédiée* — `app/layout.tsx` n'a aucune navigation. En ajouter une pour trois
  liens coûte plus que la fonctionnalité ne rapporte.
- *Suivre le filtre Zone* — inutile : 10 km depuis le centre de Lyon couvrent déjà tout le
  périmètre de D16.

**Décision.** Un bloc **« Trouver des offres »** en bas du panneau de filtres. Huit puces-
liens par métier vers **La Bonne Boîte** — service public, gratuit, conçu pour la candidature
spontanée, et qui classe les entreprises par potentiel d'embauche, soit exactement la
prémisse de D1. Puis deux liens : **Indeed**, pré-filtré sur Lyon, et **L'Hôtellerie
Restauration**, la référence du secteur. L'état vide y renvoie par une ancre, sans dupliquer
le bloc.

Rien de tout cela ne porte sur un établissement. `lib/job-boards.ts` ne prend jamais un
restaurant en argument : la contrainte tient dans les signatures, pas dans la discipline.

**Conséquences.** Aucun coût, aucune colonne, aucune dépendance à un tiers qui devrait
alimenter la plateforme. En contrepartie **les URL tierces peuvent casser en silence** — un
lien mort ne lève rien. C'est le prix assumé de ne pas appeler d'API ; les trois cibles ont
été vérifiées à la main le 2026-08-29 et devront l'être à nouveau si quelqu'un les touche.

Deux limites relevées à la vérification, et inscrites dans le code plutôt que découvertes
deux fois :

> **La Bonne Boîte veut `citycode=69123`** — le code commune global de Lyon, soit l'exact
> inverse de la règle SIRENE, qui code Lyon par arrondissement (`69381`-`69389`) et jamais
> `69123`. Brancher `COMMUNE_CODES` sur cette URL renverrait une page vide sans lever
> d'erreur. Un test verrouille le point.
>
> **L'Hôtellerie Restauration ne se pré-filtre pas.** Sa recherche est un formulaire POST
> portant un jeton anti-CSRF, et le site n'a pas de page d'atterrissage par région : aucune
> chaîne de requête ne reproduit une recherche filtrée. On lie la racine de la rubrique et le
> lecteur choisit sa région.

Enfin, les **codes ROME ne se devinent pas** : un code faux renvoie silencieusement le mauvais
métier. Les huit ont été relus dans l'autocomplétion de La Bonne Boîte. « Cuisinier » simple
manque à l'appel — `G1606` et `G1607` sont les métiers *de collectivité*, un piège assez
proche pour être documenté.

**Sur les CGU Google.** Afficher des données Places à côté de liens vers des sites d'emploi
rapproche visuellement l'outil d'un agrégateur. La ligne rouge de `technique/09` reste
pourtant à distance : l'accès demeure fermé derrière l'allowlist (D11), et ce sont des liens
sortants vers des recherches, pas de la donnée tierce republiée.

---

## D27 — La carte porte toute la recherche, la liste la découpe

**Contexte.** La pagination à 50 lignes avait été introduite pour remplacer un plafond
silencieux de 200 résultats. Elle a produit un effet de bord que personne n'a vu : la carte
recevait les lignes **chargées**, pas les lignes **trouvées**. Mesuré sur la recherche que la
vision désigne comme l'essentiel — sans coupure et week-end libre, 329 établissements — la
carte en affichait 50, pris par ordre alphabétique, donc répartis au hasard dans la ville.

La promesse de la spec, « un quartier entier peut se juger en un regard », ne tenait plus, et
rien ne le disait à l'écran. S'y ajoutait un défaut de disposition : la carte était placée
au-dessus de la liste, donc descendre dans les résultats la faisait disparaître.

**Options écartées**
- *Afficher toute la base en permanence, les filtres ne pilotant que la liste* — la carte
  deviendrait une surface d'exploration de la ville, mais filtrer « sans coupure » ne
  changerait plus rien à ce qu'on y voit. Le critère n°1 sortirait de l'endroit où il se lit
  le mieux.
- *Afficher toute la base, résultats filtrés en évidence et le reste estompé* — lecture
  littérale de la demande, mais 4 465 points pour 329 utiles, et des regroupements dont le
  nombre mélangerait deux populations. Plus chargé, pour une information dont on ne fait rien.
- *Rechercher à mesure qu'on déplace la carte* — le résultat dépendrait d'un cadrage qui ne se
  met pas en favori et ne s'envoie à personne, alors que les filtres vivent dans l'adresse de
  la page pour exactement l'inverse.
- *Plafonner la carte à quelques centaines de points* — c'est le défaut qu'on corrige, pas une
  option : un sous-ensemble muet.
- *Garder la carte au-dessus de la liste en la rendant collante* — tient sur grand écran,
  impose de traverser la carte à chaque recherche sur petit écran, là où la place manque le
  plus.

**Décision.** La carte affiche **tous** les établissements qui passent les filtres, sans
plafond ni échantillon. La liste reste paginée. Ce qui est dissocié, c'est le **rythme de
chargement**, jamais le contenu : les deux surfaces rendent le même ensemble.

Sur grand écran, la liste défile et la carte reste en vue ; sur petit écran, ce sont deux vues
alternatives. Le détail s'ouvre dans le panneau latéral — y compris depuis un point de la
carte — et ne se déplie plus entre deux lignes de la liste. Les points se regroupent quand ils
se chevauchent, et un regroupement porte **un nombre, jamais une couleur moyenne** : la
couleur est un verdict sur la coupure, une moyenne de verdicts n'en est pas un.

Cela ouvre une spec dédiée, [`fonctionnel/04-carte.md`](fonctionnel/04-carte.md).

**Conséquences.** Le coût Google est inchangé : les marqueurs ne sont pas facturés, seule
l'instanciation de la carte l'est, et elle reste unique par visite. Le surcoût est une lecture
en base non paginée de trois informations par établissement — à surveiller si le périmètre
s'étend, pas aux 4 465 actuels.

Le clic sur un point ne peut plus exiger que la ligne correspondante soit chargée : il ouvre
le détail directement, faute de quoi la plupart des points seraient inertes. C'est la
contrepartie assumée de la dissociation.

Enfin, « juger un quartier d'un regard » passe désormais par le filtre et non par une couleur
agrégée : on filtre, et la densité des points restants **est** la réponse. C'est plus honnête,
et c'est ce que la carte exhaustive rend enfin possible — auparavant, filtrer ne changeait que
cinquante points.

---

## D28 — Le plafond d'appels porte sur la période du quota, pas sur le balayage

**Contexte.** Le plafond de 900 appels est compté **par balayage** : le compteur est repris
depuis le total du run, et le refus se prononce sur ce cumul. Le run en cours affiche
exactement 900 appels, statut `failed`, avec 601 cellules jamais interrogées.

Au 1er septembre, le cycle mensuel détectera l'inachèvement, sautera la planification comme
D22 le prévoit, relancera le balayage sur ce même run — et **le premier appel sera refusé**,
puisque 900 + 0 atteint déjà le plafond. Le job échouera en ayant dépensé zéro. Le mois
suivant fera de même, indéfiniment : le compteur ne peut plus baisser, et seul un appel
dépensé le ferait monter.

Les deux règles en cause sont chacune défendable. Le plafond par balayage empêche dix
reprises de dépenser dix fois le plafond. D22 reprend au renouvellement du quota pour ne pas
repayer les cellules déjà acquises. Elles sont mutuellement bloquantes parce que **le
compteur ne connaît pas les mois, alors que le quota qu'il protège est mensuel**.

**Options écartées**
- *Un plafond par exécution* — c'est ce que le code écarte explicitement, et à raison : trois
  relances manuelles dans la même journée dépasseraient le quota.
- *Remettre le compteur du balayage à zéro à chaque mois* — plus simple, mais efface
  l'historique de coût du run, qui est exactement ce qui a permis d'écrire D22.
- *Relever le plafond à 1 500* — ferait tenir la convergence en une fois, à 500 appels
  au-dessus du quota gratuit. Le garde-fou cesserait de garantir l'absence de facturation,
  qui est sa seule raison d'être.
- *Replanifier au lieu de reprendre* — déjà écarté en D22 : les cellules déjà payées seraient
  rejouées et le balayage n'atteindrait jamais la fin.

**Décision.** Le refus se prononce sur les appels dépensés dans **la période du quota** — le
mois calendaire — et non sur ceux du balayage. Le total par balayage reste enregistré, pour le
rapport et pour la comparaison d'un cycle à l'autre ; il ne pilote plus le refus.

**Conséquences.** La reprise du 1er septembre dépense enfin. Et la garantie devient plus
forte qu'avant, pas plus faible : elle porte désormais sur la période que Google facture
réellement, au lieu d'un compteur dont l'horizon ne correspondait à rien.

Le plafond **journalier** devient alors la contrainte dominante d'une exécution. D15 a posé
`SearchNearbyRequest` à 800 par jour, soit **moins** que notre propre compteur : une exécution
ne peut pas dépenser 900 appels, et atteindre le plafond mensuel demande deux exécutions sur
deux jours UTC différents. Le premier balayage l'a masqué par accident — lancé à 23h55 UTC, il
a réparti ses 900 appels en 248 le 28 août et 652 le 29, sans jamais approcher la limite
journalière.

> ~~Corrige au passage une erreur de `CLAUDE.md` : « compteur du script (900) < plafond
> journalier Google (1000) = quota mensuel gratuit » confond le plafond **journalier** (800)
> et le quota **mensuel** (1 000). L'ordre des garde-fous annoncé était donc faux, et il était
> inversé : notre compteur était au-dessus de la limite journalière, pas en dessous.~~
>
> **Ce paragraphe est faux, et c'est la ligne de `CLAUDE.md` qui avait raison.** Il lit le
> 800/jour de D15, valeur relevée à **1 000** le 28 août et tabulée comme telle dans
> [`technique/02`](technique/02-budget-google-et-garde-fous.md) — *« posés et vérifiés »* —,
> puis confirmée en lecture directe du quota le 29 août. L'ordre `900 < 1 000` tient donc,
> notre compteur parle bien avant celui de Google, et il n'y avait pas de `HTTP 429`
> imminent. Le reste de la décision — indexer le refus sur la période du quota — n'en
> dépend pas : il tient sur le mois, pas sur la journée.
>
> Corollaire : **aucun plafond journalier local n'est ajouté.** Sous 900 il n'ajouterait
> aucune garantie que le mois ne donne déjà, et il amputerait ce qu'un cycle mensuel peut
> dépenser d'un coup.

Le détail de la reprise, de la fraîcheur des horaires et des critères d'acceptation vit dans
[`technique/10-reprise-du-balayage.md`](technique/10-reprise-du-balayage.md).

**Ce que cette décision ne résout pas.** Le balayage ne convergera toujours pas dans une seule
période : il reste de l'ordre de 1 200 appels à dépenser pour 1 000 gratuits par mois. La
question du périmètre, du dépassement assumé et du sort des horaires périmés au-delà de 30
jours reste entière — et c'est un seul arbitrage, pas trois. Il ouvrira sa propre entrée.

> **Annoté le 17 octobre 2026.** Deux compléments.
>
> « Le mois calendaire » est celui du **Pacifique**. Le choix a été fait et construit le 29 août,
> sans entrée à ce journal : c'est
> [D47](#d47--la-période-du-quota-est-le-mois-du-pacifique).
>
> Et depuis [D38](#d38--deux-passages-par-mois-le-1er-et-le-16), le refus ne se prononce plus sur
> la dépense réelle. La passe du 16 rachète des cellules que celle du 1er a déjà achetées dans la
> même période, et chaque cellule ne garde qu'un tampon. Mesuré sur une copie : 234 rachats en
> novembre.
>
> Après le 16, tout lancement est refusé, reprise comprise. Une période restée sous 900 relâche
> pour toujours le plancher tiré de `sweep_run`, et un `--go` manuel peut alors dépasser 1 000
> appels réels.
>
> L'invariant à rétablir est au propriétaire : [`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), C1,
> et [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 4.

> **Annoté le 26 octobre 2026.** Tranché par
> [D52](#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel) : la dépense de
> la période se lit dans un journal des exécutions, tenu appel par appel. Le refus continue de se
> prononcer sur la période, comme ici ; il change de source. Jusqu'à sa construction, ce qui
> précède reste vrai.

---

## D29 — Fermés jamais listés, horaires inconnus écartés par défaut

**Contexte.** Deux constats mesurés en production, et le premier est un défaut de justesse.

`computeProfile` déduisait les jours de fermeture des jours d'ouverture. C'est juste — sauf
quand il n'y a **aucun** horaire : l'établissement ressortait alors fermé les sept jours,
donc « week-end libre » **et** « 2 jours de repos d'affilée » tous deux vrais. Une absence
de donnée répondait à une question sur le rythme.

| Filtre | Annonçait | Fondé | Bruit |
|---|---|---|---|
| Samedi et dimanche libres | 1 480 | 481 | **67 %** |
| 2 jours de repos d'affilée | 2 044 | 1 045 | **49 %** |

Le second constat porte sur ce que « horaires inconnus » recouvre réellement. Sur 999
fiches : **349 sont déclarées fermées par Google** (`CLOSED_TEMPORARILY`, et toutes sans
horaires), 650 sont ouvertes sans horaires publiés. Ces 650 sont les fiches les plus maigres
de la base — **8 % appariées à SIRENE contre 41 %** pour celles qui ont des horaires, **un
téléphone sur cinq contre neuf sur dix**.

**Options écartées**
- *Ajouter la présence d'horaires aux conditions des filtres de rythme* — corrige le
  symptôme et laisse les colonnes mentir. Le prochain filtre construit sur les jours de
  fermeture retomberait dans le même piège, sans rien pour l'en avertir.
- *Tout laisser visible, comme la spec le prévoyait* — la règle « on ne masque pas ce qu'on
  ignore » est juste, mais elle a été écrite sans savoir qu'un tiers de ces fiches sont des
  établissements que Google déclare fermés. Un restaurant fermé n'est pas une information
  manquante, c'en est une.
- *Supprimer ces établissements de la base* — la lecture seule l'interdit (D10), et une
  fiche écartée aujourd'hui peut rouvrir au balayage suivant.
- *Écarter les fermés sans le dire* — un compteur qui baisse sans explication est exactement
  le sous-ensemble muet que le projet refuse partout ailleurs.
- *Les reléguer en fin de liste au lieu de les écarter* — le tri est contraint par la
  pagination par curseur, qui porte sur le nom ; un curseur composite serait un chantier
  pour un bénéfice moindre.

**Décision.** Trois règles.

1. **Sans horaires, le profil n'affirme rien** sur les jours de fermeture : aucun jour fermé,
   aucun jour de repos d'affilée. C'est la correction de fond, et elle se fait à la source
   plutôt que dans les filtres.
2. **Un établissement que Google ne donne pas pour `OPERATIONAL` n'est jamais listé**, et
   l'écran dit combien ont été écartés.
3. **Les établissements sans horaires publiés sont écartés par défaut** et reviennent en un
   clic — depuis la ligne sous le compteur ou depuis le panneau de filtres. L'état vit dans
   l'URL (`inconnus=1`), donc une recherche qui les inclut se met en favori et s'envoie comme
   n'importe quelle autre.

**Conséquences, mesurées.** La vue sans filtre passe de 4 465 à **3 466**. « Week-end libre »
tombe de 1 480 à **481**, « 2 jours d'affilée » de 2 044 à **1 045**, et tout ce qui reste
s'appuie sur des horaires réels. La recherche emblématique — sans coupure et week-end libre —
reste à **329** : elle filtrait déjà sur le risque de coupure, qui excluait les inconnus.

La règle de `fonctionnel/02` devient : **on n'affiche pas par défaut ce dont on ne peut rien
dire, et on dit qu'on ne l'affiche pas.** Ce qui reste interdit, c'est de retirer quelque
chose en silence.

> Le correctif de profil se rejoue avec `compute:profiles` — hors ligne, sans un seul appel
> Google. La production le demandera au prochain déploiement, sinon ses colonnes garderont
> les jours de fermeture inventés.

---

## D30 — Rafraîchir avant de découvrir, et replanifier au lieu de subdiviser

**Contexte.** D28 a réparé le compteur d'appels ; il annonçait lui-même ce qu'il ne résolvait
pas — il resterait de l'ordre de 1 200 appels à dépenser pour 1 000 gratuits par mois, et les
horaires du premier balayage périmeraient pendant qu'on paierait le second.

La mesure a déplacé le problème. Sur les 212 cellules tronquées et leurs 848 filles : la
subdivision en quatre pose des cercles de **0,72 fois** le rayon de leur mère, qui totalisent
**4,18 fois** ses établissements SIRENE et en comptent **15,3 chacune contre 17,3 pour la
mère**. **Quatre appels pour retirer 12 % de la densité** — et une fille à 15,3 retombe dans
la tranche qui tronque à 55 %.

La troncature, elle, est entièrement prévisible avant de dépenser : 1 % sous 5 SIRENE, 6 % de
5 à 9, 16 % de 10 à 14, **55 % de 15 à 19**, 96 % au-delà de 30. Et 269 des 601 cellules en
attente — 45 % — sont dans la zone haute.

Enfin la constante qui dimensionne les cellules, `GOOGLE_TO_SIRENE_RATIO`, vaut 1,16 quand le
ratio mesuré sur les cellules non tronquées est de 0,91 en moyenne, 0,86 en médiane, mais
**1,57 au 9ᵉ décile**. Une cellule tronque par ce qu'elle a d'extrême, jamais par sa moyenne.

**Options écartées**
- *Continuer à subdiviser en quatre, en payant le coût.* Mesuré : quatre appels pour 12 % de
  densité. Résorber une cellule mère à 30 SIRENE par cette voie demande quatre niveaux, soit
  256 appels — un quart du quota mensuel pour une seule cellule.
- *Réduire le périmètre d'abord.* Ce serait couper la ville pour financer un gaspillage connu.
  L'ordre inverse ne coûte rien et peut rendre l'arbitrage sans objet.
- *Agrandir les cellules pour ramasser plus par appel.* Réfuté par D22 : la troncature
  apparaît vers 265 m, le rayon est plafonné à 200 m. C'est la densité Google qui borne.
- *Purger les horaires au 28 septembre.* Strictement conforme, mais éteint 3 466 fiches d'un
  coup. Le produit s'arrêterait au lieu de vieillir.
- *Laisser vieillir au-delà de 30 jours en le sachant.* Sort des CGU, et fait exactement ce
  que le projet nomme comme sa pire défaillance : une base qui se dit fraîche et ne l'est pas.
- *Relever le plafond d'appels.* Le garde-fou n'a qu'une raison d'être, garantir l'absence de
  facturation. Le relever, c'est le supprimer en le gardant.

**Décision.** Quatre règles, qui tiennent ensemble.

1. **La fraîcheur prime sur la complétude.** Chaque cycle mensuel sert d'abord les cellules
   dont le contenu expire, de la plus ancienne à la plus récente ; le solde du quota va à la
   découverte. Une cellule `done` dont le contenu a expiré redevient éligible — ce qui change
   la règle de reprise, et c'est ce qui rend D7 vrai pour un balayage qui déborde.
2. **Une troncature se résout par une replanification locale.** L'emprise de la cellule
   tronquée est replanifiée depuis la densité SIRENE qu'elle contient. Une cellule de 30
   SIRENE devient trois cellules de 10, jamais quatre cellules de 26.
3. **Le plafond de densité se calibre sur le 9ᵉ décile du ratio, pas sur sa moyenne** : au
   plus 12 établissements SIRENE par cellule.
4. **Le coût de la convergence est le nombre de cellules du plan à sec, et il décide.** Sous
   900 appels, il n'y a rien à arbitrer ; de 900 à 1 500, le périmètre se réduit au rendement
   mesuré ; au-delà de 1 500, la contrainte « zéro euro » se rouvre explicitement, avec son
   prix — 35 $ par tranche de 1 000 — et sa propre entrée.

Ce qui a expiré ne s'affiche plus : la fiche reste, sans horaires, en *À vérifier*, et le
nombre de fiches dans cet état est dit dans le bandeau.

**Conséquences.** Il n'y a plus deux budgets — rafraîchir, découvrir — mais **un seul plan
parcouru dans l'ordre d'expiration**. `done` signifie désormais « faite dans cette période » :
la règle de D22, ne pas rejouer, reste vraie à l'intérieur d'une période et cesse de l'être
d'une période à l'autre, puisque tout expire à 30 jours.

Un chiffre confortable disparaît au passage : rafraîchir ne coûte pas 688 appels, le compte des
cellules abouties. Les 212 cellules tronquées ont produit du contenu stocké elles aussi — 4 240
lieux renvoyés contre 5 130 — et il expire aux mêmes dates. Le contenu en base vient des **900**
cellules interrogées. Sous le plan actuel, le rafraîchir consomme donc tout le quota mensuel
sans rien laisser à la découverte : c'est ce qui rend les règles 2 et 3 nécessaires plutôt
qu'élégantes.

En sens inverse, le plan actuel porte **8,8 SIRENE par cellule** au premier niveau contre un
plafond de 12, et 230 de ses cellules ne ramènent que 2,3 lieux chacune. Un plan recalibré peut
couvrir le même terrain en **moins** de cellules que les 900 déjà dépensées. C'est ce que la
règle 4 fait mesurer avant d'ouvrir la question du périmètre.

La réduction du périmètre, si elle devient nécessaire, se fera au **rendement mesuré** et non
à la géographie : les 1er et 5e arrondissements pèsent 953 établissements SIRENE pour 20
résultats « sans coupure et week-end libre », quand Villeurbanne en pèse 816 pour 40. Ça ne
rend pas la coupe indolore — un arrondissement retiré est un arrondissement vide pour qui y
habite, et la vision promet « la liste de son arrondissement ».

Le détail vit dans [`technique/11-convergence-du-balayage.md`](technique/11-convergence-du-balayage.md).

> **Amendée le 17 octobre 2026.** La mise en œuvre de la règle 1 — l'ordre lu dans le
> `queried_at` de chaque cellule — est remplacée par une couverture du contenu périmé
> ([D36](#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt)),
> et l'affirmation que rafraîchir « consomme tout le quota » est réfutée : 528 cellules
> suffisent, ~708 en robuste. La règle 4 lit désormais le coût de la couverture, pas le plan à sec
> ([D37](#d37--la-prévision-compte-larbre-entier-et-le-périmètre-devient-un-budget-de-découverte)).

---

## D31 — L'appariement se fonde sur l'adresse, et le repli cesse d'inventer un discriminant

**Contexte.** 843 verdicts sur 4 465 reposent sur la règle de repli, faute d'effectif. On a
cherché à l'enrichir avec ce qui est déjà en base et gratuit — durée de la coupure, nombre de
jours concernés, catégorie, amplitude hebdomadaire. La question se teste : il existe **387
établissements dont les horaires portent une coupure et dont l'effectif est connu**.

Aucun de ces signaux ne s'écarte du taux de base de 61 % de petites équipes. L'amplitude, seul
discriminant que le repli contient aujourd'hui, donne **39 % de brigades doubles sous 70 h et
38 % au-dessus** : le seuil en vigueur ne sépare rien, et il adoucit 45 verdicts sans
fondement. La durée de coupure s'inverse au dernier palier ; la catégorie tient dans dix
points d'écart ; le nombre de jours ne ressort qu'à sept sur sept, sur 34 établissements.

En revanche, **1 506 tranches d'effectif dorment dans notre propre base**. L'appariement exige
une similarité de nom ≥ 0,45 comme critère éliminatoire, or **717 de ces enregistrements n'ont
aucun nom** — ils sont exclus par construction, à n'importe quel seuil — et les autres portent
la raison sociale, pas l'enseigne. Le discriminant que SIRENE fournit vraiment est l'adresse :
validé contre les 1 585 appariements existants, « un seul candidat au même numéro de rue »
désigne le bon **713 fois sur 735, soit 97 %**.

**Options écartées**
- *Enrichir le repli avec la durée, les jours et la catégorie.* C'était la piste recommandée ;
  le jeu de validation la réfute. Une règle plus fine qui ne prédit pas mieux n'est pas une
  amélioration, c'est une complication qu'on ne saura plus retirer.
- *Abaisser le seuil de similarité de nom.* Ne touche pas les 717 enregistrements sans nom et
  dégrade la précision là où le nom existe. Le seuil n'est pas le problème, le caractère
  éliminatoire du critère l'est.
- *Redéfinir « coupure peu probable » pour englober les équipes moyennes.* Peuplerait l'option
  — 2 388 fiches — en appelant « peu probable » ce que la règle appelle « possible ».
- *Assumer le plafond d'effectifs et le dire, sans rien changer.* Reposait sur un chiffre faux :
  le plafond n'est pas 41 % mais **56 %** — 2 480 tranches exploitables pour 4 465
  établissements — et on est à 22 %.
- *Chercher l'effectif ailleurs qu'à SIRENE.* Aucune source gratuite et exhaustive (D4).

**Décision.** Trois règles.

1. **L'appariement se fonde sur l'adresse ; le nom départage et n'exclut jamais.** Même numéro
   de rue et proximité comme critère principal, similarité de nom pour classer plusieurs
   candidats au même numéro. Plusieurs candidats indiscernables, c'est un établissement laissé
   sans effectif : mieux vaut une information manquante qu'une information fausse. La précision
   se mesure sur les appariements existants **avant** d'appliquer, et ne descend pas sous 95 %.
2. **La règle de repli par amplitude est supprimée.** Effectif inconnu et coupure aux horaires
   donnent *Coupure probable*, fiabilité *probable*. Sans seuil et sans mention d'amplitude.
3. **Le filtre de coupure devient binaire** — *Sans coupure* ou *Peu importe*. L'option « Oui
   ou probablement » ajoutait huit lignes à « Oui » : trois choix pour deux résultats.

**Conséquences.** Environ **305 verdicts de repli** gagnent un effectif et passent en
*confirmé*, avec la tranche nommée dans l'explication. Les 45 fiches adoucies par l'amplitude
repassent en *Coupure probable* : **le produit devient moins rassurant sur 45 fiches, et plus
juste sur les 45.** C'est le bon sens de l'erreur — un verdict faussement rassurant coûte une
demi-journée à quelqu'un qui se déplace.

Un appariement à 97 % est acceptable **parce que le verdict affiche son raisonnement**,
effectif compris. Un professionnel du secteur voit immédiatement qu'un bouchon de quinze
couverts n'a pas vingt salariés. L'explicabilité n'est pas un confort de présentation : c'est
ce qui rend une règle à 97 % tenable là où un verdict nu ne le serait pas.

Le détail vit dans [`technique/12-justesse-du-verdict.md`](technique/12-justesse-du-verdict.md).

> **Amendée le 17 octobre 2026, avant d'avoir été construite.** Le 97 % de la règle 1 a été
> mesuré sur des paires déjà appariées par le nom ; sur les non-appariés, un échantillon montre
> au moins 29 % d'erreurs. Le numéro de rue devient un critère de corroboration, jamais
> suffisant seul — voir [D40](#d40--le-numéro-de-rue-corrobore-il-ne-suffit-jamais). Les règles
> 2 et 3 tiennent, et ne sont pas construites non plus.
>
> **Annoté le 17 octobre 2026, plus tard.** Les règles 2 et 3 sont construites : PR #14, mergée le
> 17 octobre à 10:32 UTC. La règle 1, sous sa forme de D40, ne l'est pas.

---

## D32 — Le déploiement passe par GitHub Actions, et les tests le conditionnent

**Contexte.** Rien ne vérifiait le code automatiquement : `.github/workflows/` ne contenait que
le balayage mensuel et le maintien en vie, et aucun des deux ne lançait `npm test`,
`npx tsc --noEmit` ni `npm run build`. Chaque mise en production était une trentaine de
commandes jouées à la main depuis le poste, décrites par la skill `deploy` — préflight, scan de
secrets, poussée, `vercel deploy --prod`, contrôle de l'alias, sondes HTTP.

Deux défauts, et le second est le plus grave. Le geste est coûteux, donc espacé, donc chaque
livraison porte plus de changements que la précédente. Et surtout : **`vercel deploy` téléverse
l'arbre de travail, pas une référence git.** Un fichier non suivi que `.gitignore` ne couvrait
pas partait en production ; un arbre en retard sur `origin/main` annulait silencieusement les
commits des autres. La skill s'en défendait par deux contrôles humains — `git status --porcelain`
doit être vide, `behind` doit valoir 0 — c'est-à-dire par de la discipline.

**Options écartées**
- *L'App GitHub Vercel* — c'est l'état que [`08-infrastructure.md`](technique/08-infrastructure.md)
  décrivait déjà, et c'est zéro secret et zéro maintenance. Mais Vercel déploie sur webhook,
  hors de portée d'Actions : un commit dont les tests échouent part quand même en production, à
  moins d'ajouter une protection de branche et donc un flux de PR obligatoire sur un projet
  solo. Et le commit hebdomadaire de maintien en vie déclencherait un redéploiement — celui-là
  même que [`09-deploiement.md`](technique/09-deploiement.md) refuse.
- *Un artefact pré-bâti (`vercel build` puis `deploy --prebuilt`)* — bâtirait sur le Node du
  runner, qui n'est pas nécessairement celui du projet chez Vercel. On expédierait un artefact
  bâti ailleurs que là où il s'exécute pour économiser une minute de build distant.
- *Le retour arrière automatique quand une sonde échoue* — `vercel rollback` a deux façons de se
  retourner contre soi : passer l'alias fait revenir au déploiement cassé lui-même, et la forme
  nue devient `rollback status` et ne revient sur rien. Le déclencher sur un `curl` capricieux
  serait pire que la panne à laquelle il répond.
- *N'ajouter que les tests et garder le déploiement manuel* — traite la moitié du problème et
  laisse l'autre entière. C'est le déploiement, pas la vérification, qui coûtait.

**Décision.** Un fichier, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), trois jobs.
`check` — scan de secrets, `tsc`, tests, build — sur chaque poussée de chaque branche. `preview`
pour les branches. `production` pour `main`, qui déclare **`needs: check`** et déploie par le CLI
Vercel avec un `VERCEL_TOKEN` en secret de dépôt, puis vérifie : le projet lié, l'état du
déploiement, le déplacement de l'alias, et les quatre sondes non authentifiées.

**Conséquences.**

Déployer un arbre rouge devient **structurellement impossible**, sans dépendre d'une protection
de branche ni d'un flux de PR. Et la production est désormais **le commit poussé** : toute la
classe de pannes « l'arbre de travail n'est pas ce qui est commité » disparaît, avec les deux
contrôles humains qui la tenaient en respect.

Le garde-fou sur `lib/db/schema.ts` est **remplacé, pas supprimé.** La skill imposait un arrêt
humain — la colonne doit exister en production avant que le code qui la lit ne parte. Retirer
l'humain sans rien mettre à la place aurait été une régression, donc le job refuse une poussée
dont le diff touche ce fichier. Un `workflow_dispatch` le contourne : déclencher à la main
devient l'énoncé délibéré que la colonne existe déjà.

La skill `deploy` cesse de décrire un déploiement. Elle décrit ce que la chaîne **ne peut pas**
vérifier — tout ce qui est derrière le login, et la panne intermittente de [D23](#d23--jamais-de-requêtes-concurrentes-sur-une-connexion-poolée)
qu'aucun `curl` non authentifié n'atteindra jamais — et le retour arrière.

La garantie « le maintien en vie ne redéploie rien » ne repose plus sur un comportement
implicite de `GITHUB_TOKEN` mais sur un `paths-ignore` qui se relit.

**Ce que cette décision coûte.** Un secret de plus à faire vivre, `VERCEL_TOKEN`, dont
l'expiration se manifestera par un déploiement rouge et non par une panne. Et les previews
pointent sur la base de **production**, faute d'une seconde base : les données d'établissement
sont en lecture seule et les previews sont derrière le SSO Vercel, mais c'est à savoir avant
d'y tester une écriture.

---

## D33 — Un balayage en échec n'emporte plus les étapes hors ligne

**Contexte.** `cron:refresh` enchaîne `plan:cells`, `sweep:google`, `match:sirene` et
`compute:profiles`. La première erreur interrompait le cycle. Or [D22](#d22) veut qu'un
balayage s'arrête sur son plafond de quota, et [D28](#d28) a mesuré qu'il ne converge pas en
une période : **l'échec est donc l'état normal de chaque mois**, pas l'exception.

Conséquence observée le 1er septembre : le balayage s'arrête sur un `HTTP 500` de Google
après 737 appels, 115 établissements sont importés et payés — et repartent sans effectif
SIRENE, avec un profil calculé selon des règles antérieures, pour aussi longtemps que dure
la convergence. Le travail déjà payé était abandonné à cause d'une étape qui, elle, ne coûte
rien.

**Décision.** Les deux étapes **hors ligne** — `match:sirene` et `compute:profiles` — tournent
même quand une étape antérieure a échoué. Elles ne dépensent aucun appel Google et ne
dépendent pas de la complétude du balayage : chacune travaille **établissement par
établissement** sur des lignes déjà en base. Le cycle échoue toujours : la **première** erreur
est conservée et relancée à la fin, donc le code de sortie et la construction rouge sont
inchangés.

**Ce qui dépendait réellement de la complétude, et qui est traité ailleurs.**

Le canari de `match:sirene` cherche une **commune** dont le taux de non-appariement se
détache du taux global — cette concentration est ce qui trahit un défaut de normalisation ou
de géocodage. Sur un balayage inachevé, toutes les communes sont uniformément non appariées
pour une raison étrangère à l'appariement : la référence monte partout et la concentration
s'y dissout. Le détecteur se taisait précisément quand il aurait servi.

Le script décide donc lui-même : tant que des cellules sont dues, il **affiche** les chiffres,
**annonce qu'il ne les enregistre pas** et dit pourquoi. `sirene_unmatched` n'est pas écrit —
y mettre un nombre dénué de sens polluerait la comparaison d'un balayage à l'autre, seule
raison d'être de la colonne. La détection est demandée au script plutôt que passée en
drapeau : une seule source de vérité, et la règle reste juste quand quelqu'un lance
`match:sirene` à la main après une interruption.

> Mesuré sur la production le 1er septembre : Villeurbanne à **84,7 %** de non-appariés. Sur
> un balayage complet, c'est une alarme ; ce jour-là, cela signifiait seulement que
> Villeurbanne n'avait pas encore été balayée.

**Options écartées.**

- *Garder l'arrêt sec* — abandonne chaque mois un travail déjà payé, pour protéger un seul
  indicateur qu'il suffit de retirer.
- *Un drapeau `--sweep-incomplete` passé par `cron:refresh`* — deux sources de vérité, et
  faux dès qu'on lance le script à la main.
- *Faire aussi tourner `plan:cells` et `sweep:google` après un échec* — refusé : ce sont les
  étapes qui dépensent, et rejouer un balayage qui vient d'échouer, c'est payer deux fois.
- *Rendre le cycle vert malgré l'échec* — le silence est le mode de panne que ce projet
  refuse partout ailleurs.

**Conséquence sur le mode sec.** Les deux étapes hors ligne ont désormais un mode sans
écriture dans le cycle (`match:sirene --dry-run`, `compute:profiles --check`). Un cycle sec
répète donc la chaîne entière au lieu de s'arrêter après le balayage — ce qui rend cet
enchaînement vérifiable, et c'est ainsi qu'il a été vérifié.

**Vérification.** Échec provoqué dans la boucle sur une copie du script, base locale, mode
sec : `sweep:google` échoue, `! sweep:google failed — continuing with the offline steps`,
puis `match:sirene` et `compute:profiles` s'exécutent, le canari se retire en s'expliquant, la
fraîcheur est rapportée, et le cycle finit sur `MONTHLY CYCLE FAILED — sweep:google failed
(exit code 1)`. Sur la production en mode sec : **25 effectifs** et **33 profils** que
l'ancien enchaînement abandonnait.

---

## D35 — Réveiller la base chaque jour, par le pooler et par l'API, et découpler le commit

**Contexte.** [D19](#d19) reposait sur un modèle faux : Supabase mettrait un projet en pause
après **7 jours sans activité**, et une connexion suffirait à remettre le compteur à zéro. Le
projet s'est mis en pause deux fois :

- entre le 7 et le 14 septembre 2026. Le correctif d'alors l'a lu avec ce modèle — un réveil
  hebdomadaire ne laissait que 1,2 heure de marge contre 7,00 jours, et les retards de
  planification de GitHub l'avaient mangée — et il est passé à deux réveils par semaine ;
- entre le 5 octobre 12:16 UTC (`select 1` réussi) et le 8 octobre 12:02 UTC
  (`(ENOTFOUND) tenant/user … not found`), soit **trois jours** après une connexion réussie.
  Ce modèle ne peut pas l'expliquer.

La documentation de Supabase (*Project Pausing*, lue le 17 octobre 2026) décrit autre chose :
un projet gratuit est mis en pause quand il reçoit **trop peu de requêtes utilisateur sur la
semaine écoulée**, et « quelques requêtes utilisateur sur la base chaque jour » suffisent
d'ordinaire. C'est un seuil de volume, dont la valeur n'est pas publiée, et non un délai. Elle
nomme deux façons de produire cette activité : les **appels à l'API du projet**, et les
**requêtes de l'application connectée**.

Un fait d'octobre pèse dans le choix. Le 1er, le balayage a envoyé **des milliers de
requêtes** par le pooler — 900 appels Google, quelque 4 500 établissements écrits,
l'appariement SIRENE, le calcul des profils — et le projet était en pause sept jours plus tard
au plus. Une rafale ne tient donc pas la semaine, et la documentation ne dit pas si le trafic
du pooler compte comme requête utilisateur.

Enfin, le réveil et le commit étaient deux étapes d'un même job : la base en pause faisait
échouer la première, et la seconde ne partait plus. Aucun commit depuis le 5 octobre — une
panne Supabase faisait courir le compteur de GitHub.

**Options écartées**
- *Garder deux `select 1` par semaine*, le correctif de septembre — calibré contre un délai
  de 7,00 jours qui n'existe pas. Deux requêtes par semaine sont loin de « quelques requêtes
  chaque jour », et `select 1` est ce qu'envoient tous les poolers et toutes les sondes de
  santé : rien ne dit qu'il compte comme requête utilisateur. Il a échoué en octobre comme le
  rythme hebdomadaire en septembre.
- *Un réveil quotidien par le pooler seulement* — répond au « chaque jour », pas au doute
  qu'a laissé octobre : si le trafic du pooler ne compte pas, des milliers de requêtes ne
  l'ont pas fait compter, et trois de plus n'y changeront rien.
- *La Data API seulement* — c'est la voie que la documentation nomme le plus nettement, mais
  quitter le pooler, c'est cesser de vérifier chaque jour le secret `DATABASE_URL` dont
  dépend le balayage.
- *Un commit quotidien, dans le même job* — noie l'historique sous les horodatages, et garde
  le couplage qui a arrêté les commits en octobre.
- *Passer à l'offre Pro* — supprime la pause, rompt la contrainte du zéro euro.

**Décision.** Le même fichier porte désormais **deux jobs indépendants**, sur deux
planifications :
- **chaque jour**, des lectures réelles sur les tables de l'application, par les deux voies
  que nomme la documentation : trois requêtes Postgres par le pooler (`restaurant`, `cell`,
  `sweep_run`), et trois requêtes sur la Data API avec la clé publishable ;
- **chaque lundi**, le commit d'horodatage.

Chaque job exclut la planification de l'autre par `!=`, au lieu de nommer la sienne par `==` :
si une expression cron est modifiée sans sa copie, le job tourne trop souvent au lieu de ne
plus tourner du tout. Un déclenchement manuel n'a pas de planification ; il lance les deux.

**Conséquences.**
- Deux **variables** de dépôt à créer, `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` — pas des
  secrets, puisqu'elles sont publiques par construction. Tant qu'elles manquent, le réveil
  échoue en le disant.
- Toutes les tables ont la RLS activée sans politique : les requêtes sur la Data API
  s'exécutent et ne lisent rien. Le corps de la réponse n'est affiché qu'en cas d'échec.
- Ce modèle reste une lecture de la documentation, pas une mesure : Supabase ne publie aucun
  seuil. Si le projet se met encore en pause malgré six requêtes par jour, c'est le volume ou
  la voie qu'il faudra revoir — et ce journal dit ce qui a déjà été essayé.
- Une pause ne se répare toujours pas depuis le workflow : seule une reprise à la main depuis
  le tableau de bord la lève. Le job ne peut que l'empêcher ; son échec dit qu'il est trop
  tard.
- D19 tient sur l'essentiel — un seul fichier, et un en-tête qui l'explique — mais plus sur
  « une seule action hebdomadaire ».

**Vérification.** En local : les trois requêtes psql sur un Postgres 17 jetable, et l'échec
d'une requête intermédiaire, qui sortait en `0` sans `ON_ERROR_STOP` ; la boucle Data API
contre un faux PostgREST — succès, `401` sur une table, hôte introuvable, variable absente.
L'exécution réelle attend la reprise du projet depuis le tableau de bord.

---

## D36 — Rafraîchir le contenu périmé par couverture, pas la cellule interrogée le plus tôt

**Contexte.** La règle 1 de [D30](#d30--rafraîchir-avant-de-découvrir-et-replanifier-au-lieu-de-subdiviser)
sert d'abord « les cellules dont le contenu expire, de la plus ancienne à la plus récente », et
lit cette ancienneté dans le `queried_at` de chaque cellule. Ce n'est juste que si les cellules
ne se recouvrent pas. Or elles se recouvrent massivement : un restaurant tombe dans sa cellule
mère et dans plusieurs filles, et celle qui le retrouve repousse son `hours_expires_at` sans
toucher au `queried_at` des autres. **Le `queried_at` d'une cellule ne dit rien de l'âge du
contenu qu'elle couvre.**

Mesuré en production le 17 octobre 2026 :

| | Mesure |
|---|---|
| Passage du 1er octobre | 653 cellules de profondeur 0 + 247 de profondeur 1 — **~97 %** de la base rafraîchie |
| File du 1er novembre sous la règle en vigueur | les **899 cellules filles interrogées en septembre** (profondeurs 1 et 2) |
| Fiches qui resteraient expirées jusqu'en décembre | **~1 280, soit 35 %** — et la file s'inverse le mois suivant : une alternance mensuelle |
| Lieux apparus pour la première fois le 1er octobre, rattrapés par une couverture bâtie sur les données antérieures | fiches connues seules : **63 ou 64 sur 68** · robuste : **67 ou 68 sur 68**, selon le calcul |
| Cellules vides — zéro résultat, aucune fiche jamais vue dans leur cercle | **97** |

La taille de la couverture a été calculée trois fois ce jour-là, sur les mêmes données. Le
premier relevé n'a pas été reproduit ; les deux recalculs, indépendants, montrent que c'est la
**règle de couverture** qui fait l'écart :

| Ce qu'une cellule couvre | Fiches à horaires | Robuste | Fiches qu'aucune cellule ne couvre |
|---|---|---|---|
| Premier relevé, méthode non consignée | 567 | 703 | — |
| Cellules complètes seules, fiche à 10 m du bord au moins | 648 à 663 | 745 à 800 | **179 à 196** |
| Cellules complètes seules, sans marge | 583 à 599 | 678 à 747 | 31 |
| **Toute cellule interrogée, une tronquée jusqu'à son 20e résultat** | **528** | **~708** | **2** |

Ce qui départage les modèles : l'appel classe ses résultats par distance. Une cellule tronquée a
donc renvoyé tout ce qui est plus proche que son 20e résultat, dont elle enregistre la distance
— elle est exacte jusque-là. Ne compter que les cellules complètes, avec une marge de 10 m en
plus, laisse 5 % des fiches qu'aucune cellule ne peut racheter : elles expireraient chaque mois,
sans que rien ne le dise.

Et une contrainte de lecture : la base sert les flottants tronqués à 15 chiffres
significatifs, et le rayon d'une cellule vaut exactement la distance à son point le plus
lointain. Un test d'inclusion strict contre un cercle relu en base manque ainsi ~116 points
SIRENE posés sur le bord. Avec une tolérance d'un millimètre, chacun des 5 682 points géocodés
est dans un disque déjà interrogé.

Le correctif minimal du 17 octobre — les cellules dues triées par profondeur, la profondeur 0
d'abord — reproduit la forme du passage d'octobre pour le cycle du 1er novembre. C'est un
pansement : il suppose que les cellules mères couvrent à peu près tout, et il paie encore
chaque mois les cellules qui ne renvoient rien.

**Ce que ça réfute dans D30.** *« Sous le plan actuel, le rafraîchir consomme donc tout le
quota mensuel »* : faux. Le contenu en base vient bien des 900 cellules interrogées, mais il y
est **redondant** — 528 cellules suffisent à retrouver chaque fiche à horaires valides, ~708 en
couvrant aussi chaque point SIRENE. Une seule couverture par mois laisserait de **190 à 370
appels** ; [D38](#d38--deux-passages-par-mois-le-1er-et-le-16) les dépense autrement.

**Options écartées**
- *Garder l'ordre par `queried_at`.* C'est ce qui produit l'alternance mesurée : un tiers de la
  base expiré un mois sur deux.
- *Le tri par profondeur, en régime permanent.* Juste ce mois-ci, par construction du plan
  plutôt que par principe : il ne voit pas ce que la troncature d'une mère cachait, et il paie
  97 cellules vides chaque mois.
- *Rafraîchir toutes les cellules du plan.* C'est tout le quota, et davantage, pour un contenu
  que la moitié des appels suffit à retrouver.
- *Ne couvrir qu'avec les cellules complètes, et une marge de 10 m au choix.* 179 à 196 fiches
  hors de toute portée, qui expireraient chaque mois en silence.
- *Une cellule tronquée couvre tout son disque.* Moins de cellules — 464 —, mais faux : elle n'a
  renvoyé que ses vingt plus proches.
- *Une couverture des seules fiches connues.* Moins chère d'environ 150 appels, mais elle a
  manqué des ouvertures d'octobre que la robuste rattrape : ce qui ouvre là où aucune fiche
  n'existait encore attend sinon un budget de découverte que D38 ne laisse pas.
- *Retirer du plan les 97 cellules vides.* Une cellule vide aujourd'hui couvre un terrain où
  quelque chose peut ouvrir ; la retirer pour toujours rend ce terrain invisible sans que rien
  ne le dise.

**Décision.** Cinq règles. Elles remplacent la mise en œuvre de la règle 1 de D30 ; son
principe — la fraîcheur prime sur la complétude — reste.

1. **Chaque passage rafraîchit une couverture du contenu, pas une liste de cellules.** Parmi les
   cellules interrogées, il choisit gloutonnement la plus petite sélection dont la **portée**
   contient chaque fiche à rafraîchir, en servant d'abord les fiches dont l'échéance est la plus
   proche. La portée d'une cellule complète est son disque ; celle d'une cellule tronquée, le
   disque de rayon égal à la distance de son 20e résultat. L'inclusion se teste avec une
   tolérance d'un millimètre et sans autre marge : la marge de 10 m de
   [D45](#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus) sert à
   constater une absence, pas à choisir une cellule.
2. **L'ordre de choix est total.** 97 % des choix sont des ex-aequo ; à gain égal passe la
   cellule dont une fiche ajoutée expire le plus tôt, puis la moins profonde, puis la plus
   anciennement interrogée, puis l'identifiant. Sans ordre total, le mode sec et le mode réel
   n'achètent pas les mêmes cellules.
3. **La couverture est robuste** : chaque point SIRENE géocodé du périmètre est dans la portée
   d'une cellule choisie. C'est par là que le rafraîchissement trouve les ouvertures. Si elle ne
   tient pas dans le budget de D38, la couverture des fiches connues la remplace, sans nouvelle
   discussion.
4. **Une cellule vide sort de la couverture** — zéro résultat à son dernier appel, et aucune
   fiche jamais vue dans son cercle —, et ses points SIRENE ne comptent plus dans la contrainte
   robuste. Elle reste au plan et se rejoue une fois par semestre, sur une part réservée du
   passage du 16 (D38).
5. **Le solde va d'abord au second passage du mois (D38), ensuite à la découverte.**

**Conséquences.** Le coût mensuel du rafraîchissement devient un nombre calculé à sec et
rapporté par le cycle : la couverture du jour. Les fiches qu'aucune portée ne contient — deux
aujourd'hui — sont nommées à chaque passage.

En régime permanent, le second passage prend tout le solde : la découverte ne reçoit rien
(D38). C'est le prix de la fraîcheur, et il est dit.

`done` change encore de sens : une cellule n'est plus due parce qu'elle a été interrogée le
mois dernier, mais parce que la couverture la choisit. Le décompte des appels, lui, ne bouge
pas : il se lit toujours dans `queried_at` ([D28](#d28--le-plafond-dappels-porte-sur-la-période-du-quota-pas-sur-le-balayage)).

Le détail vit dans [`technique/13-rafraichissement-par-couverture.md`](technique/13-rafraichissement-par-couverture.md).

> **Annoté le 17 octobre 2026, après la construction (commit `05058b4`).** Le code calcule une
> couverture plus petite en robuste et plus grande en fiches connues que les chiffres ci-dessus.
> Sur la copie du 17 octobre, en passe à sec au 1er novembre :
>
> | Couverture | Ce journal | Le code |
> |---|---|---|
> | Robuste | ~708 (~710 dans D37) | **622** |
> | Fiches connues | 528 (~530) | **560** |
>
> Deux fiches restent hors de toute portée, comme annoncé. Les chiffres de ce journal sont ceux
> du jour de la décision ; le code et [`technique/14`](technique/14-cycle-d-import-mensuel.md)
> portent ceux du jour.

---

## D37 — La prévision compte l'arbre entier, et le périmètre devient un budget de découverte

**Contexte.** La règle 4 de D30 fait décider le nombre de cellules du plan à sec : sous 900
rien à arbitrer, de 900 à 1 500 le périmètre se réduit, au-delà le zéro euro se rouvre. Deux
mesures du 17 octobre en changent la lecture.

La re-troncature des cellules de reprise est **presque critique** :

| Profondeur | Re-troncature | Filles par troncature | Cellules tronquées engendrées par cellule |
|---|---|---|---|
| 0 | 26,3 % | ~4 | ~1,05 |
| 1 | 24,1 % | ~4 | ~0,96 |
| 2 | 22,2 % | ~4 | ~0,89 |

Chaque cellule tronquée engendre en moyenne presque une cellule qui tronque à son tour :
l'arbre s'éteint lentement. Tel qu'il est construit, il converge autour de **3 100 appels par
mois**. `plan:cells` en annonce **1 170** : c'est un plancher à un seul niveau de reprise, et il
le dit désormais.

Et sous [D36](#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt),
l'arbre n'est plus ce qu'on paie chaque mois. Le rafraîchissement coûte la couverture — 530 à
710 appels selon la contrainte robuste —, le reste serait de la découverte. Rendement mesuré : environ **0,13 lieu nouveau par
appel de découverte**. Et **40 % des cellules de reprise sont dans les 1er et 2e
arrondissements**, là où D30 mesurait le plus faible rendement de la recherche emblématique.

**Options écartées**
- *Garder le plan à sec comme chiffre de décision.* Un plancher à un niveau, quand l'arbre
  réel coûte près de trois fois plus : faux dans le sens rassurant, et il ne mesure plus ce
  qu'on paie.
- *Arbitrer sur les 3 100 de l'arbre convergé.* Ferait rouvrir le zéro euro pour un coût que
  personne ne paie chaque mois : sous D36, l'arbre est un arriéré de découverte, pas une facture.
- *Réduire le périmètre pour finir l'arbre ailleurs.* Le périmètre n'est plus la contrainte :
  la couverture de toute la ville tient sous 900.
- *Plafonner la profondeur de reprise plus bas.* Laisse les lieux cachés de la Presqu'île
  cachés pour toujours, sans que le bandeau puisse dire combien, et ne réduit pas le coût
  mensuel, qui est la couverture.

**Décision.**
1. **Le chiffre qui décide est le coût de la couverture robuste**, augmenté de ce que coûte le
   second passage de [D38](#d38--deux-passages-par-mois-le-1er-et-le-16). La table de D30 s'y
   applique telle quelle. Il est aujourd'hui sous 900 : **la question du périmètre est close**
   tant qu'il y reste.
2. **`plan:cells` annonce trois nombres, pas un** : la couverture (ce que coûte un mois), le
   plancher à un niveau, et l'arbre convergé calculé avec les taux de re-troncature mesurés par
   profondeur. Aucun ne se présente comme un autre.
3. **La découverte se dépense au rendement mesuré** — lieux nouveaux par appel, par commune,
   réévalué chaque mois —, les cellules les moins profondes d'abord à rendement égal. Ce qui
   reste caché est compté par commune et dit dans le bandeau, au même titre que l'expiration.

**Conséquences.** Le zéro euro tient au périmètre actuel sans couper un arrondissement. Le prix
est ailleurs, et il se dit : sous D38, les deux passages prennent tout le budget, et la
découverte ne reçoit rien en régime permanent ; même avec un solde, à 0,13 lieu par appel, elle
rapporterait quelques dizaines de lieux par mois au mieux. La Presqu'île restera longtemps la
zone la plus sous-comptée. La règle 3 dit comment dépenser la découverte le jour où elle a un
budget ; elle ne lui en donne pas. La vision promet « la liste de son arrondissement » ; pour le 1er
et le 2e, elle sera juste sur ce qu'elle montre et incomplète sur ce qu'elle tait — et elle le
dira.

Les constantes de prévision deviennent des taux par profondeur, mesurés, et leur commentaire
dit lesquels.

> **Annoté le 17 octobre 2026.** La règle 1 est construite en partie : `plan:cells` arbitre sur
> la seule couverture robuste, 622 aujourd'hui, sans y ajouter le coût du second passage. La
> règle 3, la découverte au rendement par commune, n'est pas construite.

---

## D38 — Deux passages par mois, le 1er et le 16

**Contexte.** Les horaires expirent 30 jours après leur collecte, et le passage du 1er octobre
les a tous collectés en une demi-heure : **les 3 608 horaires valides expirent entre 15h54 et
16h24 UTC le 31 octobre.** Le cycle se déclenche le 1er à 09:00 UTC, et GitHub retarde ce
déclenchement de **jusqu'à sept heures**. Chaque mois de 31 jours ouvre donc **17 à 30 heures
sans un seul horaire utilisable** — la liste par défaut est vide —, environ **138 heures par
an**.

`cron-refresh.ts` et `sweep.yml` affirment que se déclencher le 1er « garantit » le
remplacement avant l'expiration ; D7 et [`technique/02`](technique/02-budget-google-et-garde-fous.md)
le disent aussi. C'est faux sept mois sur douze.

Ce n'est pas un réglage d'horaire, c'est de l'arithmétique : douze rafraîchissements espacés
d'au plus 30 jours couvrent 360 jours, pas 365. **Une fiche rafraîchie une seule fois par mois
calendaire passe au moins cinq jours par an expirée**, quel que soit le jour du mois choisi.
Seul un second rafraîchissement certains mois l'évite, et c'est ce que le solde du quota peut
acheter.

Deux simulations, le 17 octobre. Celle du propriétaire : **600 appels le 1er et 300 le 16**
gardent la pire heure à **86,6 %** de fiches fraîches au lieu de **0 %**, et la moyenne passe
de 98,3 % à 99,7 %. Rejouée sur une couverture (cellules complètes, marge de 10 m, 745
cellules), douze mois à partir du 1er novembre, retards de GitHub tirés au hasard :

| Plafond du 1er | 600 | 500 | **450** | 400 |
|---|---|---|---|---|
| Pire heure | 74,3 % | 82,7 % | **85,9 %** | 82,2 % |

Dix tirages de retards donnent tous 85,9 à 86,0 % à 450. À 600, le passage du 16 n'a que 300
appels pour racheter ce que le 1er a rafraîchi, et un mois de 31 jours s'éteint au quart.

La même simulation montre ce que deviennent les priorités. Sous deux passages, **tout le
contenu est dû à chaque passage** : ce que le 1er a rafraîchi expire avant le 1er suivant
augmenté de douze heures, donc le passage du 16 le compte. Un glouton qui ne regarde que le
nombre de fiches reprend toujours les mêmes cellules denses et affame ce qui vient d'expirer.
Et rien ne reste pour la découverte, ni pour le rejeu des cellules vides.

**Options écartées**
- *Accepter et documenter.* Honnête, mais la défaillance est totale : à la pire heure la liste
  par défaut est vide pour tout le monde. Une extinction prévisible, un jour par mois, qu'on
  sait éviter pour zéro euro.
- *Relire la règle des 30 jours.* Faite le 17 octobre : les conditions parlent de 30 jours
  calendaires consécutifs, pas un jour de plus. La relecture ouvre en revanche une question bien
  plus large que ce calendrier — [`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), axe 0.
- *Déplacer le passage au 28 ou au 30.* L'intervalle entre deux passages mensuels est toujours
  la longueur d'un mois ; il vaut 31 jours sept fois par an, quel que soit le jour.
- *Un passage tous les 30 jours plutôt que tous les mois.* Un mois calendaire par an en
  porterait deux : deux couvertures dans la même période, au-delà de 900 — la carte bancaire.
- *Tout rafraîchir deux fois, le 1er et le 16.* Deux couvertures complètes dépassent 900.
- *Garder 600 sur la foi de la première simulation.* Rejouée sur une couverture, elle donne
  74,3 % : le plafond se lit dans la simulation de la règle qu'on applique, pas dans une autre.

**Décision.**
1. **Deux passages par mois, le 1er et le 16, à 09:00 UTC.** Le plafond du 1er est celui qui
   **maximise la pire heure** dans la simulation sur douze mois : **450 appels** au 17 octobre.
   Le 16 dispose du reste de la période, jusqu'au plafond de 900. Le plafond se recalcule à
   chaque changement de la règle de couverture — celle de
   [D36](#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt)
   est plus petite que celle de la simulation —, et la simulation qui le fixe est consignée.
2. **Le passage du 16 réserve d'abord une quinzaine d'appels** aux cellules vides dues pour leur
   rejeu semestriel. Sans réserve, elles ne recevraient jamais rien.
3. **Puis chaque passage sert, dans cet ordre** : le contenu expiré ou qui expire avant
   maintenant augmenté de douze heures ; celui qui expire avant le passage suivant augmenté de
   douze heures ; le reste, par échéance ; la découverte. C'est le plafond du 1er qui étale les
   échéances : sans lui, tout serait rafraîchi le même jour et expirerait dans la même
   demi-heure.
4. **Le refus de rejouer un balayage réussi depuis moins de 25 jours est retiré**, au plus tard
   avec le premier passage piloté par la couverture. Il bloquerait le passage du 16 dès qu'un
   passage du 1er sort `succeeded` ([D39](#d39--ce-qui-fait-échouer-le-cycle)). Le plafond de la
   période borne déjà ce qu'un mois peut dépenser, relances manuelles comprises ; le plafond du
   1er borne le premier passage.
5. **L'affirmation « le 1er garantit le remplacement avant l'expiration » est retirée** de D7,
   de `technique/02`, de `cron-refresh.ts` et de `sweep.yml`, au profit de ce qui est vrai : le
   cycle étale les échéances, et ce qui expire malgré lui ne s'affiche pas (D30 règle 6) et se
   compte dans le bandeau.

**Conséquences.** La pire heure n'est plus nulle, mais elle n'est pas pleine : environ une fiche
sur sept peut être expirée au même moment, certains jours. C'est la limite de l'arithmétique
sous 900 appels, et l'écran le dit au lieu de le cacher.

**La découverte ne reçoit rien en régime permanent.** Le budget entier va au rafraîchissement,
et la part réservée est ce qui garde vivantes les cellules vides. Les lieux que les troncatures
cachent encore — surtout en Presqu'île — ne seront pas achetés tant que la couverture ne
rétrécit pas, ou qu'on ne rend pas de la fraîcheur pour eux. C'est un arbitrage, laissé ouvert
dans [`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md). Les ouvertures, elles, restent prises par la
couverture robuste.

Le critère d'acceptation se joue à sec : une simulation sur douze mois, retards de GitHub
compris, garde la pire heure au-dessus de **85 %**, sans jamais dépasser 900 appels dans une
période ni le plafond du 1er. Décembre a 31 jours : pour que le 31 décembre ne s'éteigne pas, le
passage du **16 décembre 2026** doit exister.

> D7 reste vrai sur l'essentiel — un horaire ne s'affiche jamais au-delà de 30 jours. Il cesse
> d'affirmer que la planification suffit à l'obtenir.

> **Annoté le 17 octobre 2026, après la construction (commit `05058b4`).** Trois points.
>
> **La simulation de la règle 1, consignée.** Elle a été rejouée sur la couverture que le code
> applique.
> - Commande : `simulate:passes --from=2026-11-01T09:00:00Z --seed=N`, N de 1 à 10, sur une
>   copie du 17 octobre.
> - Résultat : pire heure **91,5 %** pour chaque graine, `lowest forecast` 91,5 %, au plus 900
>   appels par période et 450 avant le 16.
> - Le 85,9 % de la table ci-dessus a été simulé sur une autre couverture (cellules complètes,
>   marge de 10 m). Le plafond de 450 tient.
>
> **Le retard de GitHub va au-delà de sept heures** : 7 h 52 mesurés sur le réveil le
> 12 octobre. Rejouée avec 8 heures, la simulation garde 91,5 %. Voir
> [D50](#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour).
>
> **La règle 4 se trompe sur un point.** « Le plafond de la période borne déjà ce qu'un mois peut
> dépenser, relances manuelles comprises » : c'est faux depuis que la passe du 16 rachète des
> cellules que le 1er a déjà tamponnées. Le compteur sous-compte la période. Voir
> [D28](#d28--le-plafond-dappels-porte-sur-la-période-du-quota-pas-sur-le-balayage), son
> annotation, et [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 4.

> **Annoté le 26 octobre 2026.** La règle 4 redevient vraie quand
> [D52](#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel) est construite,
> avant le 16 novembre. Interdire au 16 de racheter ce que le 1er a tamponné, qui aurait suffi à
> rendre les tampons exacts, a été simulé et écarté : la pire heure tomberait à 69,5 %.

---

## D39 — Ce qui fait échouer le cycle

**Contexte.** Un cycle rouge ne porte aujourd'hui aucun signal. Le balayage sort en échec
**chaque mois, par construction** : l'arrêt sur le plafond est levé comme une erreur ordinaire,
les cellules encore dues s'ajoutent aux motifs, et `sweep_run.status` passe à `failed`. Le
passage du 1er octobre est en échec sur trois motifs, et **les trois sont le plafond**. L'alarme
de fraîcheur de `cron-refresh`, elle, ne se déclenche que lorsque le plan a **entièrement
convergé**, ce qui n'arrive jamais. Le seul état observable est donc « rouge », que le mois se
soit bien ou mal passé, et l'alerte que GitHub envoie à chaque échec est devenue un bruit qu'on
apprend à ignorer. Le jour où quelque chose cassera vraiment, elle ressemblera à toutes les
autres.

[D33](#d33--un-balayage-en-échec-nemporte-plus-les-étapes-hors-ligne) avait raison de garder le
cycle rouge plutôt que de le taire. Il ne disait pas *quoi* rendre rouge.

Repères mesurés le 17 octobre : **2,2 %** des fiches à horaires étaient périmées juste après le
passage du 1er octobre (82 sur 3 730), **3,3 %** deux semaines plus tard (122). Aucune cellule
irréductible, aucune cellule tronquée sans cellule de reprise.

> Une PR parallèle (#12) a instruit la même question le même jour, puis a été fermée au profit
> de celle-ci ; sa revue a apporté les règles 1, 4 et 5 et le dernier paragraphe des
> conséquences.

**Options écartées**
- *Garder l'échec sur les cellules dues.* Rouge douze mois sur douze : aucune information, et
  une alerte dressée à être ignorée.
- *`continue-on-error` dans le workflow.* Met au vert les défauts avec le reste : le silence que
  D33 refuse.
- *Un avertissement chaque mois au lieu d'un échec.* Le même rouge, un cran plus bas.
- *Ranger un passage plafonné en `succeeded`.* Il affirmerait une couverture que le passage n'a
  pas.
- *Garder l'alarme « convergé et périmé ».* Elle porte sur un état que le plan n'atteint jamais ;
  la prévision de la règle 3 la remplace.
- *Ne faire échouer que les cellules irréductibles nouvelles.* Il n'en existe aucune ; en
  accepter une est une décision à part entière, qui n'a pas à être prise d'avance.
- *Un seuil d'expiration nul.* Sous D38, jusqu'à une fiche sur sept peut être expirée certains
  jours : chaque mois de 31 jours serait rouge, et on retomberait dans le bruit.

**Décision.**

1. **Trois statuts.** `capped` : le passage s'est arrêté sur un plafond prévu — celui de la
   période ou celui du 1er (D38) — sans aucun défaut ; il sort en succès, `error` vide, et son
   résumé dit ce qui reste. `succeeded` : aucun défaut et plus rien de dû. `failed` : au moins
   un défaut ; il sort en échec, et `error` liste les défauts, tous et eux seuls. La colonne est
   du texte libre, sans migration ; le commentaire du schéma qui énumère ses valeurs déclenche
   le garde-fou de D32 quand on le modifie — à pousser par un déclenchement manuel, en sachant
   qu'aucune colonne ne change.
2. **Est un défaut, et fait échouer** : une interruption autre qu'un plafond prévu (erreur HTTP,
   `429`, signal d'arrêt, base injoignable) ; une cellule en échec ; une cellule irréductible ;
   une troncature sans aucune cellule de reprise ; un refus de démarrer (verrou tenu, journal
   des dépenses qui ne prouve pas ce qui a été dépensé, plafond déjà atteint).
3. **La fraîcheur se prévoit, et fait échouer sous 80 %** : à la pire heure entre la fin du
   passage et le passage suivant, retard de GitHub de sept heures compris, au moins 80 % des
   fiches à horaires doivent rester utilisables. La prévision se calcule sur la portée attendue
   des cellules choisies, sans marge : avec la marge de 10 m, elle lisait environ sept points
   sous la pire heure réelle, et la règle aurait viré au rouge un passage sur deux. Le seuil
   laisse passer le creux de D38 (~86 %) et attrape l'extinction d'octobre (0 %).
4. **Rapporté, jamais rouge — et visible** : l'arriéré de découverte, les troncatures dont la
   reprise attend son tour, la couverture du jour et son coût face au plafond, la fraîcheur
   prévue et l'heure de sa pire échéance. Sous GitHub Actions, chaque cycle réel, vert ou rouge,
   les laisse dans une annotation de niveau *notice* — pas *warning* : un avertissement chaque
   mois serait le rouge mensuel un cran plus bas.
5. **Une alarme de fraîcheur n'est jamais masquée.** Le cycle rapporte la première étape en
   échec, comme D33 le veut, **et** l'échec de fraîcheur : celui-ci n'est pas une étape en aval
   du balayage, c'est sa conséquence pour le produit.
6. **Le canari de `match:sirene` s'enregistre quand le passage a servi toute sa couverture
   robuste** : chaque point SIRENE est alors dans la portée d'une cellule interrogée, condition
   sous laquelle le taux de non-appariement par commune redevient un signal. Sous la couverture
   des seules fiches connues, il reste retenu, en le disant.

**Conséquences.** Un cycle vert dit que le contenu affiché tiendra jusqu'au passage suivant ; un
cycle rouge dit qu'il faut regarder. C'est la seule propriété qui rende une alerte utile.

**La règle 3 se construit avec D38, jamais avant.** Avec un seul passage par mois, chaque mois
s'éteint au moins le temps du retard de GitHub — même un mois de 30 jours, puisque le contenu
relevé le 1er à 9 h expire le 1er suivant à 9 h —, et la prévision serait rouge chaque mois. Ce
serait vrai, mais inactionnable : c'est le défaut que D38 corrige, pas un incident.

Une cellule irréductible fera échouer chaque cycle qui l'atteint, jusqu'à ce qu'on en décide.
C'est voulu, et il n'y a pas de mécanisme d'acquittement tant qu'il n'a pas servi une fois.

> **Annoté le 17 octobre 2026, après la construction (commit `05058b4`).** Deux écarts entre la
> règle et le code, et deux trous.
>
> **Les écarts.**
> - Les cellules irréductibles sont comptées sur **tout le plan**, pas sur le cycle « qui
>   l'atteint ».
> - Le canari de la règle 6 s'enregistre quand chaque point SIRENE est dans la portée d'une
>   cellule interrogée depuis moins de 30 jours. Ce n'est pas la condition écrite : une
>   couverture robuste servie en entier par la passe.
>
> **Les trous.**
> - La prévision de la règle 3 vaut 100 % quand plus aucune fiche n'est datée. Une perte totale
>   des horaires passerait une fois au rouge, attribuée à tort à la prévision, puis au vert pour
>   toujours. Voir [D48](#d48--une-base-sans-échéance-ne-passe-pas-pour-fraîche).
> - Le refus « ledger missing » de la règle 2 frappe désormais toute relance faite après le 16.
>   Ce n'est pas une perte de lignes, c'est le défaut de comptage relevé sous D28.
>
> Voir [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 4 et § 6.

> **Annoté le 26 octobre 2026.** Une fois
> [D52](#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel) construite, le
> refus « ledger missing » disparaît. Le remplacent deux refus de sens inverse : des cellules
> tamponnées, ou un total de plan, au-delà de ce que le journal a réservé. Ils restent des défauts
> au sens de la règle 2.

---

## D40 — Le numéro de rue corrobore, il ne suffit jamais

**Contexte.** La règle 1 de [D31](#d31--lappariement-se-fonde-sur-ladresse-et-le-repli-cesse-dinventer-un-discriminant)
fonde l'appariement sur l'adresse : « un seul candidat au même numéro de rue » désignait le bon
**713 fois sur 735, soit 97 %**. Cette précision a été mesurée sur les établissements **déjà
appariés par le nom**, c'est-à-dire sur la population où le nom et l'adresse disent déjà la
même chose. Elle ne pouvait pas voir le cas qui compte : deux commerces différents au même
numéro, l'un connu de Google, l'autre de SIRENE.

Mesuré le 17 octobre sur les établissements **non appariés**, là où la règle s'appliquerait :
elle en apparie **1 080**. Sur un échantillon de **45** paires au même numéro où les deux côtés
portent un nom, **13 sont manifestement deux commerces différents** — « Au plaisir du Senegal »
apparié à SOS PIZZA. Au moins 29 % d'erreurs, quand D31 en annonçait 3 %. Et chaque erreur pose
une tranche fausse sur un verdict, citée dans son explication.

Rien de D31 n'est construit : le nom reste éliminatoire, le seuil de 70 heures est toujours
dans le profil — **50 verdicts** portent encore *Coupure possible*, fiabilité *probable* —, et
le filtre de coupure propose toujours trois réponses.

**Options écartées**
- *Appliquer D31 tel quel.* Près d'un tiers d'effectifs faux sur la population visée.
  L'explicabilité qui rendait 97 % tenable ne rend pas 71 % tenable : elle fait seulement voir
  l'erreur à celui qui la paie.
- *Revenir au seul nom.* Le nom reste un mur pour les 2 485 enregistrements SIRENE qui n'en ont
  pas ([D42](#d42--la-raison-sociale--mesurer-avant-dajouter-la-colonne)), et pour ceux qui
  portent une raison sociale sans rapport avec l'enseigne.
- *Exiger l'unicité du candidat, sans autre critère.* C'est ce que l'échantillon a mesuré :
  SOS PIZZA était un candidat unique.

**Décision.**
1. **Le numéro de rue corrobore ; il ne suffit jamais seul.** Un appariement exige le même
   numéro, la proximité sous 75 m, **et** l'un de deux critères indépendants :
   - une similarité de nom avec l'enseigne, la dénomination usuelle ou la raison sociale (D42),
     à un seuil plus bas que 0,45 puisqu'elle ne décide plus seule, calibré sur l'échantillon ;
   - pour un enregistrement SIRENE sans nom : une adresse **en bijection** — un seul
     enregistrement SIRENE de restauration à ce numéro **et** un seul établissement Google à ce
     numéro, apparié ou non — avec des catégories compatibles (code d'activité contre types
     Google).
2. **La précision se mesure sur un échantillon tiré au hasard parmi les paires non appariées
   que la règle apparierait** : au moins 100 par critère, vérifiées à la main. Un critère sous
   95 % n'est pas appliqué. Les appariements existants ne servent plus à mesurer une règle
   destinée à d'autres.
3. **Les règles 2 et 3 de D31 tiennent**, et se construisent sans attendre : elles ne dépendent
   pas de l'appariement.

**Conséquences.** Le gain sera inférieur aux ~305 verdicts que D31 annonçait ; c'est le prix
d'un effectif juste. Il se mesure avant d'appliquer, critère par critère, et le chiffre rejoint
[`technique/12`](technique/12-justesse-du-verdict.md).

La leçon est celle de [D22](#d22--le-calibrage-sur-échantillon-nétait-pas-représentatif),
transposée : **une précision se mesure sur la population où la règle va s'appliquer**, pas sur
celle où elle est déjà vraie.

> **Annoté le 17 octobre 2026, plus tard.** Le constat « rien de D31 n'est construit » est
> dépassé pour la règle 3 de cette entrée : les règles 2 et 3 de D31 sont construites (PR #14,
> mergée le 17 octobre). Les règles 1 et 2 de D40 ne le sont pas.

---

## D41 — `NN` veut dire « sans salarié déclaré », pas « effectif inconnu »

**Contexte.** L'ingestion replie le code `NN` de la tranche d'effectifs sur une valeur nulle,
lu « non renseigné » — 65,2 % des lignes ([`technique/01`](technique/01-sources-de-donnees.md),
[`technique/05`](technique/05-inference-des-horaires.md)). Les **627** enregistrements appariés
sans tranche sont tous des `NN`, et **249** portent une coupure aux horaires : ils affichent
aujourd'hui *Coupure probable — effectif inconnu*.

Vérifié le 17 octobre dans la documentation :

- l'INSEE (*Stocks d'entreprises et établissements*, REE/Sirene) range `NN` sous « effectif
  inconnu », mais précise que pour la grande majorité il s'agit d'**établissements non
  employeurs**, et demande de regrouper `NN` avec `00` ;
- le catalogue de l'API Entreprise définit `NN` comme des **unités non employeuses** — aucun
  salarié dans l'année de référence, aucun effectif au 31 décembre —, en signalant que la
  tranche peut contenir quelques effectifs inconnus ;
- `00` désigne un établissement **qui a employé dans l'année mais n'a plus d'effectif au
  31 décembre** — pas « aucun salarié », comme le dit l'explication affichée aujourd'hui ;
- la tranche date de l'année N-2, et le fichier stock a reçu sa mise à jour annuelle — valeurs
  au 31/12/2024 — le **1er octobre 2026**, après notre ingestion du 28 août.

Ce que `NN` ne distingue pas : un établissement créé après l'année de référence n'a encore rien
déclaré, et ressort `NN` lui aussi. C'est l'essentiel des « quelques effectifs inconnus ».

**Options écartées**
- *Garder `NN` comme inconnu.* Contredit l'INSEE, et laisse au repli 249 verdicts dont on
  connaît la réponse.
- *Lire tout `NN` comme « sans salarié ».* Faux pour chaque établissement trop récent pour
  avoir déclaré : on affirmerait une absence de salariés que rien n'atteste.
- *Écarter les non-employeurs de la liste.* `technique/05` l'a déjà refusé pour `00` :
  l'information s'expose, elle ne filtre pas.

**Décision.**
1. **`NN` se lit « sans salarié déclaré » quand l'établissement existait avant la fin de
   l'année de référence de l'effectif.** Il rejoint le groupe *petit*, comme `00`, et le verdict
   est confirmé : *« Coupure très probable — ouvert 12h-14h30 puis 19h-22h30, sans salarié
   déclaré en 2024 »*.
2. **Un `NN` postérieur à l'année de référence reste inconnu** et relève du repli.
3. **`NN` n'est plus replié à l'ingestion.** Le code est conservé, avec la date de création de
   l'établissement et l'année de référence de l'effectif ; la distinction se fait au calcul du
   profil, pas au chargement.
4. **`00` s'affiche « aucun salarié au 31 décembre »**, et non plus « aucun salarié ».
5. **SIRENE se réingère avant toute mesure** : les tranches ont changé le 1er octobre. Les 627
   et 249 se remesurent après.

**Conséquences.** Deux colonnes — date de création, année de l'effectif —, donc une migration
appliquée à la main en production avant le code, comme toute modification du schéma. Elle se
fait en une fois avec celles de D42 et D45. La part de `NN` récents se mesure d'abord, par la
même requête DuckDB en lecture seule que D42.

Jusqu'à 249 verdicts quittent le repli pour *confirmé* ; c'est la fiabilité et l'explication
qui changent, le risque reste élevé. Et un établissement sans salarié déclaré embauche
rarement : c'est exactement ce que l'explication lui fait lire, sans rien filtrer.

---

## D42 — La raison sociale : mesurer avant d'ajouter la colonne

**Contexte.** **2 485 enregistrements SIRENE — 41 % — n'ont aucun nom**, ni enseigne ni
dénomination usuelle. Sous la règle actuelle ils ne peuvent jamais être appariés, et **714**
d'entre eux portent une tranche exploitable. Le nom qui leur manque existe ailleurs : la
**raison sociale** de l'unité légale, dans le fichier `StockUniteLegale`, par le SIREN. Borne
haute du gain : **+210 verdicts de coupure confirmés**.

C'est une colonne de plus, donc une migration manuelle de la production. Et une borne haute
n'est pas un gain : une raison sociale ressemble rarement à une enseigne.

**Options écartées**
- *Ajouter la colonne sur la borne haute.* Engager le geste le plus contraint du projet — une
  migration de production faite à la main — pour un gain qui peut valoir 30 comme 210.
- *Ne rien faire.* 714 tranches exploitables, plus du double des ~305 que D31 attendait de
  l'adresse.
- *Ingérer aussi le nom des entrepreneurs individuels.* C'est un nom de personne, que rien
  n'oblige à stocker, et un patronyme ressemble encore moins à une enseigne qu'une raison
  sociale.

**Décision.**
1. **On mesure d'abord, en lecture seule.** Une requête DuckDB sur le Parquet distant joint les
   enregistrements sans nom à `StockUniteLegale`, ne garde que les personnes morales, et écrit la
   correspondance SIRET → raison sociale dans un fichier local. On la confronte, sur une copie
   locale de la production (`db:pull`), aux établissements Google candidats selon
   [D40](#d40--le-numéro-de-rue-corrobore-il-ne-suffit-jamais). Aucune écriture en production.
2. **Le seuil est posé maintenant** : la colonne s'ajoute si la mesure donne **au moins 100
   verdicts confirmés supplémentaires**, avec une précision **d'au moins 95 %** sur un
   échantillon vérifié à la main. Sinon elle ne s'ajoute pas, et le chiffre est consigné ici.
3. **Seule la dénomination des personnes morales** est ingérée.

**Conséquences.** Si elle s'ajoute, la raison sociale est un nom comme un autre pour D40 : elle
corrobore une adresse, elle ne décide pas seule. La même migration porte les colonnes de D41 et
D45 ; la même requête mesure D41 et D42.

---

## D43 — Trois champs de plus dans le masque, au même palier

**Contexte.** `places.userRatingCount`, `places.websiteUri` et
`places.regularSecondaryOpeningHours` — qui porte notamment les horaires de **cuisine** —
déclenchent le même SKU, *Nearby Search Enterprise*, que `places.regularOpeningHours`
(documentation Google *Place Data Fields (New)*, lue le 17 octobre 2026). La facturation suit le
champ le plus cher : **zéro dollar de plus par appel**.

Les horaires de cuisine éprouvent le verdict le plus rassurant du produit : **1 142** fiches
sont *Sans coupure, confirmé*, dont **536** restaurants assis. Un restaurant ouvert de midi à
23 h sans interruption peut servir en cuisine de 12h à 14h30 puis de 19h à 22h30 : la salle n'a
pas de coupure, la brigade en a une — et le produit lui répond « Sans coupure ».

Au passage, [`technique/02`](technique/02-budget-google-et-garde-fous.md) range `places.rating`
parmi les champs qui feraient basculer l'appel au palier *Enterprise + Atmosphere* : c'est faux,
`rating` est Enterprise. Le piège existe, mais il porte sur d'autres champs — `reviews`,
`editorialSummary`, les `serves…`, `dineIn`, `takeout`, `delivery`.

**Options écartées**
- *Ne rien ajouter.* Laisse 536 verdicts *Sans coupure* non éprouvés quand l'épreuve est
  gratuite.
- *Ajouter `currentOpeningHours` ou `currentSecondaryOpeningHours`.* Même palier, mais ils
  portent les exceptions de la semaine en cours : du bruit pour un profil de rythme.
- *Ajouter les champs un par un, au fil des besoins.* Chaque modification du masque appelle un
  contrôle en console de facturation avant et après ; trois contrôles pour trois champs du même
  palier, ce sont trois occasions de se tromper.
- *Un masque qui dépend du besoin du script.* Interdit par `CLAUDE.md` et `technique/02` : le
  masque est une constante unique.

**Décision.**
1. **Les trois champs entrent dans la constante en une seule modification**, contrôlée en
   console de facturation au passage suivant : consommation Enterprise égale au nombre
   d'appels, **rien sur le palier Atmosphere**. Fusionner cette décision vaut la décision
   consciente qu'exige `technique/02`.
2. **Une coupure dans les horaires de cuisine retire le *Sans coupure*.** Le verdict se calcule
   alors comme pour toute coupure, effectif compris, et l'explication nomme les deux : *« Coupure
   en cuisine — salle ouverte 12h-23h, cuisine 12h-14h30 puis 19h-22h30, 3 à 5 salariés »*. Sens
   de l'erreur assumé : un verdict faussement rassurant coûte une demi-journée à celui qui se
   déplace.
3. **Le nombre d'avis et le site servent à reconnaître les fiches mortes**
   ([D44](#d44--les-fiches-fantômes-ne-reviennent-pas-avec-les-inconnus)). Aucun n'est un signal
   de rythme, et le nombre d'avis ne s'affiche jamais comme une note.

**Conséquences.** Après le premier passage, on mesure combien des 1 142 portent des horaires de
cuisine et combien y montrent une coupure ; si la couverture est faible, la règle ne coûte rien
et le rapport le dit. Ces champs relèvent de la même rétention que les horaires
([D45](#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus)), et de la même
question ouverte sur ce que les conditions permettent de stocker
([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), axe 0) : la décision ne se construit qu'une fois
cette question tranchée — on n'étend pas un stockage dont la légitimité est en cause.

---

## D44 — Les fiches fantômes ne reviennent pas avec les inconnus

**Contexte.** [D29](#d29--fermés-jamais-listés-horaires-inconnus-écartés-par-défaut) écarte par
défaut les fiches sans horaires et les ramène d'un clic. Mesuré le 17 octobre : **923** fiches
sans horaires, et **aucune n'a de réponse Google** — ce n'est pas un défaut d'analyse, Google ne
publie rien. **680** sont `OPERATIONAL`, et **74 %** de celles-ci n'ont **ni téléphone ni
SIRET** : rien pour les joindre, rien qui atteste qu'elles existent. L'une est près de Nice.

**Options écartées**
- *Les laisser revenir avec les inconnus.* Le clic ramène alors surtout des fiches mortes :
  ~500 lignes qui noient les ~180 fiches sans horaires mais joignables, les seules pour
  lesquelles un passage sur place a un sens.
- *Les supprimer.* D10 l'interdit, et une fiche peut gagner un téléphone au passage suivant.
- *Les reléguer en fin de liste.* Écarté par D29 pour la même raison : le tri est contraint par
  le curseur sur le nom.

**Décision.**
1. **Une fiche sans horaires, sans téléphone et sans SIRET est une fiche fantôme probable** —
   une fois [D43](#d43--trois-champs-de-plus-dans-le-masque-au-même-palier) en place, sans site
   ni avis non plus. Elle n'est **pas listée, même avec les inconnus**, et l'écran dit combien
   ont été écartées pour cette raison, sur la ligne qui compte déjà les fermées.
2. **Une fiche hors du périmètre n'est jamais listée**, et le balayage la signale : une
   recherche limitée à un cercle lyonnais n'a pas à ramener un lieu près de Nice.
3. **La règle se recalcule à chaque passage** : une fiche qui gagne un téléphone, un SIRET ou
   des horaires revient d'elle-même.

**Conséquences.** Le clic sur les inconnus ramène environ **180** fiches au lieu de 680, toutes
joignables. La règle de [`fonctionnel/02`](fonctionnel/02-recherche-carte-liste.md) tient : rien
n'est retiré en silence, chaque exclusion est comptée et nommée.

---

## D45 — Purger ce qui a expiré, et reconnaître ce que Google ne renvoie plus

**Contexte.** D7 et la règle 6 de D30 tiennent pour l'**affichage** : ce qui a expiré ne
s'affiche plus. Ils ne tiennent pas pour le **stockage** : les **122** fiches expirées au
17 octobre conservent leurs horaires bruts et leur grille. Les conditions limitent ce qu'on
conserve, pas seulement ce qu'on montre.

Et le balayage ne retire jamais rien. Une soixantaine de fiches — **60** au relevé du
propriétaire, dont 44 `OPERATIONAL` ; **62**, dont 46, en exigeant un jour d'écart — sont à
l'intérieur d'une cellule complète interrogée après leur dernière apparition, et qui ne les a
pas renvoyées. Leur distance au bord de la cellule a été mesurée, pour savoir si c'est un
artefact géométrique :

| À moins de … du bord | Observé | Attendu si réparties uniformément dans le disque |
|---|---|---|
| 10 m | 9 | 11,2 |
| 25 m | 23 | 25,2 |
| 50 m | 32 | 41,3 |

Aucune concentration au bord, médiane à 40 m à l'intérieur : ce sont de vraies absences —
fermeture, déménagement, changement de type —, pas des lieux posés sur la ligne.

Une seconde mesure, le même jour, regarde l'autre échelle de temps : les lieux à l'intérieur de
la portée d'un appel **du même jour** qui ne sont pas revenus de cet appel. **51** sur environ
4 640 paires observables, **tous à moins de 7,2 m du bord** (médiane 0,6 m) : 5 % de manqués
dans les dix derniers mètres d'une portée, aucun au-delà. Les deux mesures tiennent ensemble —
un effet de bord réel mais étroit, qui n'explique pas les absences de long terme.

**Options écartées**
- *Garder les horaires expirés pour l'audit.* C'est le stockage que D7 interdit.
- *Purger une fois par mois, au cycle.* Le contenu resterait stocké jusqu'à un mois après son
  échéance.
- *Supprimer la fiche.* Une candidature peut la référencer ; la fiche reste, vidée de son
  contenu Google.
- *Aucune tolérance.* Le jour même, une fiche sur vingt dans la bande des dix derniers mètres ne
  revient pas : une quarantaine de fiches par période passeraient absentes à tort, puis
  reviendraient.
- *Une tolérance plus large, 25 m ou davantage.* Aucun manqué au-delà de 7,2 m : elle ne
  protégerait de rien, et laisserait listées des fiches réellement absentes.
- *Appliquer la tolérance au choix des cellules.* C'est ce qui laissait 179 à 196 fiches hors de
  toute couverture
  ([D36](#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt)).

**Décision.**
1. **Une purge quotidienne efface le contenu horaire dès son échéance** : horaires bruts,
   grille, et les colonnes de profil qui en dérivent. La date de collecte et l'échéance restent —
   ce sont nos métadonnées, pas du contenu Google — pour que la fiche se compte *expirée* et non
   *inconnue*. Un job distinct du réveil ([D35](#d35--réveiller-la-base-chaque-jour-par-le-pooler-et-par-lapi-et-découpler-le-commit)
   a appris ce que coûte un couplage), avec un mode sans écriture.
2. **Une fiche qu'un appel aurait dû renvoyer, et n'a pas renvoyée, est marquée absente** par
   le passage qui le constate. Elle n'est plus listée, l'écran compte « N fiches que Google ne
   renvoie plus », et son contenu suit la purge à son échéance. Elle revient d'elle-même si un
   passage la retrouve.
3. **« Aurait dû »** : à au moins **10 m** à l'intérieur de la portée que cet appel vient de
   mesurer — son disque s'il est complet, la distance de son 20e résultat s'il est tronqué. Une
   fiche non revenue dans la bande des dix mètres n'est pas absente : elle reste due au passage
   suivant, une quarantaine de reprises par période. Les distances se comparent avec la
   tolérance d'un millimètre de D36.

**Conséquences.** Une colonne de plus — la date depuis laquelle la fiche est absente —, jointe à
la migration de D41 et D42.

La purge ne porte que sur les horaires, et c'est délibéré. D7 dit davantage : *tout* le contenu
Places, sauf l'identifiant, est limité à 30 jours — nom, adresse, téléphone, position — et les
923 fiches sans horaires n'ont même pas d'échéance. Étendre la purge à l'identité de la fiche
est la conséquence logique de D7 ; mais la relecture des conditions faite pour D38 montre que la
question est plus large que trente jours. Elle reste ouverte, avec elle, dans
[`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), axe 0.

> **Annoté le 17 octobre 2026, après la construction de la règle 1 (commit `0fee11c`) ; complété
> le 26 octobre.**
>
> **Où en est la règle 1.**
> - La purge est planifiée chaque jour à 10:23 UTC.
> - Sa première écriture, le 18 octobre à 14:03 UTC, a vidé les 122 fiches échues ; les huit
>   suivantes, jusqu'au 26 octobre, n'ont rien trouvé à vider.
> - Elle a démarré avec 3 h 39 à 6 h 38 de retard. « Dès son échéance » veut donc dire en
>   pratique jusqu'à un jour, plus ce retard.
> - Lancée à la main, elle **écrit par défaut**.
>
> **Les règles 2 et 3** ne sont pas construites ; aucune colonne n'existe.
>
> **Un trou relevé depuis.** Une étape hors ligne qui lit une fiche avant la purge et l'écrit
> après remet un horaire échu que la purge ne reprend plus. Voir
> [D49](#d49--la-purge-rattrape-ce-quune-étape-hors-ligne-réécrit).

---

## D46 — Une seule instruction à la fois sur la connexion poolée, pour toute l'instance

**Contexte.** Le 17 octobre à 11:18:43 UTC, trois `GET /recherche` partis du même navigateur en
deux millisecondes ont tous échoué au bout de **300 secondes** — 504, `Task timed out after 300
seconds`, aucun autre message. Le chargement précédent, trois secondes plus tôt, avait répondu
en 200. Déploiement `dpl_GHzo3Pzv…`, commit `b796cad`.

D23 avait rendu séquentielles les requêtes **d'une page**. Mais Fluid compute — actif sur le
projet (`resourceConfig.fluid: true`), réglage par défaut des projets créés depuis le 23 avril
2025, et celui-ci a été créé dans la nuit du 28 au 29 août 2026 — sert plusieurs requêtes HTTP
dans **une même instance**, et toutes partagent l'unique connexion du client (`max: 1`).
postgres.js écrit une requête **sans paramètre** sur une connexion occupée sans attendre la
réponse précédente : c'est le pipelining de D23, mais d'une requête HTTP à l'autre. Supavisor, en
mode transaction, n'a renvoyé que la réponse de la première ; les suivantes n'arrivent jamais, et
tout ce qui attend derrière elles sur l'instance attend jusqu'au délai de 300 secondes.

La page fait trois lectures sans paramètre : la progression du balayage (`selectDistinct`, depuis
le 27 septembre) et les deux lectures de fraîcheur des horaires. Les requêtes paramétrées, elles,
ne pipelinent pas : postgres.js marque la connexion pleine tant que leur description n'est pas
revenue.

Reproduit en local, avec l'image `supabase/supavisor:2.9.13` — celle de l'auto-hébergement Supabase
— en mode transaction, devant un Postgres 17 :

| Scénario, sur un seul client | Résultat |
|---|---|
| Un rendu à la fois, 100 tours | aucun blocage |
| Deux rendus simultanés | bloqué dès le premier tour |
| Trois rendus simultanés, drizzle 0.45.2 | bloqué dès le premier tour, à chaque essai (3/3) |
| Trois rendus simultanés, drizzle 0.36.4 | bloqué dès le premier tour |

La montée de drizzle-orm 0.36.4 → 0.45.2, déployée juste avant, n'y est pour rien : le trafic
réseau d'un rendu est identique message pour message sous les deux versions, et la reproduction
bloque de la même façon avec 0.36.4. Les sept chargements réussis sur 0.45.2 avant la panne
arrivaient un par un, à six dixièmes de seconde d'écart au moins.

D23 était déjà ce mécanisme, dans une seule requête : sans filtre, les deux premières requêtes du
`Promise.all` n'avaient pas de paramètre, et la troisième partait derrière elles.

**Options écartées**
- *`max_pipeline: 0` dans les options de postgres.js* — une ligne, et le blocage disparaît. Mais
  l'option n'est ni documentée ni typée, et elle casse `begin()` : postgres.js ne réserve plus la
  connexion, et la transaction lève une `TypeError` hors de toute promesse, qui fait tomber le
  processus. `match:sirene` ouvre deux transactions et ne refuse pas le pooler ; et en local, où
  rien ne passe par le port 6543, rien ne le montrerait.
- *Désactiver Fluid compute* — aucune ligne de code, et l'hypothèse d'une requête par instance
  redevient vraie. Mais c'est un réglage de plateforme, hors du chemin par défaut de Vercel : le
  jour où il revient, la panne revient avec lui sans que rien dans le code ne l'annonce.
- *Un client par requête* — une poignée de main TCP, TLS et authentification de plus à chaque
  page, et le `db` partagé de `lib/results.ts` à défaire.
- *Le pooler en mode session* — accepte le pipelining, mais tient un backend par instance ; la
  raison de D23 tient toujours.
- *Donner un paramètre à chaque requête* — seules les requêtes sans paramètre ouvrent la fenêtre,
  mais une lecture ajoutée sans `where` la rouvrirait, sans que rien ne le signale.

**Décision.** Sur le pooler transactionnel, le client de l'application ne laisse passer **qu'une
instruction à la fois**, toutes requêtes HTTP confondues. Une file d'attente dans
`lib/db/client.ts` enveloppe les trois chemins par lesquels drizzle atteint postgres.js —
`unsafe()`, `unsafe().values()` et `begin()` ; une transaction garde son tour jusqu'à sa fin. Les
pages restent séquentielles (D23) : ce n'est plus ce qui protège la connexion, mais les
paralléliser ne gagnerait rien, la file les sérialiserait de toute façon.

**Conséquences.** Plus aucun blocage dans la reproduction : 2, 3, 8 et 20 rendus simultanés,
30 tours chacun, et des transactions mêlées aux rendus ; sur le réseau, plus aucun message ne part
avant la réponse du précédent (0 sur 684). Le prix : deux requêtes servies par la même instance
s'attendent, quelques millisecondes par instruction — ce qu'elles faisaient déjà en pipelining,
sans la garantie d'une réponse. Un test sans base fait tourner le vrai drizzle contre la file :
une version de drizzle qui atteindrait le client par un quatrième chemin le fera échouer en CI,
pas en production.

**Leçon de méthode.** D23 avait vérifié sous charge — douze requêtes simultanées, toutes en 200 —
et ce n'était pas assez : la panne demande des requêtes qui atteignent la même lecture sans
paramètre au même instant, sur la même instance. Une reproduction qui échoue à coup sûr, contre
le vrai pooler, prouve davantage qu'un essai en production qui passe.

---

## D47 — La période du quota est le mois du Pacifique

**Contexte.** [D28](#d28--le-plafond-dappels-porte-sur-la-période-du-quota-pas-sur-le-balayage)
indexe le plafond sur « la période du quota — le mois calendaire », sans dire lequel. Le code a
choisi le mois du Pacifique le 29 août (commit `31b18cc`), mais aucune entrée de ce journal ne
porte ce choix. Il n'est écrit que :
- dans une annotation de [`technique/10`](technique/10-reprise-du-balayage.md) ;
- dans les commentaires de `lib/quota.ts` et de `sweep.yml`.

D38 en dépend pourtant : ses deux passes partent à 09:00 UTC pour cette raison, et le plafond de
la seconde s'ouvre le 16 en Californie.

Le projet s'appuie sur ce fait : Cloud Billing renouvelle son cycle, et avec lui le quota
gratuit mensuel, à minuit heure du Pacifique.

**Options écartées**
- *Le mois UTC.* Il se renouvelle sept à huit heures avant celui de Google. Le cycle partait
  alors à 03:00 UTC le 1er : notre compteur serait reparti de zéro pendant que Google comptait
  encore le mois précédent, déjà dépensé à 900. Un balayage entier aurait été facturé dans le
  même mois.
- *Le mois de Paris.* Le même défaut, avec neuf heures d'avance.
- *Un décalage fixe de huit heures.* Faux la moitié de l'année : le Pacifique est à UTC−7 en
  été.
- *Compter par balayage.* C'est ce que D28 a retiré.

**Décision.**
1. La période du quota est le mois calendaire du fuseau `America/Los_Angeles`, lu par son nom
   IANA, jamais par un décalage.
2. Le plafond d'une passe se lit sur le même calendrier : celui du 1er jusqu'au 15 inclus, heure
   du Pacifique, celui de la période entière ensuite.
3. Les passes planifiées partent à 09:00 UTC, heure qui a franchi minuit Pacifique en toute
   saison sans quitter le jour.

**Conséquences.**
- Chaque 1er, une à deux heures de quota neuf restent inemployées entre minuit Pacifique (07:00
  ou 08:00 UTC) et 09:00 UTC, auxquelles s'ajoutent les retards de GitHub.
- La documentation de GitHub, lue le 17 octobre 2026, permet un fuseau IANA dans `on.schedule`.
  Planifier à minuit Pacifique fermerait cet écart, sans le retard. Ce n'est pas tranché ici :
  c'est l'un des choix de la coupure du 31 octobre ([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md),
  C3).
- Le 1er novembre 2026 est le jour du changement d'heure en Californie : la période 2026-11 ouvre
  à 07:00 UTC.

> Consignée le 17 octobre 2026 : décidée et construite le 29 août. D28 n'en dépend pas sur le
> fond — il tient sur n'importe quel mois — mais sa garantie de ne pas facturer, si.

---

## D48 — Une base sans échéance ne passe pas pour fraîche

**Contexte.** La prévision de [D39](#d39--ce-qui-fait-échouer-le-cycle) règle 3 se lit sur les
échéances stockées : la part des fiches **datées** encore utilisables à la pire heure avant la
passe suivante. Quand plus aucune fiche n'est datée, elle vaut 1.

Et le balayage met l'échéance à nul quand un appel renvoie un lieu sans horaires. Si Google cesse
de renvoyer les horaires — masque de champs cassé, réponse qui change —, chaque passe efface les
échéances de ce qu'elle sert :
- la première passe sort rouge, sur la prévision, avec un motif qui accuse la fraîcheur et non la
  source ;
- dès qu'aucune fiche n'est plus datée, la prévision lit 100 % et le cycle reste vert, sur une
  liste vide.

Repère mesuré : la part des lieux renvoyés avec horaires valait **80 %** le 1er septembre
(2 309 sur 2 894) et **81 %** le 1er octobre (3 608 sur 4 472).

**Options écartées**
- *Garder 100 % quand rien n'est daté.* C'est le vert sur une base éteinte.
- *Mettre toutes les fiches au dénominateur.* Les 923 fiches que Google n'a jamais datées
  compteraient comme échues. La prévision perdrait une vingtaine de points à chaque passe, et le
  rouge mensuel redeviendrait le bruit que D39 a retiré.
- *Comparer à la passe précédente.* Plus fin, mais une base qui s'éteint en deux passes
  franchirait la première comparaison. Et il faut un historique que la base n'a pas encore
  ([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), C1).

**Décision.**
1. Une base sans aucune fiche datée prévoit **0 %**, pas 100 %.
2. Est un défaut au sens de D39 : une passe dont **moins de la moitié des lieux renvoyés** portent
   des horaires. Le seuil se lit sur les 80 et 81 % mesurés ; un masque cassé donne zéro.

**Conséquences.**
- Un défaut de plus, qui ne s'est jamais produit, et qui dit la vraie cause.
- Une passe qui n'a renvoyé aucun lieu n'est pas jugée par la règle 2.
- Le seuil se relit si la part mesurée bouge de plus de dix points. Le journal par passe la
  consignera, s'il est construit.

---

## D49 — La purge rattrape ce qu'une étape hors ligne réécrit

**Contexte.** [D45](#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus)
règle 1 purge chaque jour les horaires échus et ce qui en dérive. Elle ne vise que les fiches
dont l'échéance est passée **et** qui portent encore leurs horaires bruts.

`compute:profiles` lit toutes les fiches, calcule, puis réécrit la grille horaire et le profil.
`match:sirene` fait de même pour les fiches dont l'effectif change. Si la purge passe entre la
lecture et l'écriture :
- l'étape hors ligne remet la grille et le profil d'un horaire échu ;
- la purge ne voit plus cette fiche, qui n'a plus d'horaires bruts ;
- les recalculs la sautent, comme « purgée ».

Le contenu reste alors stocké jusqu'à ce qu'une passe renvoie le lieu, et peut-être jamais pour
une fiche que Google ne renvoie plus.

**La fenêtre.**
- Le 1er octobre, les étapes hors ligne ont tourné de 16:24 à 16:27 UTC ; `compute:profiles` a
  duré 2 min 20 s.
- La purge est planifiée à 10:23 UTC. Ses neuf premières exécutions, du 18 au 26 octobre, ont
  démarré **entre 14:02 et 17:01 UTC**, avec 3 h 39 à 6 h 38 de retard : la plage même où les
  passes finissent.

C'est rare, pas impossible, et le dommage ne se répare pas seul.

**Options écartées**
- *Un groupe de concurrence commun à `purge.yml` et `sweep.yml`.* GitHub ne garde qu'une
  exécution en attente par groupe, et **annule la précédente** quand une nouvelle arrive. Une
  purge mise en file pourrait annuler une passe en attente. Et le groupe ne couvre pas un
  lancement local.
- *Un verrou consultatif partagé.* Il faudrait le tenir sur toute la chaîne hors ligne, à travers
  plusieurs processus et par le pooler, là où le verrou du balayage a déjà fui le 4 septembre.
- *Déplacer l'heure de la purge.* Les retards de GitHub rendent toute heure incertaine.
- *Ne rien faire.* La fenêtre est étroite, mais l'effet viole D45 sans fin et en silence.

**Décision.**
1. **La purge vise tout ce qui dérive d'un horaire échu**, et pas seulement les fiches qui portent
   encore leurs horaires bruts. Une fiche échue dont la grille ou le profil a été réécrit est
   vidée au passage suivant, quel que soit l'auteur de l'écriture.
2. **Les étapes hors ligne n'écrivent une fiche que si ses horaires n'ont pas changé depuis leur
   lecture** — ni vidés par la purge, ni rafraîchis par un balayage. Sinon elles la laissent, et
   le comptent dans leur rapport.

**Conséquences.**
- Aucun verrou, et aucune dépendance entre workflows.
- Au pire, du contenu échu reste stocké jusqu'à la purge du lendemain, ce que D45 accepte déjà.
- Les tests de la purge gagnent le cas « réécrite après la purge ».

Le détail vit dans [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 8.

---

## D50 — L'âge de la dernière passe se vérifie chaque jour

**Contexte.** Rien ne vérifie qu'une passe a eu lieu. Le réveil quotidien affiche la fin de la
dernière exécution du balayage, sans aucun seuil. Or :
- GitHub retarde les planifications : 4 h 51 et 6 h 54 sur le balayage, jusqu'à **7 h 52** sur
  le réveil le 12 octobre. C'est au-delà des sept heures que supposent D38 et la prévision.
- Sa documentation, lue le 17 octobre 2026, dit qu'une exécution planifiée peut être
  **abandonnée** sous forte charge. Le jeudi 24 septembre, le réveil n'a eu aucune exécution
  planifiée.
- Une passe qui n'a pas lieu ne produit aucun rouge : il n'y a pas d'exécution pour échouer.

Le premier signe serait la liste vide, jusqu'à quinze jours plus tard.

**Options écartées**
- *S'en remettre à la prévision de D39.* Elle se calcule dans la passe : sans passe, pas de
  prévision.
- *Ajouter un seuil à la requête du réveil.* Le réveil virerait au rouge pour une raison qui
  n'est pas la pause de la base, et D35 a mesuré ce que coûte un couplage.
- *Un témoin extérieur, seul.* C'est un compte de plus, donc un choix du propriétaire
  ([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md), C5). La vérification dans le dépôt coûte peu, et
  se fait en attendant.

**Décision.**
1. **Chaque jour, une vérification échoue si aucune passe n'a fini depuis la dernière date
   planifiée augmentée de neuf heures** — huit de retard, une de job. Elle lit `sweep_run` tant
   que le journal par passe n'existe pas, et vit dans un job à elle.
2. **Le retard maximal de GitHub se lit sur les mesures** : 8 heures au lieu de 7, dans la
   prévision comme dans la simulation. Rejouée à 8 heures sur cinq graines, la simulation garde
   91,5 % : le plafond du 1er ne bouge pas.

**Conséquences.**
- Une passe abandonnée, un workflow désactivé à la main, un secret qui casse au démarrage
  deviennent un rouge le lendemain au plus tard.
- Un refus de démarrer, déjà rouge, ne date pas `sweep_run` : la vérification le confirme.
- Reste invisible : la désactivation de **toutes** les planifications après 60 jours sans commit,
  qui emporte la vérification avec elle. Seul un témoin extérieur la verrait (C5).

Le détail vit dans [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 7.

---

## D51 — La région des fonctions suit la base, pas les utilisateurs

**Contexte.** Le 26 octobre 2026, le propriétaire a relancé des chargements simultanés de
`/recherche` : tous en 200 — D46 tient —, mais lents. Un premier chargement, à 17:36:47 UTC, a
pris environ **cinq secondes** ; le chiffre est lu sur les horodatages du journal des requêtes,
pas mesuré.

La cause n'est pas dans le code, elle est dans un réglage que personne n'a pris. Les fonctions
du projet s'exécutent à **`iad1`, Washington** — `serverlessFunctionRegion: "iad1"` et
`functionDefaultRegions: ["iad1"]` sur le projet, `regions: ["iad1"]` sur le déploiement de
production, lus le 26 octobre par l'API de Vercel (`/v9/projects/…`). C'est la valeur par défaut
de Vercel. Le dépôt n'a pas de `vercel.json`, et
[`technique/09`](technique/09-deploiement.md) ne nomme aucune région : héritée, jamais décidée.

Or la base et l'authentification Supabase sont en **Irlande**, AWS `eu-west-1`, derrière le
pooler de cette région ; [`technique/08`](technique/08-infrastructure.md), qui annonçait Francfort
ou Paris, se trompait. Les utilisateurs sont en France et en Espagne, et entrent par Paris
(`cdg1`). Chaque page partait donc d'Europe, traversait l'Atlantique pour s'exécuter, et
retraversait l'Atlantique à chaque lecture d'une base située à côté de ses lecteurs.

Mesuré en local : le vrai `lib/db/client.ts`, sur son chemin pooler, contre une base de
~4 477 fiches tirées du jeu de démonstration — la taille de la production —, à travers un proxy
qui ajoute une latence fixe.

| Aller-retour vers la base | Un rendu de `/recherche` | Trois chargements lancés ensemble, chacun |
|---|---|---|
| 72 ms — de `iad1` à `eu-west-1` | ~1,0 s | ~2,9 à 3,0 s |
| 2 ms — de `dub1` à `eu-west-1` | ~50 ms | ~140 ms |

Un rendu fait **13 allers-retours** vers la base à chaud, **15** à froid, avant
l'authentification : les requêtes paramétrées en font deux, postgres.js attendant leur
description avant de les exécuter (D46). À 72 ms, c'est une seconde par page. La file de D46
multiplie ensuite : trois chargements servis par la même instance passent l'un après l'autre, et
chacun attend les deux autres.

Le tableau laisse de côté tout ce qui paie aussi l'aller-retour — l'appel de la fonction à
l'authentification (`getUser()`), la poignée de main TLS et l'authentification SCRAM d'une
connexion froide (`idle_timeout: 20` la referme après vingt secondes d'inactivité), le trajet de
`cdg1` à la fonction — et le démarrage à froid, qui ne dépend pas de la région. Les cinq secondes
de production en sont la somme : le tableau n'en est qu'une borne basse.

**Options écartées**
- *Garder `iad1`.* Rien à changer, et chaque aller-retour continue de traverser l'Atlantique. La
  facture croît avec chaque lecture ajoutée à la page, et avec chaque visiteur simultané, que la
  file de D46 sérialise.
- *Changer la région dans le tableau de bord de Vercel.* Le même effet, sans fichier. Mais le
  réglage reste invisible dans le dépôt — c'est la raison pour laquelle D46 a écarté de
  désactiver Fluid compute depuis le tableau de bord —, et c'est exactement ainsi que `iad1`
  s'est installé : rien ne le montrait, personne ne l'a lu. Un projet recréé ou réimporté
  repartirait à `iad1` sans que rien ne l'annonce.
- *L'option `--regions` du CLI, dans le workflow de déploiement.* Versionnée elle aussi, mais
  attachée à une commande : le job de prévisualisation devrait la répéter, et tout autre chemin
  de déploiement l'ignorerait. `vercel.json` est lu par chaque déploiement, quel que soit le
  chemin.
- *`cdg1` ou `fra1`, au plus près des utilisateurs.* Le navigateur parle une fois à la fonction ;
  la fonction parle 13 à 15 fois à la base. À 10 ou 20 ms de l'Irlande, c'est 130 à 300 ms
  d'allers-retours par rendu, contre une trentaine à `dub1`, pour gagner quelques millisecondes
  sur un seul trajet. La latence qui compte est celle qui sépare la fonction de la base.
- *Réduire le nombre d'allers-retours* — regrouper les lectures de la page, ou mettre ses
  résultats en cache. Chaque lecture regroupée est un gain, mais l'authentification et la poignée
  de main continuent de payer l'Atlantique, et la première lecture ajoutée rouvre la facture. Le
  cache a déjà été écarté ([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md)) ; son argument — des pages
  de quelques millisecondes — redevient vrai une fois la base à 2 ms.
- *Plusieurs régions.* Hobby n'en permet qu'une, et la base n'est que dans une.

**Décision.**
1. **Les fonctions s'exécutent à `dub1`**, Dublin — la région AWS `eu-west-1`, celle de la base
   et de l'authentification Supabase.
2. **La région s'écrit dans `vercel.json`, et nulle part ailleurs** : `"regions": ["dub1"]`.
   Vercel ignore le réglage du projet dès qu'un déploiement déclare la sienne. On ne touche pas
   ce réglage : il restera à `iad1`, sans effet.
3. **La région des fonctions suit la base, pas les utilisateurs.** Si la base change un jour de
   région, cette ligne change avec elle, dans la même décision.

**Conséquences.** D'après la mesure, le temps passé à attendre la base tombe d'environ une
seconde à une cinquantaine de millisecondes par rendu, et de trois secondes à environ 140 ms pour
trois chargements lancés ensemble. Ce que la mesure laisse de côté baisse aussi, sauf le
démarrage à froid.

Le prix de la file de D46 redevient ce que D46 en disait : « quelques millisecondes par
instruction ». C'était vrai en local, où D46 a fait sa reproduction et où la base est à côté ;
à `iad1`, c'était 72 ms par aller-retour. La file reste : c'est elle qui protège la
connexion. Cette décision ne la remplace pas, elle rend son coût négligeable.

Les fonctions lisent la session des utilisateurs, leur adresse comprise, et liront leurs
candidatures : à `iad1`, elles le faisaient à Washington. `technique/08` voulait une base en
Europe pour que les données personnelles restent dans l'UE ; elles sont désormais traitées dans
la région qui les stocke.

Le middleware n'est pas concerné : Vercel le déploie dans ses régions d'entrée quel que soit ce
réglage — en moins grand nombre sur Hobby.

Le coût ne bouge pas. Hobby permet n'importe quelle région, une seule ; en déclarer une deuxième
ferait échouer le déploiement avant même le build — un échec bruyant, pas une facture.

La mise en œuvre tient en une ligne, dans une session distincte. La CI ne peut pas la vérifier :
toutes les pages sont derrière le login. Après le déploiement :
- la région **du déploiement** — pas celle du projet, qui restera `iad1` — vaut `dub1`. Si
  `vercel inspect --json` la porte, le job de production l'affirme à côté de `readyState` et de
  `target` : une région perdue ferait alors échouer le déploiement au lieu de ralentir l'outil ;
- connecté, le propriétaire charge `/recherche`, puis recharge trois onglets ensemble : la
  réponse doit paraître immédiate.

> **Annoté le 27 octobre 2026, à la mise en œuvre.** `vercel inspect --json` ne porte pas la
> région : le job de production ne l'affirme donc pas. Elle se lit sur le déploiement par
> `vercel api /v13/deployments/<id>`, champ `regions` — une commande encore en bêta, qu'on ne
> met pas dans un job qui suit un déploiement déjà en ligne. Relevé avant la mise en œuvre :
> `["iad1"]` sur le déploiement de production.

**Leçon de méthode.** Une mesure locale met la base à zéro milliseconde : elle mesure le code,
pas le déploiement. « Les pages tiennent en quelques millisecondes »
([`PROCHAINES-ETAPES`](PROCHAINES-ETAPES.md)) et « quelques millisecondes par instruction » (D46)
étaient vrais en local et faux en production, d'un facteur vingt, et rien ne pouvait le montrer
tant que la latence n'était pas ajoutée à la main. Une valeur par défaut est une décision que
personne n'a prise : celle-ci coûtait une seconde par page sans avoir jamais été écrite.

---

## D52 — La dépense d'une période se lit dans un journal, tenu appel par appel

**Contexte.** Avant de dépenser, le balayage impute à la période le maximum de deux lectures : les
cellules dont le `queried_at` tombe dans la période, et un plancher tiré de l'unique ligne de
`sweep_run` ([D28](#d28--le-plafond-dappels-porte-sur-la-période-du-quota-pas-sur-le-balayage)).
Aucune des deux ne tient depuis [D38](#d38--deux-passages-par-mois-le-1er-et-le-16) :
- la passe du 16 rachète des cellules que celle du 1er a déjà tamponnées dans la même période,
  et une cellule ne garde qu'un tampon ;
- le plancher n'est exact que si chaque autre période a dépensé 900 appels. Une période restée en
  dessous le relâche d'autant, pour toutes les suivantes.

Rejoué le 26 octobre 2026 sur la copie du 17 octobre, sans un appel : les choix de `planPass` aux
heures de `simulate:passes` (graine 1), douze mois à partir du 1er novembre, en suivant les
tampons et les deux lectures.

| Scénario | Appels réels | Tampons | Ce que lit le garde-fou | Effet |
|---|---|---|---|---|
| Novembre, deux passes | 900 | 666 — 234 rachats | refus `missing at least 234` | tout lancement refusé jusqu'au 1er |
| Chacun des onze mois suivants | 900 | 651 à 714 — 186 à 249 rachats | le même refus | idem |
| Novembre, passe du 16 coupée à 200 appels | 650 | 627 | refus de la reprise, `missing at least 23` | la période reste à 650 |
| Puis un décembre complet | 900 | 651 | **651**, sans refus | 249 appels autorisés : 1 149 réels dans le mois Pacifique |

Novembre retrouve, par une autre voie, la mesure de [`technique/14`](technique/14-cycle-d-import-mensuel.md)
§ 4. Le défaut n'est pas un accident de novembre : il revient chaque mois.

L'invariant à rétablir : **la dépense imputée à une période n'est jamais inférieure à la dépense
réelle.** C'est la seule propriété qui permette au compteur de garantir le zéro euro.

**Options écartées**
- *Interdire à la passe du 16 de racheter ce que le 1er a tamponné.* Aucune migration, et les
  tampons redeviendraient exacts. Simulé sur douze mois, graines 1 à 3 : la pire heure tombe de
  91,5 % à **69,5 %**, et onze passes du 16 sur douze prévoient entre 69,5 et 74,8 %, sous les
  80 % qui les font échouer (D39 r3). Un rouge par mois : c'est défaire D38 r3, et la mesure dit
  pourquoi elle existe.
- *Tenir la règle provisoire pour toujours.* Le zéro euro reposerait sur l'attention, ce que
  [D8](#d8--garde-fous-de-coût-avant-le-premier-appel) refuse. Et une passe du 16 coupée, non
  reprise, relâche quand même le plancher des mois suivants.
- *Une table d'une ligne par appel.* Exacte, et le passage de minuit s'y règle seul. Mais c'est
  une table pour un seul chiffre, alors qu'un journal par exécution est voulu de toute façon —
  D48 et D50 l'attendent, et les logs Actions qui tiennent lieu d'historique expirent à 90 jours.
  Il porte le même compte. Et le passé ne s'y reconstitue pas sans inventer 2 700 lignes à des
  instants qu'aucun log ne donne.
- *Un compteur par période*, une ligne par mois. Exact, mais un chiffre sans détail : le jour où
  il diverge de la console, rien ne dit quelle exécution s'est trompée.
- *Plusieurs tampons par cellule.* Remet le registre de dépense dans la table que les nettoyages
  touchent, la raison même du plancher, et la fait grossir sans fin.
- *Une ligne de `sweep_run` par exécution.* `sweep_run` est l'identité du plan : l'application,
  `cron-refresh`, `match:sirene` et la simulation le choisissent par `started_at`. Y mêler les
  exécutions confondrait le plan et ses passages, la confusion même qui a produit le défaut.
- *Lire la consommation chez Google*, par les métriques d'usage du projet. La source exacte, mais
  un compte de service et un secret de plus, une autre API dans le chemin du garde-fou dont il
  faudrait vérifier la gratuité, des métriques qui ne sont pas instantanées, et un périmètre par
  projet qui ne voit pas mieux que nous les autres projets du compte de facturation (C9). La
  console reste la vérification humaine.

**Décision.**
1. **Un journal des exécutions** : une ligne par exécution du balayage en `--go`, refus compris.
   Le mode sec n'y écrit rien. Les lignes écrites à la main — le passé, une réconciliation — y
   sont marquées comme telles et disent leur source.
2. **Chaque appel est réservé avant d'être fait.** Une instruction incrémente le compte d'appels
   de la ligne de l'exécution ; la requête ne part que si elle a réussi. Un échec de la
   réservation arrête l'exécution, en défaut au sens de D39. Un appel réservé mais jamais parti
   surcompte d'un : c'est le sens sûr.
3. **La dépense d'une période est la somme des appels de ses lignes**, toutes exécutions et tous
   plans confondus, lignes à la main comprises. Le plafond est imputé du maximum de cette somme
   et des cellules tamponnées dans la période : c'est la somme, sauf si des appels ont échappé au
   journal (règle 5). Le plancher tiré de `sweep_run` disparaît.
4. **Une exécution appartient à une passe d'une période.** Elle s'arrête, comme sur un plafond,
   avant le premier appel qui tomberait dans une autre passe, ou à moins d'une minute de minuit
   Pacifique en fin de période. Tous ses appels sont donc dans la période de sa ligne, et la
   minute laisse la requête arriver chez Google avant la bascule. Aucune passe planifiée
   ne franchit ces bornes : seule une exécution manuelle lancée en fin de mois ou le 15 au soir,
   heure du Pacifique, s'y arrête.
5. **Deux contrôles remplacent celui de `ledgerLossMessage`**, tous deux dans le sens inverse de
   l'ancien — rien n'a dépensé sans réserver :
   - les cellules tamponnées dans la période ne dépassent pas les appels qu'elle a réservés, à un
     près : un appel réservé avant minuit dont la réponse arrive après ;
   - `sweep_run.calls_made` d'un plan ne dépasse pas la somme du journal pour ce plan.

   Un écart, c'est une dépense qui n'est pas passée par le journal : un ancien code lancé d'un
   poste, ou une ligne effacée ou modifiée. Le balayage refuse, et son message dit la sortie :
   établir en console la dépense réelle, l'écrire au journal par une ligne à la main qui en donne
   la source, puis relancer.
6. **`sweep_run` reste la ligne du plan**, colonnes et sens inchangés. `calls_made` reste le total
   du plan, mais il est réécrit à chaque fin d'exécution comme la somme du journal pour ce plan,
   au lieu d'être incrémenté à part. Ses 2 700 appels ne sont ni effacés ni remis à zéro.
7. **Le passé entre au journal**, par des lignes à la main, dans la migration :
   - août : 900, le premier balayage des 28 et 29 août (UTC), lancé d'un poste ;
   - septembre : 737, le run `33515957346` du 1er ; 163, le lancement local du 4, sans run ;
   - octobre : 900, le run `36887894355` du 1er.

   Leur somme doit égaler `sweep_run.calls_made` au moment où la migration s'applique, sinon elle
   s'annule. Une exécution de l'ancien code entre-temps — la passe du 1er novembre, si la
   migration vient après — y entre de la même façon, d'après son log.
8. **La migration est appliquée à la main en production, avant la fusion**, en une transaction :
   la table, **la RLS activée sans politique**, les lignes du passé, la vérification de la somme.
   - Avant la fusion et non après : `sweep.yml` exécute le code de `main` à chaque planification,
     que le déploiement Vercel ait eu lieu ou non.
   - Ni le 1er ni le 16 avant que la passe du jour ait fini.
   - Seule : la migration commune de D41, D42 et D45 n'a pas de date, celle-ci en a une.
9. **Le code est sur `main` avant le 16 novembre 2026, 09:00 UTC.** D'ici là, la règle provisoire
   tient : aucun `--go` ni `workflow_dispatch` de `sweep.yml` entre le 16 et la fin du mois
   Pacifique.

**Conséquences.**
- Les trois scénarios du tableau se lisent juste. Rejoués avec la lecture de la règle 3, la
  période vaut 900 après deux passes, une passe du 16 coupée se reprend jusqu'à 900, et le
  décembre qui suit lit 900 et n'autorise rien.
- La règle 4 de D38 redevient vraie une fois le code construit : le plafond de la période borne ce
  qu'un mois dépense, relances comprises. Une passe du 16 manquée ou coupée se rattrape avant la
  fin du mois (C6).
- Un nouveau plan (C8) ne remet rien à zéro : la période se lit sur le journal, pas sur le plan.
- Une instruction de plus par appel, à côté de celles que chaque appel écrit déjà.
- **La RLS n'est pas une formalité.** Mesuré le 26 octobre en lecture seule : les privilèges par
  défaut du schéma `public` donnent tous les droits à `anon` et `authenticated` sur toute table
  nouvelle, et seule la RLS, active sur les cinq tables sans aucune politique, les en prive. Une
  table créée en SQL sans elle serait modifiable par la Data API avec la clé publiable, qui est
  une variable publique du dépôt. Effacer des lignes du journal, c'est rouvrir le plafond.
- Le journal donne l'historique que les logs Actions perdent. La vérification de
  [D50](#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour) le lit, et ne compte pas un refus
  comme une passe. La part de lieux renvoyés avec horaires de
  [D48](#d48--une-base-sans-échéance-ne-passe-pas-pour-fraîche) r2 s'y consigne.
- `loggedFloor`, `LoggedRun` et `LEDGER_SLACK` disparaissent avec leurs tests ; les cas du tableau
  deviennent des tests. La section coût de `CLAUDE.md` se met à jour avec le code.
- **Ce qui reste invisible** : un ancien code tué sans rien écrire et qui n'aurait fait que
  racheter ; un autre projet du même compte de facturation (C9). La console reste le dernier mot.

Le contenu du journal, la migration et les critères d'acceptation, jouables à sec sur une copie,
vivent dans [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 5.
