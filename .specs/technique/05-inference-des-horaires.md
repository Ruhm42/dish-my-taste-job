# Inférence des horaires

> **Statut** : acté · **Dernière mise à jour** : 2026-10-17

Le cœur fonctionnel du projet, et sa seule vraie difficulté conceptuelle.

---

## Le principe : horaires d'ouverture ≠ horaires de travail

Un restaurant ouvert `12h-14h30 / 19h-22h30` **n'impose pas nécessairement une coupure à ses
salariés**. Tout dépend du nombre de brigades :

- À 25 salariés, deux équipes se relaient. Personne ne coupe.
- À 4 salariés, c'est mécaniquement impossible. Tout le monde coupe.

Filtrer sur les horaires bruts produirait donc des **faux négatifs en masse** : on écarterait
la majorité des brasseries, dont beaucoup offrent pourtant des services d'affilée. C'est
pour cette raison, et uniquement celle-là, qu'on croise avec l'effectif SIRENE (D4).

---

## Étape 1 — Normalisation des horaires Google

Quatre pièges, à couvrir par des tests **avant** d'écrire quoi que ce soit d'autre :

| Piège | Comportement |
|---|---|
| **Numérotation des jours** | `0` = dimanche, pas lundi |
| **Fermeture après minuit** | La fermeture porte le jour **suivant**. Un service finissant à 1h30 dans la nuit de samedi à dimanche a une fermeture datée au dimanche |
| **Ouverture continue** | Un établissement 24h/24 renvoie une ouverture **sans fermeture associée** |
| **Période de plusieurs jours** | Des jours consécutifs « ouverts 24h/24 » arrivent fusionnés en **une seule** période : vendredi 15h → dimanche 0h, c'est vendredi soir **et** tout le samedi |

Cas normaux à traiter sans erreur : un jour fermé est simplement **absent** de la liste des
périodes ; un établissement peut n'avoir **aucun horaire renseigné**.

**Convention de sortie** : minutes depuis minuit du jour d'ouverture, la fermeture pouvant
dépasser 1440. Fermeture à 1h30 → `1530`. Aucune gymnastique de date par la suite.

Une période de plusieurs jours est **découpée à chaque minuit qu'elle franchit, sauf le
dernier** : la fermeture finale reste au jour précédent, au-delà de 1440, exactement comme une
fermeture après minuit ordinaire. Lundi 11h → mercredi 1h donne lundi `660-1440` et mardi
`0-1500`. Une période d'une seule nuit ne change donc pas : samedi 23h → dimanche 7h reste au
samedi, et le dimanche reste fermé — c'est aussi ce qu'affiche Google.

> **Mesuré le 17 octobre 2026** sur les 3 730 horaires en base : 11 établissements portaient une
> telle période. Rangée en entier sous son jour d'ouverture, elle faisait passer pour fermés
> tous les jours qu'elle couvre — 3 « week-end libre » et 5 « 2 jours de repos d'affilée »
> faux, et un café ouvert six jours sur sept lu fermé six jours.
>
> *Option écartée : déclarer ces horaires inexploitables.* Google les décrit sans ambiguïté
> (« Saturday: Open 24 hours »), et avec le découpage les jours fermés concordent avec ceux
> qu'affiche Google sur **les 3 730 horaires** — 11 écarts avant. Les écarter aurait retiré des
> fiches justes pour un défaut qui était le nôtre.

---

## Étape 2 — Détection de la coupure d'ouverture

Pour chaque jour, fenêtres triées, on regarde l'écart entre chaque paire consécutive :

```
écart = ouverture(n+1) − fermeture(n)
si écart ≥ SEUIL_COUPURE  →  le jour comporte une coupure
```

**`SEUIL_COUPURE` = 120 minutes**, valeur configurable.

> Le seuil compte, et 120 minutes n'est pas arbitraire. Un écart de 14h30 à 19h fait 270
> minutes : c'est une vraie coupure, le salarié rentre chez lui. Un écart de 14h30 à 15h30
> fait 60 minutes : c'est une respiration de service, elle ne libère personne et ne doit pas
> compter. Le seuil est à réajuster après confrontation au terrain — d'où sa configurabilité.

**La fin de la nuit précédente n'est pas un service.** Google range parfois la fin d'un
service du soir sous le jour suivant : « Monday: 12:00 – 3:00 AM, 11:00 AM – 11:59 PM ». Lue
comme un service, la fenêtre `0h-3h` fait de l'attente jusqu'à 11h une coupure de huit heures.
Une fenêtre qui **ouvre à minuit et ferme au plus tard à 6h** est donc ignorée pour décider de
la coupure, du type de service et de l'explication — mais elle laisse le jour ouvert : les
jours de repos ne bougent pas. Seule, elle reste le service du jour (une boîte de nuit saisie
« 0h-5h »).

> Mesuré le 17 octobre 2026 : 3 verdicts « Coupure possible » ne tenaient qu'à cette fenêtre.

---

## Étape 3 — Du jour à la personne

C'est ici que se joue la valeur ajoutée : traduire une coupure **d'ouverture** en risque de
coupure **pour le salarié**.

### Tranches d'effectifs SIRENE

| Codes | Effectif | Groupe |
|---|---|---|
| `00`, `01`, `02` | 0 à 5 | Petit |
| `03`, `11` | 6 à 19 | Moyen |
| `12` et au-delà | 20 et plus | Grand |
| `NN` | Non renseigné | — |

### Règles

| Situation | `coupure_risk` | Raison |
|---|---|---|
| Aucun jour comportant une coupure | `aucun` | Service continu : physiquement pas de coupure possible |
| Un seul service par jour (midi **ou** soir) | `aucun` | Journée courte, rien à couper |
| Catégorie *restauration collective* | `aucun` | Rythme 7h-15h, ni coupure ni week-end |
| Coupure + petit effectif | `eleve` | Pas de quoi monter deux brigades |
| Coupure + effectif moyen | `moyen` | Deux équipes partielles envisageables |
| Coupure + grand effectif | `faible` | Deux brigades très probables |
| Aucun horaire renseigné | `inconnu` | Rien à déduire |

Les règles sont évaluées **dans cet ordre** : les trois premières sont des certitudes
structurelles qui court-circuitent le raisonnement sur l'effectif.

### Fiabilité

| Valeur | Quand |
|---|---|
| `confirme` | Horaires présents **et** effectif renseigné |
| `probable` | Horaires présents, effectif déduit par repli |
| `a_verifier` | Horaires absents ou incomplets |

Ces trois mots sont affichés tels quels dans l'interface. Aucun score numérique n'est
présenté à l'utilisateur, ni même stocké (voir [`04`](04-modele-de-donnees.md)).

### Le repli quand l'effectif est inconnu

La tranche d'effectifs vaut **`NN` dans 65,2 % des cas** (mesuré sur les 10 328
établissements lyonnais), et manque précisément chez les petites structures — là où
l'information est la plus décisive. **Le repli est donc le cas dominant, pas l'exception.**
C'est la principale limite de cette inférence, et elle doit rester visible.

Répartition mesurée des tranches renseignées : **60,6 % de petites équipes** (≤ 5 salariés),
32,5 % de moyennes, 6,9 % de grandes. Ce qui valide empiriquement le choix de replier vers
l'hypothèse « petite équipe » : c'est le cas le plus fréquent, pas seulement le plus
prudent.

Repli, dans l'ordre :
1. **Catégorie** — la restauration collective et la restauration rapide ont des rythmes
   caractéristiques indépendants de la taille.
2. **Amplitude hebdomadaire** — un établissement ouvert plus de 70 heures par semaine avec
   coupure tourne rarement à trois personnes ; on le rapproche du groupe moyen.
3. À défaut, `coupure_risk` prend la valeur prudente du groupe **petit** — l'hypothèse la
   plus fréquente en restauration indépendante — et la fiabilité passe à `probable`.

> On ne masque jamais une déduction faible derrière un verdict net. Un utilisateur qui voit
> *« Probable »* ira vérifier ; un utilisateur à qui on affirme *« Sans coupure »* à tort
> perdra une demi-journée et cessera de faire confiance à l'outil.

### Un cas particulier à signaler

Le code `00` désigne un établissement **sans salarié** : le gérant travaille seul. La coupure
y est certaine dès qu'il y a deux services — mais c'est aussi un établissement peu
susceptible d'embaucher. L'information mérite d'être exposée, pas de filtrer l'établissement.

---

## Étape 4 — Jours de repos

- `closed_days` : les jours sans aucune fenêtre d'ouverture.
- `max_consecutive_days_off` : parcours **circulaire** sur les sept jours — dimanche suivi de
  lundi compte comme deux jours consécutifs. Un établissement fermé dimanche et lundi est
  exactement le profil recherché ; un parcours linéaire le manquerait.

> **Nuance à afficher honnêtement** : un établissement fermé deux jours d'affilée ne garantit
> pas deux jours de repos consécutifs à chaque salarié. Mais c'est un **plancher** — et c'est
> exactement le raisonnement que fait un candidat quand il regarde une devanture.

---

## Étape 5 — Catégorie d'établissement

Dérivée des types Google, du code d'activité SIRENE et du nom :

| Catégorie | Indices |
|---|---|
| `collectivite` | Codes d'activité `56.29A` / `56.29B` |
| `rapide` | Type Google *fast food*, code `56.10C` |
| `bar` | Type Google *bar*, code `56.30Z` |
| `pizzeria`, `bistrot`, `brasserie`, `gastronomique` | Types Google de cuisine, mots du nom |

La catégorie sert à deux choses : c'est un filtre exposé à l'utilisateur, et c'est un
raccourci d'inférence — la restauration collective court-circuite tout le raisonnement sur la
coupure.

---

## Étape 6 — Explicabilité

**Chaque verdict affiche son raisonnement.** Pas :

> Risque de coupure : élevé

Mais :

> Coupure probable — ouvert 12h-14h30 puis 19h-22h30, 3 à 5 salariés

Ce n'est pas cosmétique. L'utilisateur est un professionnel du secteur : il connaît son
métier mieux que l'algorithme et repérera immédiatement une déduction absurde. Sans le
raisonnement affiché, il n'a aucun moyen de faire ce tri — et un outil qu'on ne peut pas
contredire est un outil qu'on cesse d'utiliser.

---

## Recalcul

**Cette inférence ne consomme aucun appel réseau.** Elle part des horaires brutes déjà
stockées. On peut donc réajuster le seuil de coupure, les tranches d'effectifs ou les règles
de repli, tout recalculer sur l'ensemble de la base, et comparer — sans dépenser un centime.

C'est délibéré : les règles ci-dessus sont des hypothèses à confronter au terrain, pas des
vérités. Elles évolueront.
