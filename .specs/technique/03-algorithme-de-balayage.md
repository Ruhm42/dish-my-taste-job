# Algorithme de balayage

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

## Le problème

`Nearby Search` a trois limites structurantes :

1. **20 résultats maximum** par appel
2. **Pas de pagination** — au-delà de 20, le reste est perdu
3. **Restriction circulaire uniquement** — centre + rayon, pas de rectangle ni de polygone

La troncature est **silencieuse** : rien dans la réponse ne signale qu'il manquait des
établissements. Et un restaurant absent de la base ne se voit pas dans l'interface — c'est
le pire type de bug, celui qui ne se manifeste jamais.

Il faut donc à la fois un maillage adaptatif **et** un moyen de savoir qu'on a tronqué.

---

## SIRENE pilote le maillage

L'idée qui rend le balayage efficace : **on sait déjà où sont les restaurants avant
d'interroger Google.**

SIRENE (gratuit, exhaustif) géocodé par la BAN (gratuit) donne la position d'environ 4 000
établissements. Le plan de balayage se calcule à partir de cette densité connue.

**Trois bénéfices**

- **Zéro appel gaspillé.** Aucun cercle n'est posé sur les zones sans restaurants — parcs,
  zones industrielles, communes résidentielles, soit l'essentiel des 534 km² de la Métropole.
- **Cellules calibrées.** Chaque cercle est dimensionné pour contenir **au plus 15
  établissements**, marge de sécurité sous la limite de 20.
- **Détecteur de troncature.** On sait combien d'établissements *devraient* remonter dans
  chaque cellule. Un écart important est un signal.

Sans cette étape, il faudrait partir d'une grande cellule et subdiviser à l'aveugle, en
dépensant des appels à chaque niveau.

---

## Détection de troncature par la distance

Deuxième mécanisme, indépendant du premier, qui ne dépend pas de la justesse de SIRENE.

Avec `rankPreference: DISTANCE`, l'API renvoie les 20 lieux **les plus proches du centre**.
La distance du 20ᵉ résultat révèle donc le **rayon réellement couvert** :

```
résultats = appel(centre, rayon_demandé)

si   longueur(résultats) == 20
et   distance(centre, résultats[19]) < rayon_demandé
alors
     la cellule est tronquée
     elle n'est couverte que jusqu'à distance(centre, résultats[19])
     → subdiviser en 4 et rejouer
```

Le raisonnement est exact : puisque les résultats sont triés par distance et qu'il y en a
exactement 20, tout établissement au-delà du 20ᵉ a été écarté. La zone entre cette distance
et le rayon demandé n'a donc pas été couverte.

L'algorithme est **auto-vérifiant et convergent** : chaque subdivision réduit la densité par
cellule, jusqu'à passer sous la limite.

En pratique, la Presqu'île et le Vieux Lyon descendront à des cercles de 50 à 100 mètres ;
Décines ou Genay tiendront en un seul appel.

---

## Réconciliation des deux univers

Google et SIRENE ne voient pas exactement le même ensemble d'établissements.

| Cas | Interprétation | Traitement |
|---|---|---|
| Dans Google **et** SIRENE | Nominal | Horaires + effectif, fiabilité haute |
| Google seul | Établissement récent, ou nom/adresse divergents de SIRENE | Conservé, effectif inconnu, fiabilité dégradée |
| SIRENE seul | Fermé en pratique, ou **troncature non détectée** | Signalé en contrôle — c'est le canari du balayage |

Le troisième cas est le plus important : c'est le seul indice qu'un morceau de zone a été
manqué. Un taux anormal d'établissements SIRENE non appariés dans un secteur donné doit
déclencher une inspection avant de considérer le balayage réussi.

### Règle d'appariement

Score combinant deux critères :
- **Proximité géographique** : moins de 75 mètres
- **Similarité de nom** : après normalisation (minuscules, sans accents, retrait des mots
  vides du domaine — *restaurant*, *le*, *la*, *chez*, *aux*), similarité trigramme
  supérieure à 0,5

Au-dessus du seuil combiné, l'appariement est accepté. En dessous, l'établissement Google est
conservé **sans effectif** plutôt qu'apparié à tort.

> Principe : mieux vaut une information manquante qu'une information fausse. Un effectif
> attribué au mauvais établissement produit un verdict de coupure erroné, et l'utilisateur
> n'a aucun moyen de s'en apercevoir.

---

## Critères de réussite d'un balayage

Un balayage n'est réussi que si **toutes** ces conditions sont remplies :

- **Zéro cellule tronquée non résolue.** Toute cellule ayant atteint 20 résultats a été
  subdivisée et rejouée jusqu'à convergence.
- Nombre d'appels consommés cohérent avec le `--dry-run`.
- Taux d'établissements SIRENE non appariés dans la normale, sans concentration géographique
  suspecte.
- Aucun dépassement de quota.

**Un balayage qui ne remplit pas ces conditions doit échouer bruyamment** plutôt que de
livrer une base silencieusement incomplète. C'est le point le plus important de cette spec.

---

## Profondeur de subdivision

Une limite de profondeur protège contre une boucle infinie — un lieu unique renvoyant 20
résultats identiques, par exemple.

À la limite atteinte, la cellule est marquée **irréductible** et consignée dans la
traçabilité du balayage, pour inspection manuelle. Elle n'est pas silencieusement ignorée.
