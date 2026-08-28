# Authentification

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

## Principe

L'accès à la plateforme nécessite d'être connecté. Aucun écran n'est consultable sans compte.

## Comment on se connecte

**Par email et mot de passe.** Deux champs, un bouton.

Le lien envoyé par email avait notre préférence — rien à retenir, rien à réinitialiser. Il a
été écarté à l'usage : l'envoi d'emails est plafonné à quelques messages par heure sur
l'offre gratuite, et un accès qui échoue parce qu'un quota d'emails est atteint est bien plus
pénible qu'un mot de passe. Voir [`../DECISIONS.md`](../DECISIONS.md) — D20.

Il n'y a pas de réinitialisation en ligne : le mot de passe est défini à la création du
compte et se change au même endroit.

## Qui peut avoir un compte

**Une liste d'adresses autorisées, tenue à la main.**

Les comptes sont créés à la main, un par un, depuis le tableau de bord de l'hébergeur de
la base. Il n'y a pas d'écran d'administration dans l'application : en construire un
reviendrait à réécrire, moins bien, quelque chose qui existe déjà. Une adresse qui n'y figure pas ne reçoit pas de
lien de connexion. Le message affiché doit être clair et sans ambiguïté : l'accès est
restreint, ce n'est pas une erreur technique de la part de l'utilisateur.

Il n'y a **pas d'inscription**, pas de parrainage, pas de demande d'accès. Ajouter quelqu'un
est une action manuelle de l'administrateur du projet.

> Ce choix garde l'outil dans un usage strictement privé, ce qui lève toute ambiguïté
> vis-à-vis des conditions d'utilisation de la source de données. Ouvrir l'accès plus
> largement sera une décision à part entière, pas une évolution naturelle. Voir
> [`../DECISIONS.md`](../DECISIONS.md) — D11.

## À quoi sert le compte

À une seule chose : **séparer les suivis de candidatures**. Chacun voit ses démarches, et
seulement les siennes.

Les données d'établissements, elles, sont identiques pour tout le monde — il n'y a rien à
personnaliser, rien à corriger, rien à contribuer.

## Ce qu'on ne fait pas

- Pas de profil utilisateur, pas de photo, pas de CV stocké
- Pas de rôles ni de permissions : tous les comptes ont exactement les mêmes droits
- Pas de connexion via Google, Facebook ou autre
- Pas de compte partagé — mais rien n'empêche deux personnes d'utiliser la même adresse si
  elles le souhaitent
