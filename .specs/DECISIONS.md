# Journal des décisions

> **Statut** : acté · **Dernière mise à jour** : 2026-09-04

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

## D34 — La position vient du navigateur, et on ne la demande jamais à froid

**Contexte.** La carte dit où sont les établissements, jamais où est le lecteur, alors que le
produit est fait pour une tournée à pied avec un téléphone à la main. Afficher sa position
demande de trancher trois choses distinctes : d'où vient la position, quand on la demande, et
combien de temps on la suit.

**Options écartées**
- *La `Geolocation API` de Google* — payante, et plafonnée à 0 appel/jour de notre côté
  précisément pour qu'elle ne puisse pas facturer. Le navigateur rend le même service
  gratuitement, sans passer par notre clé ni par notre quota. Il n'y avait rien à acheter.
- *La géolocalisation par adresse IP* — situe au quartier près dans le meilleur des cas, et
  se trompe de ville dès qu'un opérateur mobile s'en mêle. À l'échelle qui compte ici — le
  bon côté de la rue — c'est une précision qui ment, et elle mentirait sans le dire.
- *Demander la permission à l'arrivée sur la carte* — écarté sur la conséquence, pas sur le
  principe : un refus est **définitif du point de vue du navigateur**, qui cesse ensuite de
  proposer quoi que ce soit. Une popup gagnée à l'arrivée se paie donc en fonctionnalité
  perdue pour toute la durée de vie du navigateur, chez quelqu'un qui n'avait encore aucune
  raison de dire oui.
- *Un relevé unique au clic* — le point devient faux au premier pâté de maisons, c'est-à-dire
  pendant l'usage même auquel il est destiné. Un point figé qui a l'air juste est le mode de
  panne que ce projet refuse partout.
- *Un suivi permanent, dès l'autorisation obtenue* — le GPS est le poste le plus coûteux en
  batterie d'un téléphone, et le public est dehors toute la journée. Faire tourner un relevé
  pour une carte que personne ne regarde ne coûte rien à personne, sauf au lecteur.
- *Faire entrer la position dans l'adresse de la page* — les filtres y sont pour qu'une
  recherche se mette en favori et s'envoie à quelqu'un (voir `fonctionnel/02`). Une position
  est une donnée personnelle : elle n'a rien à faire dans un lien qu'on partage.
- *Trier ou filtrer les résultats par distance* — hors périmètre pour l'instant, et pas
  gratuit : la pagination est soudée au curseur `(nom, id)`, un tri par distance demande un
  curseur composite. La position s'affiche, elle ne décide de rien.

**Décision.** `navigator.geolocation` du navigateur. La fenêtre de permission n'est levée que
par un clic sur *Me localiser*, jamais à l'arrivée ; mais une permission **déjà accordée** est
réutilisée en silence à la visite suivante. Le suivi est continu tant que la carte est à
l'écran et que la page est au premier plan, et s'arrête sinon. La position s'affiche — un
point bleu et son cercle de précision — et ne modifie ni le tri, ni les filtres, ni
l'ensemble des résultats.

**Conséquences.** Coût nul et strictement hors quota : la règle de `04-carte.md` — le coût est
adossé au nombre de balayages, jamais au nombre de visites — tient sans modification.

Le bleu est disponible : la palette des verdicts est vert, lime, ambre, rouge et pierre, donc
le point ne peut pas être lu comme un risque de coupure. Il entre néanmoins dans la légende,
parce que sur cette carte une couleur veut toujours dire quelque chose.

**Point d'attention.** Le vrai sujet n'est pas d'afficher un point, c'est de dire quand il
n'en est pas un. Un point bleu figé au mauvais endroit est indiscernable d'un point juste, ce
qui en fait exactement le défaut silencieux contre lequel le reste du projet est construit.
Chaque état de non-fonctionnement — refus, page non sécurisée, navigateur sans la fonction,
signal perdu, précision inexploitable, position hors secteur — a donc un message qui nomme le
remède, et le bouton **disparaît** là où plus aucun clic ne peut aboutir. Un signal perdu
conserve le dernier point et le déclare tel : l'effacer perdrait une information encore utile,
le laisser sans un mot serait le mensonge.

**Conséquence sur les tests.** La logique de permission vit dans un module pur, séparée du
branchement au navigateur, parce que le projet n'a pas d'environnement DOM de test et que
toutes les suites existantes portent sur une fonction pure. C'est la partie qui décide qui est
vérifiée, pas celle qui appelle.
