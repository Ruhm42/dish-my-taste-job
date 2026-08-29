# La carte

> **Statut** : acté · **Dernière mise à jour** : 2026-08-29

La carte avait jusqu'ici quelques paragraphes dans
[`02-recherche-carte-liste.md`](02-recherche-carte-liste.md). Elle prend une spec à elle,
parce qu'elle répond à une question que la liste ne sait pas poser : **où**.

Chercher un emploi en restauration, c'est faire une tournée à pied. Le trajet compte autant
que l'établissement : quinze adresses dispersées dans la Métropole ne se visitent pas, quinze
adresses dans deux rues se visitent en une après-midi. Une liste, même parfaitement filtrée,
ne dit jamais ça.

---

## Le principe : deux surfaces, une seule recherche

Les filtres produisent **un** ensemble d'établissements. Cet ensemble est rendu de deux
façons, qui n'ont ni le même but ni le même rythme.

| | La carte | La liste |
|---|---|---|
| Répond à | *où sont-ils, et sont-ils groupés ?* | *lequel, et pourquoi celui-là ?* |
| Contenu | **tout** l'ensemble, d'un bloc | l'ensemble, par tranches |
| Se lit | d'un coup d'œil | ligne à ligne |

**Ce qui est dissocié, c'est le chargement — jamais le contenu.** La liste arrive par pages
parce qu'on ne lit pas 4 000 lignes ; la carte arrive entière parce qu'on ne peut pas juger
une répartition sur un échantillon. Les deux montrent le même ensemble : celui qui passe les
filtres.

C'était déjà la règle. Elle avait été perdue : depuis la pagination, la carte ne recevait que
les lignes déjà chargées — cinquante sur plusieurs milliers, prises **par ordre alphabétique**,
donc réparties au hasard dans la ville. Un utilisateur qui filtrait « sans coupure et week-end
libre » voyait cinquante points sur les 329 existants, sans que rien ne le lui dise. La carte
ne montrait pas une ville : elle montrait le début de l'alphabet.

---

## Ce que la carte affiche

**Tous les établissements qui passent les filtres. Sans plafond, sans échantillon.** Sans
filtre actif, c'est toute la base.

- **La couleur dit le risque de coupure.** C'est le seul enrichissement visuel qui vaut son
  coût : le critère n°1 se lit sans cliquer.
- **La forme dit la catégorie.** Information secondaire, lisible sans occuper la couleur.
- **Les établissements sans horaires connus sont présents**, dans la teinte neutre réservée à
  l'inconnu. On ne masque pas ce qu'on ignore : un établissement caché ne se vérifie pas.
- **La carte se recentre sur la zone filtrée.** Elle a désormais tous les points pour le faire
  juste ; avec un échantillon, le cadrage était faux lui aussi.

**Si un plafond technique devait un jour s'appliquer, il se dit à l'écran.** Une carte qui
montre un sous-ensemble sans le dire est pire qu'une carte vide : la seconde se voit, la
première se croit.

**Et si la carte ne s'affiche pas, elle le dit.** Une clé que Google refuse ne fait pas échouer
le script : il se charge, et la carte reste un rectangle gris. On ne se fie donc pas à
l'annonce de la panne mais au résultat — pas de première tuile dessinée dans le délai imparti,
et l'aperçu de la répartition prend la main, en disant pourquoi. C'est la même règle qu'ailleurs :
une carte muette est une carte qui ment par omission.

## Le regroupement des points

Quatre mille points ne tiennent pas à l'écran de la ville. Quand ils se chevauchent, ils se
regroupent, et le regroupement **porte le nombre d'établissements qu'il contient**.

**Un regroupement n'a jamais de couleur.** La couleur est le verdict sur la coupure ; une
couleur moyenne sur trente établissements mélangés serait une moyenne présentée comme un fait
— exactement ce que le produit s'interdit partout ailleurs. Un regroupement est neutre et
compte ; il ne juge pas.

**On ne regroupe pas moins de quatre points.** Un regroupement échange une couleur contre un
nombre ; réunir deux établissements revient donc à effacer deux verdicts de coupure pour
gagner la largeur d'un marqueur — le pire taux de change que la carte puisse proposer, et il
obligeait à zoomer pour défaire ce qu'on venait de cacher. Les petits groupes restent des
points colorés ; seul un tas réellement illisible devient un chiffre.

**Pour juger un quartier d'un regard, on filtre.** « Sans coupure », et la carte ne garde que
ceux-là : la densité des points restants *est* la réponse. C'est plus honnête qu'une couleur
agrégée, et c'est ce que la dissociation rend enfin possible — avant, filtrer ne changeait
que cinquante points sur la carte.

## La carte reste en vue

C'est la moitié du sujet. Une carte qu'on perd dès qu'on descend dans la liste ne sert à rien.

```
 GRAND ÉCRAN                                    PETIT ÉCRAN
 ┌────────┬──────────────────┬───────────────┐  ┌───────────────────────┐
 │        │  329 résultats   │               │  │ 329 résultats  [⚙]    │
 │        ├──────────────────┤               │  ├───────────────────────┤
 │Filtres │  ▸ Le Bouchon    │     Carte     │  │  [ Liste ] [ Carte ]  │
 │        │  ▸ Chez Marcel   │   329 points  │  ├───────────────────────┤
 │        │  ▸ La Cantine    │               │  │  ▸ Le Bouchon         │
 │        │  ▸ …             │   (reste en   │  │  ▸ Chez Marcel        │
 │        │        ↕         │     place)    │  │  ▸ La Cantine         │
 │        │   défile seule   │               │  │         ↕             │
 └────────┴──────────────────┴───────────────┘  └───────────────────────┘
```

**Sur grand écran**, trois zones côte à côte : les filtres, la liste, la carte. **La liste
défile, la carte reste.** On parcourt trente établissements sans jamais perdre le plan de la
ville, et le point correspondant à la ligne survolée est toujours visible.

**Sur petit écran**, les deux ne cohabitent pas : l'écran est trop étroit pour que l'une ou
l'autre soit lisible. Elles deviennent **deux vues alternatives** — *Liste* et *Carte* — dont
une seule est affichée, avec les filtres dans un panneau qui s'ouvre. Le nombre de résultats
reste visible dans les deux, et basculer de l'une à l'autre ne relance pas la recherche.

## Les gestes entre la liste et la carte

Dissocier le chargement ne veut pas dire dissocier l'usage : les deux surfaces se répondent.

| Geste | Effet |
|---|---|
| Survoler une ligne | Son point est mis en avant sur la carte |
| Survoler un point | Sa ligne est mise en évidence, si elle est chargée |
| **Cliquer un point** | **Le détail de l'établissement s'ouvre**, directement |
| Cliquer une ligne | Le même détail s'ouvre |

Le clic sur un point ouvre le détail **sans passer par la liste**. C'est le changement que la
dissociation impose : la carte porte des milliers d'établissements, la liste n'en a chargé que
les premiers, et exiger que la ligne existe rendrait la plupart des points inertes. Un point
cliqué qui ne répond pas serait le pire des deux mondes — visible et inutilisable.

Si la ligne se trouve déjà chargée, elle est mise en évidence au passage. C'est un confort,
pas une condition.

## La liste, en regard

Trois règles, pour qu'elle se parcoure sans effort.

**Les lignes ont une hauteur constante.** Aujourd'hui le détail se déplie *dans* la liste :
ouvrir une fiche pousse tout ce qui suit vers le bas, et on perd sa place. Le détail passe
donc dans le panneau latéral — ce que la spec prévoyait déjà. Une liste dont les lignes ne
bougent pas est une liste qu'on peut lire en défilant vite.

**Le défilement est celui de la liste seule**, pas celui de la page entière. On descend dans
les résultats sans emmener l'en-tête, les filtres et la carte avec soi.

**On peut revenir en haut d'un geste**, sans remonter quatre mille lignes. Une recherche large
se parcourt, se quitte et se reprend ; il faut une porte de sortie.

Le reste ne change pas : le nombre de résultats est toujours affiché, les pages se chargent à
mesure qu'on approche du bas, et un bouton permet de demander la suite au clavier.

---

## Ce que la carte ne fait jamais

| Interdit | Pourquoi |
|---|---|
| **Rechercher à mesure qu'on la déplace** | Le résultat dépendrait d'un cadrage qui ne se met pas en favori. Les filtres vivent dans l'adresse de la page pour qu'une recherche s'envoie à quelqu'un ; un déplacement de carte ne s'envoie pas |
| **Appeler Google à la consultation** | L'application ne parle jamais à Google Places. Elle lit une base déjà remplie : c'est ce qui rend le coût indépendant du nombre de visites |
| **Être reconstruite à chaque recherche** | Un affichage de carte est facturé à chaque instanciation, jamais au déplacement ni au zoom. La carte est créée une fois par visite ; seuls ses points changent |
| **Afficher un sous-ensemble en silence** | C'est le défaut qui ne se voit pas — celui contre lequel tout le reste du projet est construit |

## Ce que ça coûte

**Rien chez Google.** Les marqueurs ne sont pas facturés, quel qu'en soit le nombre : seule
l'instanciation de la carte l'est, et elle reste unique. Afficher 4 465 points au lieu de 50
ajoute une lecture en base de trois informations par établissement — position, identité,
risque de coupure — et pas un seul appel Google.

Ce que ça pèse, mesuré : **688 Ko bruts, 209 Ko compressés** pour la recherche sans aucun
filtre, qui est le pire cas. Une recherche réelle est bien plus légère — 51 Ko bruts pour
« sans coupure et week-end libre ». C'est le prix d'une carte qui ne ment pas sur ce qu'elle
montre, et il se paie une fois par recherche, pas une fois par page.

C'est la conséquence directe du choix d'architecture : le coût est adossé au nombre de
balayages, jamais au nombre de visites ni à ce qu'on affiche.
