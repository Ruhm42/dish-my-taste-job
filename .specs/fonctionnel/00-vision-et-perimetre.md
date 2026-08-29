# Vision et périmètre

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

## Le problème

En restauration, on ne postule pas à des offres : on repère un établissement et on y dépose
un CV. La recherche d'emploi est donc d'abord un **travail de ciblage**.

Or le critère qui décide de la qualité de vie d'un salarié du secteur n'est ni le salaire ni
le type de cuisine, c'est le **rythme de travail** :

- **La coupure.** Travailler de 10h à 15h, rentrer chez soi, revenir de 18h à minuit. La
  journée est confisquée sans être payée davantage. C'est le premier motif de départ du
  secteur.
- **Les week-ends.** Un restaurant ouvert samedi et dimanche est un restaurant où l'on ne
  voit jamais ses proches.
- **Les jours de repos.** Deux jours d'affilée ou deux jours séparés, ce n'est pas le même
  métier.

Aucun outil ne permet de chercher là-dessus. Google Maps donne les horaires — un
établissement à la fois, sans filtre. Les sites d'emploi listent des postes, pas des rythmes.

## Ce qu'on construit

Une page web qui liste et cartographie les restaurants de la **Métropole de Lyon**, filtrables
par rythme de travail, plus un suivi personnel des candidatures.

On cherche, on filtre, on consulte. On note où l'on a déposé un CV. Rien de plus.

## Le public

Un professionnel de la restauration. Pas un utilisateur de logiciel, pas quelqu'un qui a
envie d'apprendre une interface. Deux règles en découlent, qui priment sur toute autre
considération de conception :

**Vocabulaire métier, jamais technique.** On écrit « Sans coupure », « Week-end libre »,
« 2 jours de repos d'affilée ». Jamais un score, jamais un pourcentage, jamais un terme
d'informaticien. Quand une information est déduite plutôt que certaine, on le dit en mots —
*Confirmé*, *Probable*, *À vérifier* — et non par un chiffre de confiance.

**Une action évidente par écran.** Chercher, consulter, ajouter à sa liste. Si un écran pose
la question « et maintenant, je fais quoi ? », il est raté.

## Ce que l'outil ne fait pas

Liste volontairement explicite : c'est elle qui protège du glissement de périmètre.

| Hors périmètre | Pourquoi |
|---|---|
| **Corriger ou modifier un établissement** | Lecture seule. Les données viennent de Google ; on ne les édite pas, on ne les complète pas |
| **Avis, notes, commentaires** | Ce n'est pas un site d'avis. Le jugement sur un employeur ne se publie pas ici |
| **Offres d'emploi** | On ne dit jamais si un établissement recrute. On dit s'il correspond aux critères ; c'est à l'utilisateur d'aller voir — on lui indique **où** chercher, jamais **qui** recrute (D26) |
| **Messagerie, candidature en ligne** | On ne met personne en relation. On donne une adresse et un numéro |
| **Inscription publique** | L'accès est sur liste d'emails autorisés |
| **Autres villes** | Métropole de Lyon uniquement. Le changement de ville est possible, mais c'est une décision, pas une fonctionnalité |

## Ce qui compte, si on ne devait garder qu'une chose

Que quelqu'un puisse, en trois clics, obtenir la liste des restaurants **sans coupure et
fermés le week-end** de son arrondissement — et que cette liste soit juste.

Tout le reste est secondaire.
