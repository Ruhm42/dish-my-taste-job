# Infrastructure

> **Statut** : acté · **Dernière mise à jour** : 2026-08-28

Quatre comptes, deux clés API, six variables d'environnement. Tout tient dans les offres
gratuites — cette spec explique où, et ce qui pourrait faire basculer en payant.

---

## Vue d'ensemble

| Service | Rôle | Offre | Compte requis |
|---|---|---|---|
| **Google Cloud** | Places API (horaires) + Maps JavaScript (carte) | Quotas gratuits mensuels | Oui, avec carte bancaire |
| **Supabase** | Base Postgres + authentification | Gratuite | Oui |
| **Vercel** | Hébergement de l'application | Hobby, gratuite | Oui |
| **GitHub** | Dépôt + tâche mensuelle de balayage | Gratuite | Oui |
| SIRENE | Registre + effectifs | Données ouvertes | **Non** |
| BAN | Géocodage | Données ouvertes | **Non** |

Les deux sources de données publiques ne demandent **aucune inscription** : le fichier stock
SIRENE se télécharge directement, et la Base Adresse Nationale fonctionne sans clé.

---

## Google Cloud

Le seul service où une erreur coûte de l'argent. Voir
[`02-budget-google-et-garde-fous.md`](02-budget-google-et-garde-fous.md) pour le modèle
tarifaire complet.

**Deux API à activer** — attention, *Places API (New)* est un service **distinct** de
l'ancienne *Places API*. C'est la nouvelle qu'il faut, l'ancienne ne connaît pas le mode
d'appel retenu.

- **Places API (New)** — le balayage
- **Maps JavaScript API** — la carte

**Deux clés API, jamais confondues** :

| Clé | Où elle vit | Restrictions |
|---|---|---|
| **Places** | Serveur uniquement — scripts d'ingestion et tâche planifiée | Restreinte à *Places API (New)*. **Jamais** exposée au navigateur |
| **Maps** | Navigateur, donc publique par nature | Restreinte à *Maps JavaScript API* **et** par domaine référent (production + `localhost`) |

> La clé Maps est nécessairement visible dans le code de la page : c'est normal et sans
> danger **à condition** que la restriction par domaine référent soit posée. Sans elle,
> n'importe qui peut consommer le quota. La clé Places, elle, ne doit jamais porter le
> préfixe qui l'exposerait au navigateur — c'est celle qui donne accès au palier facturé.

**Les deux protections qui rendent le « zéro euro » structurel** :
- **Quota journalier plafonné** sur les requêtes Nearby Search Enterprise (~100/jour). Au
  delà, l'API répond par une erreur. Un script en boucle devient un échec, pas une facture.
- **Alerte budget à 1 €**. Ne bloque rien, mais transforme une dérive silencieuse en
  notification.

---

## Supabase

**Région Europe** (Francfort ou Paris) : latence, et données personnelles qui restent dans
l'UE.

**Base** — extension `pg_trgm` à activer pour l'appariement de noms. Pas de PostGIS (D12).
L'offre gratuite plafonne à 500 Mo ; 4 000 établissements avec leurs horaires en occupent
quelques dizaines.

**Authentification** — lien par email, et surtout : **inscription désactivée**.

C'est ainsi que l'allowlist est réellement mise en œuvre. Les comptes sont créés à la main
depuis le tableau de bord Supabase, et une demande de connexion pour une adresse inconnue est
refusée sans créer de compte. La liste des utilisateurs Supabase **est** l'allowlist — il n'y
a pas de table applicative à maintenir en parallèle (D14).

**Isolation des données** — le suivi de candidatures est cloisonné par utilisateur au niveau
de la base, pas seulement de l'application.

> ⚠️ L'offre gratuite Supabase met un projet en pause après une période d'inactivité. Pour un
> outil consulté par intermittence, c'est un vrai risque : il faut savoir qu'un projet en
> pause se réveille depuis le tableau de bord, et que la tâche mensuelle de balayage suffit
> généralement à maintenir l'activité.

---

## Vercel

Offre Hobby, connectée au dépôt GitHub. Déploiement à chaque poussée sur la branche
principale.

**Usage strictement non commercial** — ce qui est le cas ici, et le restera tant que l'accès
demeure sur liste fermée (D11).

---

## GitHub

**Dépôt public, sous conditions.**

Le réflexe serait de le passer en privé. En reprenant les arguments un par un, aucun ne tient :
les specs ne contiennent rien de confidentiel, le dépôt ne porte que des *noms* de variables
et jamais leurs valeurs, et les conditions d'utilisation de Google encadrent l'usage des
**données**, pas la visibilité du **code**. Ce qui rend l'outil privé, c'est l'allowlist
(D11), pas la visibilité du dépôt. L'offre Vercel Hobby, elle, se juge au caractère non
commercial et non à la visibilité.

Un dépôt public apporte même le scan de secrets et la protection au push gratuitement.

**Mais l'asymétrie est réelle** : sur un dépôt public, un `.env` commité par erreur est
moissonné par des robots en quelques minutes, et la clé Google est exploitée avant qu'on s'en
aperçoive. D'où deux conditions non négociables :

1. **Protection au push activée** — GitHub refuse le commit contenant un secret reconnu
2. **Quota journalier Google plafonné** — ce qui borne les dégâts même si une clé fuit

La seconde est déjà exigée par ailleurs. Elle prend ici un second rôle : ce n'est plus
seulement une protection contre un bug, c'est le plafond de dégâts d'une clé compromise.

**Identité des commits.** Le dépôt est un projet personnel : les commits ne doivent pas
porter une adresse professionnelle. Outre l'exposition publique de l'adresse, attribuer un
projet personnel à une identité d'entreprise brouille inutilement la question de la propriété
intellectuelle. On utilise l'adresse `noreply` fournie par GitHub, configurée **au niveau du
dépôt** pour ne pas affecter les autres projets.

**Tâche planifiée mensuelle** — déclenche le balayage le 1er de chaque mois. Voir
[`06-pipeline-ingestion.md`](06-pipeline-ingestion.md).

> Une tâche planifiée GitHub peut être désactivée automatiquement après une longue période
> d'inactivité du dépôt. Sur un projet à un commit par trimestre, c'est un piège réel : il
> faut vérifier qu'elle tourne toujours, ou la déclencher manuellement au besoin.

Les identifiants nécessaires à la tâche sont stockés en secrets du dépôt, jamais dans le code.

---

## Variables d'environnement

| Variable | Contenu | Local | Vercel | GitHub Actions |
|---|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Clé Places, **serveur** | ✅ | — | ✅ |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Clé Maps, navigateur | ✅ | ✅ | — |
| `DATABASE_URL` | Connexion Postgres | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Projet Supabase | ✅ | ✅ | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique Supabase | ✅ | ✅ | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé d'administration, **serveur** | ✅ | ✅ | — |

**Règle absolue** : le préfixe `NEXT_PUBLIC_` publie la valeur dans le code envoyé au
navigateur. Il ne doit **jamais** être apposé à `GOOGLE_PLACES_API_KEY` ni à
`SUPABASE_SERVICE_ROLE_KEY`. La première donne accès au palier facturé, la seconde contourne
toutes les règles d'isolation de la base.

Un fichier d'exemple sans valeurs est versionné ; les valeurs réelles ne le sont jamais
(voir `.gitignore`).

---

## Données personnelles

L'outil stocke le strict minimum : une adresse email par utilisateur, et ses notes de
candidature. Aucune donnée de restaurant n'est personnelle.

Hébergement en Europe, accès restreint à une liste fermée, pas de traceur, pas d'analytique,
pas de partage à des tiers. La suppression d'un compte depuis le tableau de bord Supabase
emporte ses données.

---

## Ce qui pourrait coûter de l'argent

Rien dans le fonctionnement normal. Les quatre scénarios de dérive, par ordre de
vraisemblance :

| Scénario | Conséquence | Protection |
|---|---|---|
| Champ ajouté au field mask Google | Bascule sur un palier plus cher | Constante unique partagée + contrôle en console après chaque balayage |
| Carte réinstanciée à chaque changement de filtre | Consommation de chargements ×20 | Une seule instanciation par visite ; contrôle du ratio chargements/visites |
| Boucle dans un script d'ingestion | Explosion des appels | **Quota journalier plafonné** — la seule protection qui ne dépend de personne |
| Balayage relancé plusieurs fois dans le mois | Dépassement du quota gratuit | `--dry-run` par défaut, traçabilité des balayages |

**Le quota journalier est la protection principale.** Les trois autres sont des pratiques ;
celle-là est appliquée par Google, indépendamment de la qualité du code.

---

## Ce qu'il y a à faire, dans l'ordre

Actions manuelles, à réaliser hors du dépôt. Le repère ⚠️ signale ce qui protège du coût.

### Google Cloud
1. Créer un compte Google Cloud (crédit d'ouverture de 300 $ sur 90 jours ; carte bancaire
   exigée même en usage gratuit — le compte d'essai se ferme plutôt que de basculer en payant)
2. Créer un projet dédié
3. Activer **Places API (New)** — pas l'ancienne *Places API*
4. Activer **Maps JavaScript API**
5. Créer la clé **Places**, restreinte à *Places API (New)*
6. Créer la clé **Maps**, restreinte à *Maps JavaScript API* + domaines référents
   (production et `localhost`)
7. ⚠️ **Plafonner le quota journalier** des requêtes Nearby Search Enterprise à ~100
   *(Console → APIs & Services → Places API (New) → Quotas)*
8. ⚠️ **Créer une alerte budget à 1 €** *(Console → Billing → Budgets & alerts)*

### Supabase
9. Créer un compte et un projet, **région Europe**
10. Activer l'extension `pg_trgm`
11. Authentification : activer le lien par email, **désactiver l'inscription**
12. Renseigner les URL de redirection (production et `localhost`)
13. Relever l'URL du projet, la clé publique, la clé d'administration et l'URL de connexion
    à la base

### GitHub
14. ⚠️ Configurer l'identité git du dépôt sur l'adresse `noreply` GitHub, **avant le premier
    push** — après, l'adresse est publique et définitive
15. ⚠️ Activer la **protection au push** *(Settings → Code security → Push protection)*
16. Ajouter les secrets nécessaires à la tâche mensuelle : clé Places et URL de base

### Vercel
17. Créer un compte, connecter le dépôt
18. Renseigner les variables d'environnement destinées à la production
19. Une fois le domaine attribué, **revenir compléter la restriction par référent de la clé
    Maps** et les URL de redirection Supabase

### Ensuite
20. Créer les comptes des utilisateurs à la main depuis le tableau de bord Supabase — c'est
    l'allowlist
21. Après le premier balayage : vérifier en console de facturation que la consommation
    Enterprise est de l'ordre de 400 appels et que **rien n'a touché un palier supérieur**

**Rien à faire pour SIRENE ni pour la BAN** : téléchargement direct et API sans clé.
