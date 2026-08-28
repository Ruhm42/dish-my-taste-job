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

| Approche | Appels pour ~4 000 établissements | Premier passage | Chaque mois |
|---|---|---|---|
| `Place Details` | ~4 000 | ~60 $ | ~60 $ |
| **`Nearby Search`** | **~400** | **0 €** | **0 €** |

**Mesuré sur le terrain** (Cordeliers, rayon 300 m, un seul appel) : **20 établissements
renvoyés, dont 18 avec leurs horaires**. Soit 90 % de couverture sur des données lyonnaises
réelles — ce qui lève le principal risque du projet, celui d'une couverture horaires trop
faible pour que le filtrage ait un sens.

400 appels, c'est 40 % du quota gratuit mensuel. Il reste donc de la marge pour une reprise
après incident ou un second passage de contrôle dans le même mois.

### Conséquence en cascade sur la conformité

Les conditions d'utilisation limitent la conservation du contenu Places à **30 jours**
(l'identifiant de lieu seul étant stockable indéfiniment). Puisqu'un balayage complet coûte
400 appels et qu'on en a 1 000 gratuits par mois, on peut **re-balayer intégralement tous les
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
| `SearchNearbyRequest` | 75 000 | **500** | Le seul appel utilisé |
| `GetPlaceRequest` | 125 000 | **0** | Place Details : 1 lieu par appel |
| `SearchTextRequest` | 75 000 | **0** | Plus cher, sans gain |
| `AutocompletePlacesRequest` | 175 000 | **0** | Non utilisé |
| `GetPhotoMediaRequest` | 175 000 | **0** | Palier très cher, non utilisé |

> **Correction d'une erreur de cette spec.** Un plafond de ~100/jour y était initialement
> écrit. C'était faux : un balayage complet consomme ~400 appels **en une seule
> exécution**, il aurait donc échoué. 500/jour laisse passer un sweep avec de la marge, tout
> en restant 150 fois sous le défaut.

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

## Le crédit d'ouverture

Un nouveau compte Google Cloud reçoit **300 $ valables 90 jours**. À 35 $ les 1 000 appels
Nearby Search Enterprise, cela représente ~8 500 appels supplémentaires.

**Ce crédit est un filet pour la mise au point, pas le modèle de fonctionnement.** Le régime
permanent n'en a pas besoin : il tient dans le quota gratuit récurrent. Le crédit sert à
absorber les tâtonnements des premiers balayages — maillage mal calibré, script relancé,
subdivisions imprévues.

Le compte d'essai se ferme automatiquement à l'épuisement du crédit ou au bout de 90 jours,
sans basculer en payant sans action explicite. Une carte bancaire reste néanmoins exigée pour
activer les API, même en usage 100 % gratuit — les garde-fous ci-dessus restent donc la vraie
protection.

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
- Consommation Enterprise ≈ 400, et **aucune consommation sur le palier Atmosphere**
- Aucun dépassement de quota journalier

Un écart significatif entre le `--dry-run` et le réel est un signal à traiter : soit le
maillage est mal calibré, soit le script rejoue des cellules.
