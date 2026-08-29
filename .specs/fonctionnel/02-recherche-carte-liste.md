# Recherche — carte et liste

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

C'est l'écran principal, et à peu près tout l'outil. Une seule page.

## Disposition

Trois zones : les **filtres**, la **liste** des résultats, la **carte**.

Sur grand écran, les trois cohabitent : filtres à gauche, liste et carte côte à côte. Sur
petit écran, la carte passe au-dessus de la liste et les filtres s'ouvrent dans un panneau.

C'est une mise en page qui s'adapte, pas deux interfaces différentes à maintenir.

**La liste et la carte se répondent.** Survoler une ligne met son point en avant sur la
carte ; cliquer sur un point fait défiler la liste jusqu'à la ligne correspondante. Les deux
montrent toujours exactement les mêmes établissements — ceux qui passent les filtres, jamais
un sous-ensemble.

## Les filtres

Groupés en trois blocs, dans cet ordre.

### Zone
- **Arrondissement de Lyon** (1er à 9e) et **communes de la Métropole**, sélection multiple.

### Rythme de travail
Le bloc qui justifie l'existence de l'outil.

- **Sans coupure** — trois choix : *oui* (aucune coupure possible) · *oui ou probablement*
  (inclut les établissements où la coupure est peu vraisemblable) · *peu importe*
- **Week-end** — *fermé samedi et dimanche* · *fermé le dimanche* · *peu importe*
- **2 jours de repos d'affilée** — *oui* · *peu importe*

### Établissement
- **Type** — bistrot, brasserie, gastronomique, restauration rapide, restauration
  collective, bar, pizzeria…
- **Taille** — petit (jusqu'à 5 salariés) · moyen (6 à 19) · grand (20 et plus)

### Et une recherche par nom
Un champ texte simple, pour retrouver un établissement précis.

## Deux règles sur les filtres

**Le nombre de résultats est toujours visible.** On doit savoir en permanence combien
d'établissements correspondent, sans avoir à faire défiler.

**« Tout effacer » est toujours accessible.** Sur un panneau à trois blocs, c'est ce qui
sépare l'outil utilisable de l'usine à gaz : il faut pouvoir revenir à zéro d'un geste quand
on s'est enfermé dans une combinaison qui ne donne rien.

**Les filtres se retrouvent dans l'adresse de la page.** Une recherche peut donc être mise en
favori et rouverte telle quelle le lendemain, ou envoyée à quelqu'un.

## Trouver des offres

Tout en bas du panneau, après les filtres et bien séparé d'eux — il ne filtre rien.

Un bloc qui dit d'emblée ce que l'annuaire ne fait pas : *« Cet annuaire ne dit pas qui
recrute. Pour les offres publiées : »*. Suivent des liens par **métier** — serveur, chef de
cuisine, commis, plongeur, barman, maître d'hôtel, équipier de restauration rapide,
pizzaïolo — puis deux sites d'offres généralistes du secteur.

Les liens ouvrent un nouvel onglet et portent sur un métier dans l'agglomération, **jamais
sur un établissement de la liste**. C'est la limite qui fait tenir la promesse de D1 : on
indique où chercher, on ne dit pas qui recrute. Quand la recherche ne renvoie rien, l'écran
renvoie vers ce bloc.

Voir D25.

## La carte

**Les points sont colorés selon le risque de coupure.** C'est le seul enrichissement visuel
qui vaut son coût : le critère n°1 se lit d'un coup d'œil, sans cliquer sur quoi que ce soit.
Un quartier entier peut se juger en un regard.

La carte se recentre sur la zone filtrée. Quand les points sont trop nombreux et trop
serrés, ils se regroupent.

## Le détail d'un établissement

Un panneau qui s'ouvre sur le côté — pas une page séparée, pour ne pas perdre sa recherche.

Il contient :

- **La semaine en barres horizontales**, un jour par ligne. C'est la pièce maîtresse : la
  coupure s'y voit comme un **trou au milieu de la journée**, sans avoir à lire un seul
  horaire. Un service continu, c'est une barre pleine ; un midi seul, une barre courte.
- **Le verdict, avec sa raison.** Pas « risque : élevé », mais *« Coupure probable — ouvert
  12h-14h30 puis 19h-22h30, 3 à 5 salariés »*. L'utilisateur connaît son métier mieux que
  l'outil : il doit pouvoir juger le raisonnement, pas seulement le subir.
- Le nom, l'adresse, le téléphone (appelable directement), le type d'établissement.
- Un lien vers la fiche Google de l'établissement.
- Le bouton **« Ajouter à ma liste »**, qui bascule vers le suivi de candidatures.

## Quand on ne sait pas

Certains établissements n'ont pas d'horaires renseignés chez Google. Ils sont affichés
quand même, marqués **« Horaires inconnus »**, avec le lien vers leur fiche Google.

On ne les masque pas. Un établissement caché ne se voit pas ; un établissement marqué
« à vérifier » se vérifie en un clic. Le filtre « sans coupure » les exclut, mais ils
restent visibles quand on ne filtre pas sur le rythme.

Même principe pour les informations déduites : quand la taille de l'équipe est inconnue, le
verdict est présenté comme moins sûr, jamais présenté comme certain.
