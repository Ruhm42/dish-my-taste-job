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

## D25 — Liens sortants vers les sites d'offres, par métier et jamais par établissement

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
