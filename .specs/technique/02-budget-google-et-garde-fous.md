# Budget Google et garde-fous

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

**Contrainte ferme du projet : zéro euro.** Cette spec explique comment on la tient, et
pourquoi ce n'est pas une question de vigilance mais d'architecture.

---

## Le modèle tarifaire

Depuis mars 2025, Google Maps Platform a remplacé le crédit mensuel unique de 200 $ par un
**quota gratuit par SKU, renouvelé chaque mois** :

| Palier | Appels gratuits / mois |
|---|---|
| Essentials | 10 000 |
| Pro | 5 000 |
| **Enterprise** | **1 000** |

Le champ `regularOpeningHours` relève du palier **Enterprise**. C'est donc 1 000 appels
gratuits par mois qui cadrent tout le projet.

Tarifs au-delà du quota (par tranche de 1 000, premier palier de volume) :

| SKU | Prix |
|---|---|
| Place Details Enterprise | 20 $ |
| Nearby Search Enterprise | 35 $ |
| Text Search Enterprise | 35 $ |
| Dynamic Maps (Essentials) | ~7 $ |

---

## Le verrou : 20 établissements par appel, pas 1

C'est la décision qui rend le projet gratuit (D5).

`Place Details` renvoie **un** lieu par appel. `Nearby Search` accepte exactement le même
champ `regularOpeningHours`, sur le même palier Enterprise, et renvoie **jusqu'à 20 lieux
par appel**.

| Approche | Appels pour le périmètre retenu | Premier passage | Chaque mois |
|---|---|---|---|
| `Place Details` | ~6 100 | ~180 $ | ~180 $ |
| **`Nearby Search`** | **692** | **0 €** | **0 €** |

*Chiffres mesurés, pas estimés* : 6 129 établissements géocodés sur Lyon 1er-9e +
Villeurbanne (D16), découpés en 692 cellules par courbe de Hilbert sous plafond de rayon
(D17).

**Mesuré sur le terrain** (Cordeliers, rayon 300 m, un seul appel) : **20 établissements
renvoyés, dont 18 avec leurs horaires**. Soit 90 % de couverture sur des données lyonnaises
réelles — ce qui lève le principal risque du projet, celui d'une couverture horaires trop
faible pour que le filtrage ait un sens.

692 appels, c'est 69 % du quota gratuit mensuel — il reste **308 appels de marge** pour
absorber les subdivisions déclenchées par une troncature, ou une reprise après incident.

> Cette marge est plus étroite que prévu initialement, et c'est ce qui a imposé de resserrer
> le périmètre géographique (D16). Sur les 58 communes de la Métropole, il aurait fallu
> 1 200 à 1 900 appels — au-delà du gratuit.

### Conséquence en cascade sur la conformité

Les conditions d'utilisation limitent la conservation du contenu Places à **30 jours**
(l'identifiant de lieu seul étant stockable indéfiniment). Puisqu'un balayage complet coûte
692 appels et qu'on en a 1 000 gratuits par mois, on peut **re-balayer intégralement tous les
mois**.

La donnée n'a donc jamais plus de 30 jours : **la conformité est obtenue par construction**,
pas par une politique de purge qu'il faudrait penser à appliquer. Le balayage est calé au
1er du mois pour que le remplacement précède toujours l'expiration.

---

## Le piège du field mask

La facturation s'applique au **champ le plus cher demandé** dans la requête. Un seul
`places.rating` ou `places.reviews` ajouté par mégarde fait basculer l'appel sur le palier
Enterprise + Atmosphere, plus cher.

**Règle** : la liste des champs est une **constante unique, partagée, jamais construite
dynamiquement**. Aucune concaténation, aucun champ conditionnel. Toute modification est une
décision consciente, vérifiée en console de facturation avant et après.

---

## Les quatre garde-fous

À poser **avant le premier appel**, pas après le premier incident. Le calcul théorique peut
être juste et le code buggé : une boucle accidentelle génère une facture en quelques minutes.

**1. Quotas durs côté Google.** — *posés et vérifiés le 2026-08-28*

Plafonds journaliers par projet, sur la métrique `SearchNearbyRequest` et sur celles des
appels qu'on s'est interdits :

| Métrique | Défaut | Plafond posé | Pourquoi |
|---|---|---|---|
| `SearchNearbyRequest` | 75 000 | **800** | Le seul appel utilisé |
| `GetPlaceRequest` | 125 000 | **0** | Place Details : 1 lieu par appel |
| `SearchTextRequest` | 75 000 | **0** | Plus cher, sans gain |
| `AutocompletePlacesRequest` | 175 000 | **0** | Non utilisé |
| `GetPhotoMediaRequest` | 175 000 | **0** | Palier très cher, non utilisé |

> **Deux corrections successives de cette spec.** Un plafond de ~100/jour y figurait
> d'abord : faux, un balayage s'exécute d'un seul tenant. Puis 500/jour, avant que la mesure
> ne révèle un besoin réel de **692 appels** par balayage. Le plafond est à **800/jour** —
> assez pour un sweep complet en une exécution, et toujours 94 fois sous le défaut.

**Les quatre métriques à zéro rendent la décision D5 structurelle** : un `Place Details`
appelé par erreur ne coûte rien, il échoue. Ce n'est plus une convention à respecter, c'est
une contrainte appliquée par Google.

*Vérifié en conditions réelles* : `Nearby Search` répond `HTTP 200`, `Place Details` répond
`HTTP 429 — RESOURCE_EXHAUSTED, Quota exceeded for quota metric 'GetPlaceRequest'`.

**C'est la seule protection qui ne dépend de personne.** Les autres sont des pratiques ;
celle-là est appliquée par la plateforme, indépendamment de la qualité du code.

**2. Alerte budget à 1 $.**
Sur le compte de facturation. Ne bloque rien, mais transforme une dérive silencieuse en
notification immédiate.

**3. Clé API restreinte.**
Restreinte à la seule Places API, utilisée exclusivement côté serveur, jamais exposée au
navigateur. La clé de la carte Google Maps est distincte, restreinte par domaine référent.

**4. `--dry-run` sur tout script consommant du quota.**
Le script calcule et affiche le nombre d'appels qu'il *ferait*, sans en émettre un seul.
**Le coût est toujours connu avant d'être engagé, jamais découvert après.**

---

## Il n'y a pas de filet

Un nouveau compte Google Cloud reçoit habituellement 300 $ valables 90 jours. **Ce n'est pas
le cas ici** : le compte de facturation utilisé est un compte payant classique, l'essai
gratuit ayant déjà été consommé sur un compte aujourd'hui fermé.

Conséquence directe : **tout dépassement du quota gratuit part sur la carte bancaire, dès le
premier euro.** Les plafonds de quota ne sont donc pas une précaution supplémentaire — ils
sont la seule chose qui sépare le projet d'une facture.

C'est ce qui justifie leur sévérité : 800 appels par jour là où le défaut en autorise 75 000,
et zéro sur tout ce que l'architecture n'utilise pas.

---

## La carte

Dynamic Maps relève du palier **Essentials : 10 000 chargements gratuits par mois**, très
au-dessus des besoins d'un outil privé (D9).

**Précaution impérative** : un « chargement » se compte à chaque instanciation de carte, pas
au déplacement ni au zoom. La carte doit être **instanciée une seule fois par visite**, et
seuls les marqueurs sont mis à jour. Une implémentation qui recrée la carte à chaque
changement de filtre consommerait un chargement par clic.

---

## Vérification après chaque balayage

- Appels réellement consommés **vs** annoncés par le `--dry-run`
- Consommation Enterprise ≈ 692, et **aucune consommation sur le palier Atmosphere**
- Aucun dépassement de quota journalier

Un écart significatif entre le `--dry-run` et le réel est un signal à traiter : soit le
maillage est mal calibré, soit le script rejoue des cellules.
