# Budget Google et garde-fous

> **Statut** : acté · **Dernière mise à jour** : 2026-10-17

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

> **Trois affirmations de ce paragraphe sont fausses, relevé le 17 octobre 2026.**
> - Le balayage complet ne coûte pas 692 appels ; il n'a jamais tenu dans un mois (D22), et
>   c'est une couverture du contenu, ~700 appels, qui le rafraîchit
>   ([D36](../DECISIONS.md#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt)).
> - Le calage au 1er ne fait pas précéder l'expiration sept mois sur douze : un mois de 31 jours
>   dépasse 30 jours de conservation, et toute la base s'éteint 17 à 30 heures. Le cycle passe
>   le 1er et le 16 ([D38](../DECISIONS.md#d38--deux-passages-par-mois-le-1er-et-le-16)).
> - Une purge est nécessaire : l'affichage respectait l'échéance, pas le stockage
>   ([D45](../DECISIONS.md#d45--purger-ce-qui-a-expiré-et-reconnaître-ce-que-google-ne-renvoie-plus)).
>
> Et la prémisse elle-même — 30 jours pour « le contenu Places » — est mise en question : les
> conditions n'accordent ce délai qu'à la latitude et à la longitude. Voir
> [`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md), axe 0, ouvert.

---

## Le piège du field mask

La facturation s'applique au **champ le plus cher demandé** dans la requête. Un seul
`places.rating` ou `places.reviews` ajouté par mégarde fait basculer l'appel sur le palier
Enterprise + Atmosphere, plus cher.

**Règle** : la liste des champs est une **constante unique, partagée, jamais construite
dynamiquement**. Aucune concaténation, aucun champ conditionnel. Toute modification est une
décision consciente, vérifiée en console de facturation avant et après.

> **Correction, vérifiée le 17 octobre 2026** dans *Place Data Fields (New)* : `places.rating`
> relève du palier **Enterprise**, pas d'*Enterprise + Atmosphere*. Le piège porte sur
> `reviews`, `editorialSummary`, les `serves…`, `dineIn`, `takeout`, `delivery` et consorts.
>
> **Champs ajoutés par [D43](../DECISIONS.md#d43--trois-champs-de-plus-dans-le-masque-au-même-palier)**,
> en une seule modification : `places.regularSecondaryOpeningHours` (horaires de cuisine),
> `places.userRatingCount`, `places.websiteUri`. Tous trois déclenchent *Nearby Search
> Enterprise*, comme `places.regularOpeningHours` : zéro dollar de plus par appel. Contrôle au
> passage suivant : Enterprise égal au nombre d'appels, **rien sur Atmosphere**.
>
> **Annoté le 17 octobre 2026, au soir.** Le paragraphe précédent décrit D43 comme fait ; elle
> ne l'est pas.
> - Le masque compte toujours ses neuf champs, sans les trois de D43.
> - D43 attend l'axe 0, et aucun de ces trois champs n'est demandé.
> - Aucun test ne fige le masque.
> - Le commentaire du code sur `places.rating` reprend l'erreur corrigée ci-dessus.

---

## Les quatre garde-fous

À poser **avant le premier appel**, pas après le premier incident. Le calcul théorique peut
être juste et le code buggé : une boucle accidentelle génère une facture en quelques minutes.

**1. Quotas durs côté Google.** — *posés et vérifiés le 2026-08-28*

Plafonds journaliers par projet, sur la métrique `SearchNearbyRequest` et sur celles des
appels qu'on s'est interdits :

| Métrique | Défaut | Plafond posé | Pourquoi |
|---|---|---|---|
| `SearchNearbyRequest` | 75 000 | **1 000** | Le seul appel utilisé |
| `GetPlaceRequest` | 125 000 | **0** | Place Details : 1 lieu par appel |
| `SearchTextRequest` | 75 000 | **0** | Plus cher, sans gain |
| `AutocompletePlacesRequest` | 175 000 | **0** | Non utilisé |
| `GetPhotoMediaRequest` | 175 000 | **0** | Palier très cher, non utilisé |

> **Trois corrections successives de cette spec.** Un plafond de ~100/jour y figurait
> d'abord : faux, un balayage s'exécute d'un seul tenant. Puis 500/jour, avant que la mesure
> ne révèle un besoin réel de ~650 appels par balayage. Puis 800/jour — mais le plafond
> local du script était fixé à 900, donc **au-dessus** : c'était le `HTTP 429` opaque de
> Google qui se serait déclenché en premier, en plein milieu du balayage, et jamais notre
> message explicite.

### L'ordre de déclenchement compte autant que les valeurs

```
compteur du script (900)  <  quota Google journalier (1 000)  =  quota mensuel gratuit
```

Trois propriétés découlent de cet ordre :

1. **Notre garde-fou parle avant celui de Google.** Un dépassement produit un message qui
   nomme la cause, pas un code d'erreur à décoder.
2. **Un balayage ne peut à lui seul provoquer aucune facturation** : 900 appels restent sous
   les 1 000 gratuits mensuels, même si toutes les subdivisions sont consommées.
3. Le plafond journalier Google reste le filet dur, indépendant de la qualité du code.

Un plafond journalier ne protège pas du cumul mensuel — ce rôle revient au verrou de 25
jours entre deux balayages et à l'alerte budget.

> **Annoté le 17 octobre 2026.** Le verrou de 25 jours est retiré (D38 r4). Le cumul mensuel est
> borné par le plafond de la **période** (D28), le mois du Pacifique (D47).
>
> Ce plafond ne garantit plus la dépense réelle depuis D38. La passe du 16 rachète des cellules
> que le 1er a tamponnées, et le compteur sous-compte la période. La propriété 2 ci-dessus tient
> pour une exécution, plus pour un mois.
>
> Voir [`14-cycle-d-import-mensuel.md`](14-cycle-d-import-mensuel.md) § 4 et
> [`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md), C1.

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

> **Annoté le 17 octobre 2026.** La valeur posée est **1 000** par jour, d'après la table
> *posés et vérifiés* ci-dessus ; le 800 est celui de D15.
>
> À ce plafond, une clé qui fuit coûterait jusqu'à environ 1 015 à 1 050 $ par mois : le
> plafond borne la méthode, pas le palier, et l'alerte budget ne bloque rien.
>
> Google agrège par ailleurs l'usage de tous les projets liés au compte de facturation. Les
> plafonds n'ont pas été relus en console depuis le 29 août
> ([`PROCHAINES-ETAPES`](../PROCHAINES-ETAPES.md), C9).

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
- Consommation Enterprise ≈ le nombre d'appels des passages du mois (≤ 900), et **aucune
  consommation sur le palier Atmosphere**
- Aucun dépassement de quota journalier

Un écart significatif entre le `--dry-run` et le réel est un signal à traiter : soit le
maillage est mal calibré, soit le script rejoue des cellules.
