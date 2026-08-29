# `.specs` — Référence du projet Dish My Taste Job

Ce dossier est **la source de vérité** du projet : ce qu'on construit, pourquoi, et ce qu'on
a décidé de ne pas faire. Il est versionné et se lit avant le code.

## Le projet en trois lignes

Un professionnel de la restauration cherche un emploi. Il postule en candidature spontanée,
donc il doit **cibler les bons établissements** — et son critère n°1 est le rythme de travail :
pas de coupure, week-ends libres, jours de repos consécutifs. Aucun annuaire ne permet de
filtrer là-dessus. On le construit, sur la Métropole de Lyon.

## Organisation

| Fichier | Contenu |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Journal des décisions actées, avec les options écartées |
| [`PROCHAINES-ETAPES.md`](PROCHAINES-ETAPES.md) | État mesuré et axes à arbitrer — brouillon, rien n'y est acté |
| [`fonctionnel/`](fonctionnel/) | Ce que l'outil fait, du point de vue de celui qui s'en sert |
| [`technique/`](technique/) | Comment il le fait |

### Fonctionnel
- [`00-vision-et-perimetre.md`](fonctionnel/00-vision-et-perimetre.md) — objectif, public, **hors périmètre**
- [`01-authentification.md`](fonctionnel/01-authentification.md) — login, allowlist
- [`02-recherche-carte-liste.md`](fonctionnel/02-recherche-carte-liste.md) — l'écran principal
- [`03-pipeline-candidatures.md`](fonctionnel/03-pipeline-candidatures.md) — suivi des démarches
- [`04-carte.md`](fonctionnel/04-carte.md) — **ce que la carte montre**, et ce qu'elle ne montre jamais

### Technique
- [`00-architecture.md`](technique/00-architecture.md) — vue d'ensemble
- [`01-sources-de-donnees.md`](technique/01-sources-de-donnees.md) — Google Places, SIRENE, BAN
- [`02-budget-google-et-garde-fous.md`](technique/02-budget-google-et-garde-fous.md) — **le verrou économique**
- [`03-algorithme-de-balayage.md`](technique/03-algorithme-de-balayage.md) — maillage adaptatif et troncatures
- [`04-modele-de-donnees.md`](technique/04-modele-de-donnees.md) — schéma
- [`05-inference-des-horaires.md`](technique/05-inference-des-horaires.md) — **le cœur fonctionnel**
- [`06-pipeline-ingestion.md`](technique/06-pipeline-ingestion.md) — les scripts et leur ordre
- [`07-stack-et-tests.md`](technique/07-stack-et-tests.md) — technos, vérification
- [`08-infrastructure.md`](technique/08-infrastructure.md) — comptes, clés, **ce qu'il y a à faire à la main**
- [`09-deploiement.md`](technique/09-deploiement.md) — où tourne quoi, tâches planifiées, **ce qui s'éteint tout seul**
- [`10-reprise-du-balayage.md`](technique/10-reprise-du-balayage.md) — **quand un balayage dure plus qu'un quota**, et la péremption des horaires

## Conventions d'écriture

**En-tête obligatoire** en haut de chaque spec :

```
> **Statut** : acté · **Dernière mise à jour** : 2026-08-28
```

Statuts possibles : `brouillon` (en cours de rédaction, ne pas s'y fier), `acté` (décidé, on
construit dessus), `obsolète` (conservé pour l'historique, remplacé par — lien).

**Une spec décrit le quoi et le pourquoi, jamais le code.** Pas d'extrait d'implémentation,
pas de signature de fonction. Les noms de tables et de champs n'apparaissent que dans
`technique/` ; si un nom technique se glisse dans `fonctionnel/`, c'est un bug de spec.

**Toute décision structurante ouvre une entrée dans `DECISIONS.md`**, au format
*contexte → options écartées → décision → conséquences*. Une décision sans alternative
écartée n'est pas une décision, c'est une note. C'est ce qui évite de re-débattre dans six
mois — et ce qui permet de savoir, quand le contexte change, laquelle des options écartées
redevient valable.

**On ne réécrit pas l'histoire.** Une décision annulée passe en `obsolète` et une nouvelle
entrée explique le revirement. Le journal doit rester lisible comme une chronologie.

## Rapport au dépôt

`.specs` est **versionné** — surtout pas dans `.gitignore`. Il est simplement exclu du build
applicatif. Le premier commit du dépôt ne contient que ce dossier : le projet commence par
ses specs, le `package.json` vient après.
