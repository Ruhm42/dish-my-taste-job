# La position de l'utilisateur

> **Statut** : acté · **Dernière mise à jour** : 2026-09-04

[`04-carte.md`](04-carte.md) s'ouvre sur une phrase qui décide de celle-ci : chercher un
emploi en restauration, c'est faire une tournée à pied. La carte sait donc dire **où sont
les établissements**. Elle ne sait pas dire **où est celui qui les regarde** — et sur un
téléphone, en tournée, c'est la moitié manquante. Quinze adresses dans deux rues ne se
visitent dans le bon ordre qu'à condition de savoir par laquelle on commence.

---

## Ce que ça fait, et rien de plus

**Un point bleu, son cercle de précision, et un bouton qui y ramène.** C'est tout.

- Le point **suit** le lecteur tant que la carte est à l'écran.
- Il **ne change rien** à la recherche : ni tri, ni filtre, ni distance affichée sur les
  résultats. L'ensemble qui passe les filtres est exactement le même avec ou sans position.
- La commande est **une cible**, comme sur toutes les applications de cartographie : un
  bouton carré posé sur la carte, sans libellé. Elle est **grise tant qu'on n'est pas situé
  et bleue une fois qu'on l'est** — du même bleu que le point, pour que la commande et ce
  qu'elle désigne se lisent comme une seule chose. Son nom vit dans l'infobulle et dans ce
  que lit un lecteur d'écran : *Me localiser*, puis *Recentrer sur ma position*.

Ce qui n'est **jamais** réduit à une icône, c'est le message : un refus, un signal perdu ou
une précision douteuse s'écrivent en toutes lettres. Une icône peut dire « clique ici » ;
elle ne sait pas dire pourquoi ça n'a pas marché.

Le bleu n'est pas un choix décoratif. La couleur, sur cette carte, est le verdict sur la
coupure — vert, lime, ambre, rouge, pierre. Le bleu n'appartient à aucun verdict, donc il ne
peut pas se lire comme tel. Il figure dans la légende pour la même raison : ici, une couleur
veut toujours dire quelque chose.

## La permission ne se demande jamais à froid

**La fenêtre du navigateur n'apparaît qu'après un clic sur le bouton.** Jamais à l'arrivée
sur la carte.

Ce n'est pas de la politesse, c'est de l'arithmétique : une demande envoyée à quelqu'un qui
n'a rien demandé se fait refuser bien plus souvent, et **un refus ne se rattrape pas**. Le
navigateur le mémorise et cesse de proposer quoi que ce soit ; il faut alors aller le défaire
dans les réglages du site, ce que personne ne devine. Une popup gagnée à l'arrivée se paie
donc en fonctionnalité perdue pour toute la durée de vie du navigateur.

**En revanche, on ne redemande pas ce qui est déjà accordé.** Si la permission a été donnée
lors d'une visite précédente, la position revient d'elle-même, sans un clic ni une fenêtre.

## Ce qui s'affiche quand ça ne marche pas

C'est le cœur du sujet, et c'est la règle du projet appliquée à la lettre : **un point bleu
figé au mauvais endroit ressemble trait pour trait à un point bleu juste.** Une carte muette
ment par omission ; une position muette ment tout court.

Chaque situation dit ce qu'elle est **et ce qu'il y a à faire** :

| Situation | Ce que voit le lecteur |
|---|---|
| Permission refusée | Le bouton disparaît — il ne promet plus une fenêtre qui ne reviendra pas — et le message explique où la réactiver : les réglages du site, le cadenas à gauche de l'adresse |
| Page non sécurisée | La localisation exige `https`. Le cas se produit en développement, sur un téléphone qui joint le poste par son adresse réseau |
| Navigateur sans la fonction | Dit tel quel, sans bouton |
| Signal perdu | **Le point reste affiché**, et le message dit que c'est le dernier connu. L'effacer perdrait une information encore utile ; le laisser sans un mot serait le mensonge |
| Position trop imprécise | Annoncée, avec l'ordre de grandeur. Le cercle en donne l'étendue |
| Hors du secteur couvert | Dit explicitement : sans cela, un point bleu au milieu d'une carte vide se lit comme une panne |

**Le cercle de précision n'est pas un ornement.** Il est la mesure de ce que le navigateur
sait vraiment. Un point dessiné net sur un relevé à deux kilomètres près affirmerait une
exactitude qui n'existe pas — exactement ce que le produit refuse de faire ailleurs avec les
horaires inférés.

## Quand le suivi tourne, et quand il s'arrête

Le GPS est ce qu'il y a de plus coûteux en batterie sur un téléphone, et le public visé est
dehors toute la journée. Il ne tourne donc **que** pendant qu'on regarde la carte :

- Sur petit écran, la carte est un onglet qui s'ouvre. Le suivi démarre en y arrivant et
  s'arrête en revenant à la liste.
- Il s'arrête aussi dès que la page passe en arrière-plan — téléphone rangé, autre
  application.
- Il repart tout seul, sans rien redemander, quand on revient.

## Ce que ça coûte

**Rien, et pas seulement « peu ».**

La position vient de `navigator.geolocation`, une fonction **du navigateur**. Elle ne passe
pas par notre clé, ne touche pas notre projet Google et ne consomme pas un appel du quota
mensuel. Le coût du produit reste adossé au nombre de balayages, jamais au nombre de visites
— la règle posée en [`04-carte.md`](04-carte.md) tient sans modification.

Google vend par ailleurs deux services qui feraient la même chose contre de l'argent, la
*Geolocation API* et la *Geocoding API*. Toutes deux sont plafonnées à zéro appel par jour du
côté de Google, et **ne sont jamais appelées**. Ce plafond est le garde-fou : elles échouent
au lieu de facturer.

## Ce que la position ne fait jamais

| Interdit | Pourquoi |
|---|---|
| **Se retrouver dans l'adresse de la page** | Les filtres y sont pour qu'une recherche se mette en favori et s'envoie à quelqu'un. Une position est une donnée personnelle : elle n'a rien à faire dans un lien qu'on partage |
| **Être demandée à l'arrivée** | Un refus est définitif du point de vue du navigateur ; le solliciter avant que le lecteur en ait l'usage, c'est le perdre pour de bon |
| **Recentrer la carte toute seule** | Seul le clic déplace le cadrage. Un recentrage à chaque relevé déplacerait la carte sous quelqu'un qui compare deux adresses — la même retenue que pour un point choisi |
| **Continuer à tourner hors de l'écran** | Un GPS qui tourne pour une carte que personne ne regarde ne coûte rien à personne sauf à la batterie du lecteur |
| **Modifier l'ensemble des résultats** | La position s'affiche ; elle ne filtre pas, ne trie pas et n'écarte rien. Ce qui passe les filtres reste ce qui passe les filtres |
