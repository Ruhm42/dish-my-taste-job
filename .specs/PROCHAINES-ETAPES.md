# Prochaines étapes

> **Statut** : brouillon · **Dernière mise à jour** : 2026-10-26

Ce document n'est pas un journal de décisions : rien ici n'est acté. C'est l'état mesuré du
produit au 29 août 2026 et les axes qui en découlent, chacun avec ses options, pour que
l'arbitrage se fasse sur des chiffres et non sur une impression. Ce qui sera tranché
rejoindra [`DECISIONS.md`](DECISIONS.md).

Toutes les quantités ci-dessous sont **lues dans la base de production**, pas estimées.

---

## Le cycle d'import — révision du 17 octobre 2026, au soir

La spec consolidée du cycle est [`technique/14`](technique/14-cycle-d-import-mensuel.md). Ce qui
y était tranchable l'a été :
- [D47](DECISIONS.md#d47--la-période-du-quota-est-le-mois-du-pacifique), le mois Pacifique ;
- [D48](DECISIONS.md#d48--une-base-sans-échéance-ne-passe-pas-pour-fraîche), une base sans
  échéance n'est pas fraîche ;
- [D49](DECISIONS.md#d49--la-purge-rattrape-ce-quune-étape-hors-ligne-réécrit), la purge et les
  étapes hors ligne ;
- [D50](DECISIONS.md#d50--lâge-de-la-dernière-passe-se-vérifie-chaque-jour), l'âge de la dernière
  passe.

Ce qui suit revient au propriétaire. Rien n'y est acté : chaque point donne le constat mesuré,
les options et leurs conséquences. Deux échéances commandent l'ordre : **le 1er novembre** (C2,
C3, C4) et **le 16 novembre** (C1).

> **Relu le 26 octobre 2026.**
> - Rien de ce qui suit n'a bougé en production : même plan, aucune ré-ingestion, mêmes
>   échéances. Les constats du 17 tiennent.
> - Le réveil et la purge sont verts chaque jour depuis le 18.
> - `main` n'a reçu que les commits du réveil : ni C1 ni le retrait des noms dans les logs ne
>   sont construits.

### C1. Le garde-fou de dépense ne protège plus après le 16 — avant le 16 novembre

> **Tranché le 26 octobre 2026**, par délégation du propriétaire — voir
> [D52](DECISIONS.md#d52--la-dépense-dune-période-se-lit-dans-un-journal-tenu-appel-par-appel) et
> [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 4 et § 5.
> - Le journal par passe, une ligne par exécution, chaque appel réservé avant d'être fait. La
>   période se lit dans sa somme ; les tampons ne servent plus que de contrôle.
> - L'interdiction de racheter est écartée sur mesure : pire heure 69,5 % au lieu de 91,5 %, et
>   onze passes du 16 sur douze sous les 80 % de D39.
> - Reste à construire, migration comprise, **avant le 16 novembre 2026 à 09:00 UTC**. La règle
>   provisoire ci-dessous tient jusque-là.

**Constat.** Le compteur impute à la période le maximum de deux lectures : les cellules
tamponnées dans la période, et un plancher tiré de `sweep_run`.

Sous D38, la passe du 16 rachète des cellules déjà achetées le 1er : 234 en novembre, mesuré sur
une copie. Chaque cellule ne garde qu'un tampon. Rejoué sur une copie locale, sans un appel :
- **après les deux passes de novembre**, tout lancement dans le mois est refusé
  (« ledger missing at least 234 call(s) »), reprise comprise ;
- **une passe du 16 interrompue** après 200 appels ne peut pas reprendre (« missing at least 23 ») :
  sa période reste à 650 ;
- **un mois resté sous 900 relâche le plancher pour toujours.** Après ce novembre, un décembre
  complet est lu à 651 au lieu de 900, et le balayage autorise 249 appels de plus. Un `--go`
  manuel le 20 décembre porterait le mois Pacifique à 1 149 appels réels : **149 facturés**.

Le détail est dans [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 4.

**L'invariant proposé** : *la dépense imputée à une période n'est jamais inférieure à la dépense
réelle.* C'est la seule propriété qui permette au compteur de garantir le zéro euro.

**Options**

- *Un journal par passe*, une ligne par exécution, appels comptés au fil de l'eau
  ([`technique/14`](technique/14-cycle-d-import-mensuel.md) § 5).
  - Pour : il corrige les deux conséquences, et il donne l'historique que les logs Actions
    perdent au bout de 90 jours.
  - Contre : une table nouvelle, donc une migration appliquée à la main en production avant le
    code, comme toute modification de `schema.ts`.
- *Un tampon par appel* : une table qui reçoit une ligne par appel.
  - Pour : exact et simple à compter, environ 900 lignes par mois.
  - Contre : une migration aussi, et rien de plus que la dépense.
- *Interdire au 16 de racheter ce que le 1er a tamponné.*
  - Pour : aucune migration.
  - Contre : c'est défaire D38 r3 — tout le contenu est dû à chaque passe. À simuler avant d'y
    penser : la pire heure baisserait.
- *Ne rien construire, et tenir la règle provisoire pour toujours.*
  - C'est reposer le zéro euro sur la discipline, ce que D8 refuse : « garanti par la plateforme
    et non par l'attention ».
  - Et une passe du 16 interrompue, non reprise, relâche quand même le plancher des mois
    suivants.

**Proposé.**
- Le journal par passe, construit et migré **avant le 16 novembre 2026 à 09:00 UTC**.
- D'ici là, règle provisoire : **aucun `--go` ni `workflow_dispatch` de `sweep.yml` entre le 16
  et la fin du mois Pacifique.**
- Un refus « ledger missing » après le 16 se lit comme ce défaut, pas comme une perte de lignes.

### C2. La passe du 1er novembre

**Constat.**
- `simulate:passes`, graines 1 à 10, sur la copie du 17/10 et à partir du 01/11 09:00 UTC :
  pire heure 91,5 %, `lowest forecast` 91,5 %. Consigné sous D38.
- La passe à sec au 01/11 09:00 UTC prévoit **95,9 %** et finirait `capped`, au-dessus des 80 %
  qui la feraient échouer.
- Ce chiffre vaut tant que la base ne change pas d'ici là : pas de ré-ingestion (C4), pas de
  nouveau plan.
- Environ 4 % des fiches restent échues du 31/10 au 16/11 : les 450 cellules du 1er ne les
  rachètent pas.

**Options**
- *Garder 450.* La passe devrait finir verte.
- *Relever `firstPassCeiling` pour novembre seulement*, à 622, la couverture robuste entière.
  - Pour : tout est racheté dès le 1er, 99,9 % frais au soir.
  - Contre : le 16 n'a plus que 278 appels. Il se rabat sur la couverture des fiches connues et
    prévoit 85,1 %, et les échéances se regroupent de nouveau.
  - Simulé sur douze mois avec ce plafond tous les mois (graine 1) : pire heure **83,2 %**,
    contre 91,5 % à 450 ; à 600, 85,5 % le 31 décembre. La simulation ne sait pas relever le
    plafond pour un seul mois : l'effet de novembre seul n'est pas mesuré.
- *Accepter un rouge* si la prévision réelle passe sous 80 %. Cela ne se produirait qu'après un
  changement de la base.

### C3. La coupure du 31 octobre au 1er novembre

**Constat.**
- Les 3 608 horaires valides expirent tous le 31/10, entre 15:54 et 16:24 UTC.
- La période 2026-11 ouvre le 01/11 à 07:00 UTC, jour du changement d'heure en Californie.
- La passe est planifiée à 09:00 UTC, avec jusqu'à 7 h 52 de retard, et ses 450 appels prennent
  environ 15 minutes.
- La liste par défaut sera donc vide **de 17 à 25 heures environ**.

**Options**
- *Accepter.* Une fois, et D38 l'a prévu : c'est le pont jusqu'aux deux passes.
- *Un lancement manuel à 07:00 UTC.* La coupure descend vers 15 heures. La passe planifiée de
  09:00 est alors refusée (« already spent in this pass ») et sort rouge, ce qui est attendu et se
  dit d'avance.
- *Désactiver le workflow avant, et le réactiver après.* Plus de rouge. Mais un oubli coûte la
  passe du 16 ; D50 le verrait le lendemain.
- *Planifier à minuit Pacifique*, avec le fuseau IANA que GitHub accepte dans `on.schedule`.
  - Pour : une à deux heures de gagnées chaque mois, sur toutes les passes.
  - Contre : le code de la prévision lit une heure UTC (`scheduleHourUtc`), et le retard de
    GitHub reste.
  - Pour servir dès le 1er novembre, il faudrait une session de code d'ici là.
- *Dépenser les 100 appels gratuits qui restent en octobre.* Écarté : notre plafond de 900 est la
  marge qui garantit le zéro euro, et 100 appels ne couvrent qu'une petite part de la base.

### C4. SIRENE : pas de ré-ingestion avant le 1er novembre, puis un rythme

**Constat.** La ré-ingestion est due (D41 r5). Le stock du 1er octobre, comparé à la table :
- 120 lignes radiées depuis, dont 10 appariées ;
- 116 établissements actifs absents de la table ;
- 1 259 tranches d'effectif changées.

Une ré-ingestion déplace les points de la couverture robuste et invalide le calibrage à 450.

**La NAF 2025.**
- La bascule a lieu « à partir de début janvier 2027 », date précise non annoncée au 17/10 (page
  INSEE *Sirene Open Data — Actualités*).
- Le stock du 1er janvier 2027 sera le dernier à porter les deux nomenclatures ; une version en
  NAF 2025 seule suit « quelques jours après ».
- Le stock actuel porte déjà le futur code de chaque établissement.
- Sur nos 5 995 établissements actifs, 96,5 % tombent dans cinq codes NAF 2025 : 56.11G, 56.11H,
  56.11J, 56.22Y et 56.30Y.
- Le reste se disperse : 49 en 56.12Y, 33 en 56.21Y — le code des traiteurs que l'ingestion
  exclut aujourd'hui sous 56.21Z, 582 établissements en périmètre —, et quelques dizaines hors de
  la restauration.

**Options**
- *Aucune ré-ingestion avant la passe du 1er novembre* — proposé, pour garder le calibrage à 450
  vrai le jour où il sert.
- *Le rythme* :
  - mensuel, entre le 2 et le 10, suivi d'un géocodage, d'une simulation et d'un plafond
    recalibré avant le 16 ;
  - trimestriel, comme D13 ;
  - ou calé sur la migration commune de D41, D42 et D45.
- *Les radiés.*
  - Les supprimer : ils sortent de la contrainte robuste, mais leurs dix fiches appariées perdent
    leur effectif.
  - Ou les marquer : une colonne de plus dans la même migration.
- *Les adresses changées* : regéocoder ce dont l'adresse a bougé, à chaque ingestion.
- *La NAF 2025*, avant début janvier 2027 :
  - filtrer sur la liste des codes NAF 2025, en décidant le sort de 56.12Y et de 56.21Y ;
  - ou figer l'appartenance par SIRET d'après la correspondance que le stock donne aujourd'hui.

### C5. Le canal d'alerte

**Constat.** Le seul canal est l'e-mail de GitHub.
- Le réveil a été rouge les 8, 12 et 15 octobre, et la base est restée en pause du 5-8 au 17
  octobre : l'e-mail n'a pas suffi.
- La désactivation des planifications après 60 jours sans commit emporterait aussi toute
  vérification planifiée (D50).

**Options**
- *Les notifications de l'application mobile GitHub* : rien à construire, même source.
- *Un ticket ouvert par le workflow en échec*, fermé quand il repasse au vert. Il reste visible
  dans le dépôt, sans compte de plus.
- *Un témoin extérieur* (*dead man's switch*) : un service qui alerte quand il n'a **pas** reçu
  de signal. C'est le seul qui voie un dépôt dont les planifications sont désactivées. Un compte
  et un secret de plus.
- *Une messagerie* par webhook : un compte et un secret de plus.

### C6. Lancements manuels et rattrapage

**Constat.**
- `workflow_dispatch` sur `sweep.yml` n'a aucune entrée et dépense.
- Celui de `purge.yml` écrit par défaut.
- Les 163 appels du 4 septembre ont été faits depuis un poste, sans acteur ni run. Un `--go`
  local reste possible partout où la clé est présente.
- Aucun acquittement n'existe pour une cellule irréductible.

**Options**
- *Rendre les deux déclenchements manuels secs par défaut*, avec une case à cocher pour écrire ou
  dépenser. Cohérent avec la règle du dépôt : tout ce qui dépense est sec par défaut.
- *Retirer la clé Places des postes*, pour qu'elle ne vive que dans les secrets du dépôt : toute
  dépense passe alors par un run tracé. Le prix : plus de `--go` local, même pour un calibrage.
- *Le rattrapage d'une passe manquée.* Le 1er se rattrape avant le 16 dans ses 450. Le 16 se
  rattrape seulement après C1.
- *L'acquittement d'une cellule irréductible* : une liste d'identifiants acquittés, versionnée et
  relue, ou une colonne. À décider quand le cas se présentera, comme D39 le voulait — ou
  maintenant.

### C7. Ce que Google retire, change ou double

**Constat, copie du 17/10.**
- 64 fiches (46 `OPERATIONAL`) à au moins 10 m à l'intérieur d'une portée du 1er octobre n'ont
  pas été renvoyées.
- 181 fiches n'ont été renvoyées par aucun appel ce jour-là.
- Aucune fiche n'est `CLOSED_PERMANENTLY` : le statut est écrasé sans historique.
- Les 923 fiches sans échéance ne sont jamais rachetées exprès.
- 7 paires de doublons probables, à 7 m ou moins.
- 505 fantômes au sens de D44.

**Options**
- *Combien de temps garder une fiche absente*, une fois D45 r2 construite :
  - pour toujours, vidée de son contenu — elle reste référençable par une candidature ;
  - ou supprimée après N passes, sauf si une candidature la référence.
  - Dépend de l'axe 0 pour l'identité.
- *Les doublons* : ne rien faire pour 7 paires, ou masquer celle des deux qui n'est plus
  renvoyée.
- *Les 923 sans échéance* : les laisser au hasard des cellules achetées, ou les inclure dans la
  couverture, à un coût à mesurer.

### C8. La replanification

**Constat.**
- Le plan en place est parcouru sans fin. Un nouveau plan démarre sans aucune couverture : aucune
  de ses cellules n'a de portée tant qu'elle n'a pas été interrogée.
- 239 cellules de profondeur 0 portent plus de 12 points SIRENE : le plan a été posé sous
  l'ancien plafond de 15.
- 430 des 432 reprises tombent sur la division en quarts.

**Options**
- *Garder le plan.*
- *Le recalibrer en place* : replanifier seulement ce qui n'a jamais été interrogé, en gardant les
  cellules qui portent la couverture.
- *Un nouveau plan* : un mois sans couverture, donc une extinction, sauf transition.

Le choix se pose avec C4 : de nouveaux points SIRENE demandent des cellules.

### C9. Les hypothèses de coût, en console

**À relire par le propriétaire.**
- Les plafonds journaliers des cinq méthodes : jamais relus depuis le 29 août. Les specs
  écrivent 100, 500, 800 et 1 000 pour le même plafond.
- Le montant et la devise de l'alerte budget : 1 $ dans D8, 1 € dans `technique/08`.
- Les projets liés au compte de facturation : Google y agrège l'usage, et un projet voisin
  entamerait les 1 000 gratuits sans que notre compteur le voie.
- L'adresse du compte, pour l'axe 0.

**Une option.** Abaisser le plafond journalier de `SearchNearbyRequest` à 500.
- Une passe dépense au plus 450 : rien ne change pour le cycle.
- Une clé qui fuit coûterait environ 490 à 510 $ par mois au lieu de 1 015 à 1 050 $.
- Un rattrapage des deux passes le même jour échouerait sur un `429`, sans facture.
- L'ordre des garde-fous de `technique/02` serait à réécrire : le compteur de 900 ne parlerait
  plus avant Google, sur une journée.

### C10. Les tests

Rien ne joue une passe ou un cycle de bout en bout. Rien ne fige le masque de champs. Rien ne
vérifie l'accord entre le cron et `CYCLE`.

**Proposé**, à faire avec C1 : deux passes jouées sur PGlite contre une fausse API, avec rachats.
C'est le test qui aurait montré le défaut de C1.

> **Annoté le 26 octobre 2026.** D52 exige les tests de la réservation, de la lecture de la
> période et de ses deux contrôles, sur les cas mesurés. Ce test de bout en bout n'en est pas une
> condition : il reste à décider ici.

---

## Révision du 17 octobre 2026

Des mesures prises ce jour-là en production ont donné dix décisions,
[D36 à D45](DECISIONS.md#d36--rafraîchir-le-contenu-périmé-par-couverture-pas-la-cellule-interrogée-le-plus-tôt),
toutes à construire. La relecture des conditions de Google qu'elles demandaient a ouvert une
question qu'aucune ne tranche, et qui passe avant elles : l'axe 0 ci-dessous.

### 0. Ce que les conditions de Google permettent de stocker — à trancher avant le reste

> **Ouvert, non arbitré.** Relevé en relisant la règle des 30 jours pour D38. Ce sont les
> textes, lus le 17 octobre 2026, et ce qu'ils semblent dire ; ce n'est pas une lecture
> juridique.

**Constat.** D7 fonde toute la rétention sur une phrase : les conditions limiteraient « la mise
en cache du contenu Places à 30 jours », l'identifiant de lieu étant stockable indéfiniment.
Les textes en vigueur disent autre chose.

- Les *Google Maps Platform Service Specific Terms* (dernière modification le 15 octobre 2026),
  section *Places API (Legacy and New)* : la mise en cache temporaire, 30 jours calendaires
  consécutifs, n'est accordée qu'à la **latitude et à la longitude**. Rien sur les horaires, le
  nom, l'adresse, le téléphone.
- Les conditions générales interdisent toute mise en cache qui n'est pas **expressément**
  permise par ces termes, et donnent en exemple de ce qui est interdit le fait de copier et
  conserver noms et adresses d'établissements.
- La page *Places API Policies* le dit sans détour : hors identifiant de lieu, le contenu ne
  peut être ni mis en cache ni stocké, sauf accord le permettant.
- Pour un compte de facturation **domicilié dans l'Espace économique européen**, des
  conditions EEA s'appliquent depuis le 8 juillet 2025 aux intégrations créées ou modifiées
  depuis — ce projet date d'août 2026. Même règle de cache, et deux limites de plus : hors
  latitude, longitude et identifiant, le contenu Places ne s'utilise **avec aucune carte**, et
  seulement pour une liste fermée de neuf usages (recherche d'adresse, points de vente propres,
  suivi commercial, notes personnelles, contexte immobilier, transaction financière, jeu,
  réseau social, domotique). Un annuaire de prospection n'y figure pas.

Si cette lecture est la bonne, la base stocke depuis août un contenu qu'elle n'a pas le droit
de stocker, quelle que soit sa fraîcheur ; D38 et D45 ne règlent que la partie visible du
problème, et D7 se trompait sur sa prémisse plutôt que sur son calendrier.

**Ce qu'on ne sait pas.** L'adresse du compte de facturation, qui décide du texte applicable —
elle n'est nulle part dans le dépôt. Et s'il existe un accord, ou une page non relue, qui
accorde davantage.

**Options**
- *Vérifier l'adresse du compte de facturation*, puis lire le texte applicable avec un regard
  juridique. Préalable à tout le reste.
- *Poser la question au support Google Maps Platform* : conserver 30 jours des horaires pour
  filtrer, est-ce permis ?
- *Basculer sur OpenStreetMap* — le plan B que D3 et [`technique/01`](technique/01-sources-de-donnees.md)
  conservent explicitement : format `opening_hours` normalisé, licence qui autorise la
  redistribution. Couverture des horaires lyonnais à mesurer avant tout.
- *Ne garder que l'identifiant et la position*, et recalculer le profil à chaque passage sans
  stocker les horaires — à condition que le profil lui-même ne soit pas du « contenu créé à
  partir du contenu Google », clause qui existe aussi.
- *Ne rien changer en connaissance de cause* — ce que D30 a refusé pour la fraîcheur, au nom de
  la conformité.

**Ce que je ferais.** Vérifier l'adresse de facturation d'abord : une minute, et elle décide du
texte à lire. Construire D45 sans attendre — la purge va dans le sens de la conformité quelle
que soit la réponse. Ne pas étendre le stockage (D43) avant d'avoir la réponse. Les décisions D36
à D44 sont écrites sous la lecture de D7 ; si elle tombe, elles tombent avec elle.

> **Complété le 17 octobre 2026, au soir, depuis le cycle d'import.**
>
> **Ce qu'une lecture juridique aurait à trancher**, en plus de l'adresse et d'un éventuel
> accord :
> 1. une base reconstruite à chaque passe est-elle un cache ?
> 2. le profil de rythme est-il un contenu « dérivé » ?
> 3. un annuaire de prospection entre-t-il dans l'un des neuf usages EEA ?
> 4. le test d'appartenance de la couverture — une position Places dans le disque d'une cellule —
>    est-il l'analyse « point-in-polygon » qu'interdit la ToS §3.2.3(c)(iv) ?
>
> **Ce que chaque option ferait au cycle** est tabulé dans
> [`technique/14`](technique/14-cycle-d-import-mensuel.md) § 14. Pour l'option OSM, un comptage
> Overpass du 17 octobre donne 3 347 lieux de restauration et de boisson sur Lyon et
> Villeurbanne, dont 2 148 avec des horaires, soit 64 %. Les fiches Google en ont 80 %. Ce
> comptage ne juge pas de la fraîcheur des horaires OSM.
>
> **Deux faits pour la session de code.**
> - Une purge de l'identité par suppression emporterait les candidatures en cascade ; par mise à
>   jour, elle demande une migration, car le nom et la position ne peuvent pas être nuls.
> - Le commentaire de `schema.ts` qui dit l'identité « the only Google data we may store
>   durably » contredit la lecture de cet axe.

### Laissé ouvert, et pourquoi

- **L'axe 0**, ci-dessus.
- **Étendre la purge à l'identité des fiches** — nom, adresse, téléphone, position. D7 la
  demanderait (le contenu Places entier est limité à 30 jours, et les 923 fiches sans horaires
  n'ont même pas d'échéance), mais l'axe 0 dit peut-être qu'il ne fallait pas les stocker du
  tout. Une seule décision, après l'axe 0 ; D45 s'arrête délibérément aux horaires.
- **Rendre de la fraîcheur pour acheter de la découverte.** Sous les deux passages de D38, la
  simulation donne zéro appel à la découverte en régime permanent : tout le budget rachète le
  contenu. Les ouvertures restent prises par la couverture robuste ; ce qui ne l'est plus, ce
  sont les lieux que les troncatures cachent encore, surtout en Presqu'île. Réserver un budget
  de découverte, c'est baisser la pire heure ; le chiffre de cet échange se lit dans la même
  simulation. À trancher si le sous-comptage du centre devient le problème principal.

Deux décisions sont prises avec un seuil posé d'avance plutôt que tranchées sur une
estimation : la couverture robuste cède la place à celle des fiches connues si elle ne tient pas
dans le budget (D36), et la colonne de raison sociale ne s'ajoute que si la mesure en lecture
seule donne au moins 100 verdicts à 95 % (D42).

### Ordre de construction proposé

1. **D45** (purge) — la conformité, quelle que soit la réponse à l'axe 0.
2. **D36, D38, D39** ensemble, **avant le 16 décembre 2026** : le cycle du 1er novembre passe
   avec le correctif minimal (tri par profondeur), novembre a 30 jours, mais décembre en a 31 —
   sans le passage du 16, le 31 décembre s'éteint. Une première implémentation existe, locale et
   non poussée ; elle précède les revues intégrées le 17 octobre (portée des cellules tronquées,
   statuts, annotation) et sert de base, pas de livraison.
3. **D37** — l'affichage des trois coûts, qui accompagne D36.
4. **D41 et D42** : une seule requête DuckDB en lecture seule, après avoir réingéré SIRENE
   (tranches mises à jour le 1er octobre), puis une seule migration manuelle — avec la colonne
   de D45.
5. **D40** et les règles 2 et 3 de D31 — hors ligne, sans dépendance au reste.
6. **D44** — hors ligne ; son critère « ni site ni avis » attend D43.
7. **D43** — après l'axe 0.

> **État au 17 octobre 2026, au soir.**
> - **Construits** :
>   - D45 règle 1 (commit `0fee11c`), qui écrit chaque jour depuis le 18 octobre : 122 fiches
>     vidées ce jour-là, aucune depuis (relevé le 26 octobre) ;
>   - D36, D38 et D39 (commit `05058b4`), dont la première passe planifiée est le 1er novembre ;
>   - les règles 2 et 3 de D31 (PR #14).
> - **D37** : construit en partie.
>
> L'implémentation « locale et non poussée » citée au point 2 a donc été remplacée par une
> livraison.
>
> **À intercaler, dans l'ordre :**
> 1. C1, avant le 16 novembre ;
> 2. D49 et D48, qui touchent le cycle ;
> 3. D50 ;
> 4. puis C4 avant début janvier 2027, pour la NAF 2025.
>
> Sans échéance : retirer des logs du balayage le nom et la position des fiches hors de toute
> portée ([`technique/14`](technique/14-cycle-d-import-mensuel.md) § 14). Le propriétaire l'a
> jugé non grave le 26 octobre.

---

## Ce que la base dit aujourd'hui

| | Mesure | Lecture |
|---|---|---|
| Établissements | 4 465 | pour 5 720 SIRENE géocodés en périmètre |
| Avec horaires | 3 466 (78 %) | 999 sont affichés « Horaires inconnus » |
| Avec effectif | 974 (22 %) | **c'est la charnière du verdict, et elle manque 4 fois sur 5** |
| Verdict « confirmé » | 2 623 (59 %) | dont 2 236 par absence de coupure dans les horaires |
| Verdict « probable » | 843 (19 %) | coupure déduite de la seule amplitude, sans effectif |
| Sans coupure **et** week-end libre | 329 | la recherche que la vision désigne comme l'essentiel |
| Candidatures suivies | 0 | la table existe, l'écran n'existe pas |
| Cellules du balayage | 1 501 | 688 faites · 212 tronquées non résolues · **601 jamais interrogées** |

Deux chiffres méritent d'être lus ensemble : le balayage a coûté 900 appels et il en reste
au moins 1 200 à faire ; le quota gratuit est de 1 000 par mois.

> Ce tableau date du 29 août. L'état du 17 octobre — 4 653 fiches, 3 730 datées, 2 408 cellules
> dont 609 jamais interrogées — est dans [`technique/14`](technique/14-cycle-d-import-mensuel.md)
> § 0.

---

## 1. Le balayage ne repartira pas tout seul — il est en interblocage

> **Corrigé le 29 août** — voir D28 et
> [`technique/10-reprise-du-balayage.md`](technique/10-reprise-du-balayage.md). Le plafond
> compte désormais le **mois du quota**, et ce mois est celui du Pacifique, là où Cloud
> Billing bascule son cycle : compté en UTC il remettrait notre compteur à zéro huit heures
> avant celui de Google, et la tâche planifiée se déclenche dans cette fenêtre. Vérifié à
> sec sur une copie de la production : une reprise simulée au 1er septembre part de zéro et
> annonce 601 cellules à interroger, là où l'ancien compteur refusait le premier appel.
>
> Aucun plafond journalier local n'est posé : celui de Google vaut 1 000, pas 800, donc
> notre compteur mensuel de 900 mord déjà en premier.
>
> **Ce qui reste** : l'axe 3 ci-dessous. Le balayage repart, mais ne converge toujours pas
> dans une seule période.

**Constat.** Le plafond de 900 appels est compté **par balayage**, pas par mois :
`previousCalls` est repris depuis `sweep_run.calls_made`, et le garde-fou compare le cumul
du *run*. Le run en cours affiche `calls_made = 900`, statut `failed`.

Le 1er septembre, `cron:refresh` détectera 601 cellules en attente, sautera la planification
comme prévu par D22, lancera le balayage sur ce même run — et le tout premier appel sera
refusé : `900 + 0 >= 900`. Le job échouera **en ayant dépensé zéro appel**. Et le mois
suivant reproduira exactement la même chose, indéfiniment.

Le plafond par run est délibéré et son motif est juste — dix reprises ne doivent pas
autoriser dix fois le plafond. Mais D22 a décidé de reprendre le balayage **au renouvellement
du quota mensuel**, et le compteur, lui, ne connaît pas les mois. Les deux règles sont
individuellement défendables et mutuellement bloquantes.

**Pourquoi ça compte.** C'est le seul défaut de cette liste qui empêche le produit de
progresser sans intervention. Tant qu'il tient, la base reste à 4 465 établissements, avec un
centre-ville sous-compté (voir plus bas).

**Options**
- *Indexer le plafond sur la période du quota* — compter les appels du mois calendaire en
  cours, puisque c'est exactement la contrainte réelle chez Google. Le total par run reste
  utile au rapport, mais ne pilote plus le refus.
- *Remettre `calls_made` à zéro à chaque nouveau mois* — plus simple, mais efface l'historique
  de coût du run, qui est précisément ce qui a permis d'écrire D22.
- *Un plafond par exécution* — c'est ce que le commentaire du code écarte explicitement, et à
  raison : trois relances manuelles dans la même journée dépasseraient le quota.

**Ce que je ferais.** La première option. Le garde-fou doit être adossé à la période du quota
qu'il protège ; aujourd'hui il protège un quota mensuel avec un compteur qui n'a pas de mois.

*Retenu.* Le décompte se lit dans `cell.queried_at` — une cellule interrogée est un appel —
plutôt que dans un registre à tenir à jour : la mesure ne peut pas diverger du réel, et elle
retrouve exactement les 248 appels du 28 août et les 652 du 29.

## 2. Les horaires expirent le 27 septembre, et rien ne le verra

> **Tranché le 29 août** — voir D30 et
> [`technique/11-convergence-du-balayage.md`](technique/11-convergence-du-balayage.md). La
> fraîcheur prime sur la complétude : le cycle mensuel rejoue d'abord ce qui expire. Ce qui a
> dépassé 30 jours ne s'affiche plus. Reste à construire.
>
> **La mesure, elle, est en place.** La péremption est comptée, dite à l'écran à côté de
> l'avancement du balayage, et rapportée par le cycle mensuel à chaque exécution — y compris
> quand une étape échoue, ce qui sera le cas tant que le balayage n'aura pas convergé. C'est
> le socle de la règle de D30, pas la règle : ce qui a expiré est encore affiché.

**Constat.** Les horaires ont été récupérés les 28 et 29 août ; `hours_expires_at` est donc
posé aux 27 et 28 septembre — les 30 jours de rétention imposés par les CGU (D7). Or
`hours_expires_at` est **écrit et jamais lu** : ni par l'application, ni par le balayage, ni
par le cycle mensuel. Aucune requête du produit ne le mentionne.

Aujourd'hui la base compte 0 établissement expiré. Au 28 septembre elle en comptera 4 465, et
l'écran continuera de les afficher comme s'ils étaient frais.

S'y ajoute la règle de reprise : les cellules `done` ne sont pas rejouées. Même si l'axe 1
est corrigé, le balayage de septembre ira chercher les 601 cellules manquantes — il ne
rafraîchira pas les 688 déjà faites, dont les horaires auront dépassé 30 jours.

D7 affirme que « la conformité aux CGU est obtenue par construction, pas par vigilance ».
C'est vrai d'un balayage qui tient dans le mois. Ça ne l'est plus d'un balayage qui déborde,
et le premier a débordé.

**Pourquoi ça compte.** C'est le mode de défaillance que le projet nomme comme le pire :
une base qui se dit à jour et ne l'est pas. La différence avec une liste incomplète, c'est
qu'ici rien ne le signale — pas même une ligne de journal.

**Options**
- *Rendre l'expiration mesurée et visible* — la compter, l'afficher dans la bannière au même
  titre que l'avancement du balayage, et faire échouer le cycle mensuel si elle dépasse un
  seuil. Coût quasi nul, et cela transforme une dérive silencieuse en fait constaté.
- *Purger les horaires expirés* — strictement conforme, mais transforme d'un coup 4 465
  fiches en « Horaires inconnus » : le produit s'éteint plutôt que de vieillir.
- *Rejouer les cellules les plus anciennes en priorité* — fait sens une fois le balayage
  convergé, mais aggrave l'axe 1 tant qu'il ne l'est pas.

**Ce que je ferais.** La mesure d'abord, la politique ensuite. On ne peut pas décider quoi
faire d'une donnée périmée avant de savoir combien il y en a et depuis quand.

## 3. Le coût du balayage complet dépasse le gratuit, et il faut le trancher

> **Tranché le 29 août** — voir D30. Et tranché autrement que ce qui suit : la mesure a montré
> que le coût n'est pas d'abord un problème de périmètre mais de **résolution des
> troncatures**, qui dépense quatre appels pour retirer 12 % de la densité. L'arbitrage
> périmètre/euros est reporté derrière un chiffre à produire à sec, avec sa règle de décision
> écrite d'avance.
>
> Le ratio cité ci-dessous est corrigé au passage : ni 1,16 (configuration) ni 0,78 (récolte
> incomplète divisée par une population complète), mais **0,91 en moyenne et 1,57 au 9ᵉ
> décile**, mesurés sur les cellules qui n'ont pas tronqué. C'est le décile qui dimensionne.

**Constat.** D16 promettait 692 cellules pour 1 000 appels gratuits. Le réel : 653 cellules
mères, 212 tronquées, 664 filles créées au premier niveau, 184 au second. 900 appels dépensés,
601 cellules encore en attente — et celles-ci vont tronquer à leur tour, au rythme mesuré
d'une sur quatre. Il reste donc de l'ordre de **1 200 appels pour converger**, soit deux mois
de quota, sans compter le re-balayage mensuel que D7 impose ensuite.

Un chiffre le confirme au passage : `GOOGLE_TO_SIRENE_RATIO` vaut 1,16 dans la configuration,
alors que le ratio mesuré est celui que D30 retient. Le commentaire de `GRID.maxRadius`
cite toujours le calibrage sur 8 cellules que D22 a invalidé.

**Attention en implémentant D30** : cette constante ne sert pas qu'à la prévision de coût.
Elle pilote aussi le *second* signal de troncature du balayage — celui qui décide quand la
distance du dernier résultat ne dit rien. La baisser vers la moyenne remonterait son seuil de
18 à 26 établissements SIRENE par cellule et rendrait le détecteur **moins** sensible, dans
la direction d'une base silencieusement incomplète. Sur les 900 cellules déjà interrogées,
2 seulement ont atteint l'état où ce signal décide seul et aucune ne bascule ; mais **118 des
601 cellules en attente** tombent dans la bande que ce changement ferait basculer, soit 20 %
du plan restant. C'est une raison de plus de calibrer sur le décile, comme D30 le tranche.

**Pourquoi ça compte.** Le « zéro euro » est posé comme contrainte ferme. Il ne tient plus
arithmétiquement au périmètre actuel. Continuer sans le dire, c'est découvrir la facture.

**Options**
- *Replanifier depuis les cellules feuilles mesurées* plutôt que depuis la densité SIRENE.
  Le balayage suivant paierait la couverture réelle et non sa redécouverte : les 212 appels
  de cellules mères tronquées sont, chaque mois, du pur gâchis. Nécessaire, pas suffisant.
- *Réduire encore le périmètre* — Villeurbanne, c'est 568 établissements ; les 4e, 8e et 9e
  réunis, 684. C'est la voie qui garde le gratuit, au prix d'un morceau de ville.
- *Accepter le dépassement le temps de converger* — quelques euros une fois, puis retour au
  gratuit avec un plan stabilisé. Rompt la contrainte, mais sur une durée bornée et connue.
- *Espacer les balayages* — déjà écarté en D7, et l'axe 2 explique pourquoi : au-delà de 30
  jours on sort des CGU.

**Ce que je ferais.** Mesurer d'abord le coût d'un plan convergé (la première option se joue
à sec, sans dépenser), puis arbitrer périmètre contre euros avec ce chiffre en main. Pas
l'inverse.

---

## 4. La carte ne montre plus qu'un échantillon alphabétique

**Constat.** Depuis la pagination, la carte reçoit les lignes **chargées**, soit 50 sur les
4 465 possibles, triées par nom. Sur la recherche emblématique — sans coupure et week-end
libre, 329 résultats — l'utilisateur voit 50 points choisis par ordre alphabétique, donc
répartis au hasard dans la ville.

La spec fonde pourtant la carte sur une promesse précise : « un quartier entier peut se juger
en un regard ». Ce n'est plus vrai. Le regroupement des points qu'elle prévoit n'existe pas
non plus — il n'était pas nécessaire tant que la liste était plafonnée, il le devient dès que
la carte reçoit tout.

**Pourquoi ça compte.** C'est la seule vue qui donne une lecture géographique, et le ciblage
est un travail géographique. C'est aussi une régression : la carte montrait davantage avant
la pagination.

**Tranché le 29 août — voir D27 et [`fonctionnel/04-carte.md`](fonctionnel/04-carte.md).** La
carte porte tous les résultats filtrés ; c'est la pagination qui est découplée, pas le
contenu. Reste à le construire.

**Ce que ça demande.** Une requête de points distincte de la liste — identifiant, position,
risque de coupure, rien d'autre. Trois colonnes sur 4 465 lignes, c'est quelques centaines de
kilo-octets. Séquentielle, jamais en `Promise.all` (D23, D46). Et le regroupement des points
devient alors indispensable, pas décoratif.

## 5. Le suivi des candidatures n'existe pas

**Constat.** La table `application` est en base, l'énumération des étapes aussi. Zéro ligne,
zéro écran, zéro action serveur : hors du schéma, le mot n'apparaît nulle part dans le code.

**Pourquoi ça compte.** La spec en fait la différence entre « un annuaire qu'on consulte une
fois » et « un outil qu'on rouvre tous les jours ». C'est aussi le seul endroit où
l'utilisateur écrit, et le seul axe de cette liste dont la valeur ne dépend ni de Google ni de
SIRENE : il ne coûte pas un appel.

**Point d'attention.** Les tables ont RLS activé sans politique, et l'application passe par
`DATABASE_URL`. Le cloisonnement entre utilisateurs reposera donc entièrement sur le filtrage
serveur par identifiant. C'est aujourd'hui la seule barrière ; elle mérite d'être posée
explicitement plutôt que d'être supposée.

## 6. L'usage est mobile, la mise en page ne l'est pas

**Constat.** La grille bascule à `lg`. En dessous, le panneau de filtres — six blocs — se
déroule **au-dessus** de la liste : sur un téléphone, il faut faire défiler tous les filtres
avant d'apercevoir un seul résultat. La spec prévoit exactement l'inverse : la carte au-dessus
de la liste, et les filtres dans un panneau qui s'ouvre.

**Pourquoi ça compte.** Le public est en tournée, avec un téléphone. Et l'axe 5 — noter
« CV déposé », « demander Karim » — est une fonction de terrain : elle sera utilisée debout,
sur un trottoir, ou pas du tout.

---

## 7. L'effectif manque là où il décide, et c'est structurel

> **Tranché le 29 août** — voir D31 et
> [`technique/12-justesse-du-verdict.md`](technique/12-justesse-du-verdict.md). **Et la mesure
> a réfuté l'option recommandée plus bas.** Testés sur les 387 établissements dont la coupure
> et l'effectif sont connus, la durée de la coupure, le nombre de jours, la catégorie et
> l'amplitude ne s'écartent pas du taux de base. Ce qui manque n'est pas une règle plus fine :
> ce sont **1 506 tranches d'effectif déjà en base** que l'appariement n'atteint pas, parce
> qu'il exige un nom que 717 enregistrements SIRENE n'ont pas.
>
> Deux chiffres de la section ci-dessous sont faux et conservés tels quels : le plafond d'un
> appariement parfait n'est pas 41 % mais **56 %** (2 480 tranches exploitables pour 4 465
> établissements) ; et la règle de repli n'est pas « binaire à 70 heures » en pratique, elle
> ne déplace que **45 fiches sur 843**.

**Constat.** 1 585 établissements sont appariés à SIRENE (35 %), mais seuls 974 en retirent un
effectif (22 %) : SIRENE lui-même ne connaît la tranche que pour 2 485 de ses 6 010
enregistrements. **Même un appariement parfait plafonnerait autour de 41 %.** Améliorer
l'appariement est utile, mais ne rendra jamais le verdict « confirmé » majoritaire.

Conséquence mesurée : 843 établissements portent un verdict de coupure déduit de la seule
amplitude hebdomadaire, sans aucun effectif. La règle de repli est aujourd'hui binaire — plus
ou moins de 70 heures d'ouverture par semaine.

Et un signal qui mérite l'œil : le risque `low` ne concerne que **8 établissements sur 4 465**.
L'option de filtre « Oui ou probablement » ajoute donc huit lignes à « Oui ». Trois choix pour
deux résultats : soit la règle qui produit `low` est trop étroite — elle exige à la fois un
grand effectif connu et une coupure aux horaires —, soit l'option ment sur ce qu'elle promet.

**Pourquoi ça compte.** C'est la justesse du verdict, donc la valeur du produit. La vision dit
« et que cette liste soit juste ».

**Options**
- *Enrichir la règle de repli avec ce qui est déjà en base et gratuit* — la durée réelle de la
  coupure (deux heures et cinq heures ne se valent pas), le nombre de jours concernés, la
  catégorie (une boulangerie, un fast-food et un bistrot n'ont pas la même mécanique
  d'équipe). Aucun appel, aucune source nouvelle : uniquement mieux lire ce qu'on a.
- *Remonter le taux d'appariement* — 4 135 SIRENE non appariés sur 5 720. Un gain direct sur
  la part « confirmée », sans coût.
- *Assumer le plafond et mieux le dire* — si 40 % de verdicts pleinement confirmés est le
  maximum atteignable, l'écran doit le porter clairement plutôt que de le diluer.

**Ce que je ferais.** La première, d'abord : c'est la seule qui améliore la justesse sans
dépendre d'une source extérieure, et elle se vérifie hors ligne avec `compute:profiles`, sans
toucher au quota.

---

## 8. Petites choses, effet immédiat

| Constat | Mesure | Effet |
|---|---|---|
| La recherche est sensible aux accents | « cafe » trouve 40 fiches, « café » en trouve 222 | 918 noms portent un accent. Sur un clavier de téléphone, on tape sans. `pg_trgm` est là, `unaccent` non |
| Liste et carte ne se répondent pas | la carte ne reçoit ni sélection ni rappel | le survol et le clic croisés prévus par la spec n'existent pas |
| `google.maps.Marker` est déprécié | la bibliothèque `marker` est déjà chargée | remplacement sans coût, avant qu'il ne devienne obligatoire |
| Le tri est figé sur le nom | contrainte du curseur de pagination | chercher un emploi par ordre alphabétique n'a pas de sens ; un tri par rythme demande un curseur composite |
| Le centre est le plus sous-compté | 112 cellules en attente sur le 1er, 111 sur le 2e | la bannière annonce un manque global ; il est concentré là où l'on cherche du travail |
| Aucun test sur les filtres ni la pagination | `grid`, `hours` et `category` en ont | c'est pourtant le chemin qui décide de ce qui s'affiche |

---

## Ordre proposé

1. ~~**Axe 1**~~ — fait le 29 août. Le balayage repartira le 1er septembre.
2. ~~**Axe 2**~~ — fait le 29 août. La péremption est mesurée, dite et rapportée.
3. **Axe 4** — régression sur la promesse centrale, correction bornée.
4. **Axe 3** — arbitrage périmètre/euros, à instruire avec le coût d'un plan convergé.
5. **Axe 5** puis **6** — ce qui fait revenir l'utilisateur, et le terrain où il est.
6. **Axe 7** — le plus profond, le moins urgent : il améliore une base qui tourne déjà.
7. **Axe 8** — au fil de l'eau, en accompagnement des précédents.

> **Révisé le 29 août.** Les axes 1, 2, 3, 4 et 7 sont tranchés — D27, D28, D30 et D31 — et
> attendent d'être construits. L'axe 8 a par ailleurs commencé : D29 a tranché le sort des
> horaires inconnus. Restent à instruire, dans cet ordre : **axe 5** (suivi des candidatures),
> puis **axe 6** (mise en page mobile).

## Ce que je n'ai pas retenu, et pourquoi

- *Filtrer par cuisine* — D24 vient de trancher l'inverse : la cuisine est une information,
  pas un axe de rythme.
- *Afficher un score de fiabilité chiffré* — la vision l'interdit explicitement : des mots,
  jamais un pourcentage.
- *Étendre le périmètre à d'autres communes* — l'axe 3 dit qu'on ne finance déjà pas celui-ci.
- *Mettre en cache les résultats de recherche* — les pages tiennent en quelques millisecondes ;
  ce serait de la complexité sans problème à résoudre.
- *Alerter sur les nouveaux établissements sans coupure* — la spec exclut les notifications, et
  le balayage mensuel ne donnerait de toute façon qu'une fraîcheur de trente jours.
