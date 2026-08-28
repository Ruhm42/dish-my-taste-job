/**
 * Paramètres de la zone et du balayage.
 * La zone est une configuration, jamais une valeur en dur (D2).
 */

/** Lyon 1er-9e + Villeurbanne — périmètre resserré, voir D16. */
export const COMMUNES = [
  '69381', '69382', '69383', '69384', '69385',
  '69386', '69387', '69388', '69389', // Lyon 1er → 9e
  '69266',                            // Villeurbanne
] as const

/**
 * SIRENE code les établissements lyonnais par ARRONDISSEMENT (69381-69389),
 * jamais par la commune globale 69123 — que l'API géographique de l'État est
 * pourtant seule à renvoyer. Filtrer sur cette dernière ferait disparaître
 * 5 639 établissements sans la moindre erreur remontée.
 */
export const ARRONDISSEMENT_PAR_COMMUNE: Record<string, number | null> = {
  '69381': 1, '69382': 2, '69383': 3, '69384': 4, '69385': 5,
  '69386': 6, '69387': 7, '69388': 8, '69389': 9,
  '69266': null, // Villeurbanne
}

export const NOM_COMMUNE: Record<string, string> = {
  '69381': 'Lyon 1er', '69382': 'Lyon 2e', '69383': 'Lyon 3e',
  '69384': 'Lyon 4e', '69385': 'Lyon 5e', '69386': 'Lyon 6e',
  '69387': 'Lyon 7e', '69388': 'Lyon 8e', '69389': 'Lyon 9e',
  '69266': 'Villeurbanne',
}

/** Codes d'activité retenus. 56.21Z (traiteurs) est exclu : pas de service en salle. */
export const CODES_NAF = [
  '56.10A', // restauration traditionnelle
  '56.10B', // cafétérias et libres-services
  '56.10C', // restauration rapide
  '56.29A', // restauration collective sous contrat
  '56.29B', // autres services de restauration
  '56.30Z', // débits de boissons
] as const

/** Fichier stock SIRENE, téléchargeable sans compte ni clé (D13). */
export const SIRENE_PARQUET =
  'https://static.data.gouv.fr/resources/base-sirene-des-entreprises-et-de-leurs-etablissements' +
  '-siren-siret/20260801-074451/stock-stocketablissement-parquet.parquet'

export const BAN_CSV = 'https://api-adresse.data.gouv.fr/search/csv/'

/** Paramètres du maillage — voir D17 et technique/03-algorithme-de-balayage.md */
export const MAILLAGE = {
  /** Établissements SIRENE visés par cellule. */
  cible: 15,
  /**
   * Rayon maximal en mètres. C'est la contrainte DOMINANTE, mesurée :
   * au-delà de ~265 m Google tronque à 20 résultats, à 168 m il en renvoie 18.
   * 200 m garde une marge sans multiplier les cellules.
   */
  rayonMax: 200,
  /** Un rayon nul ne cherche rien. */
  rayonMin: 40,
  /** Score de géocodage BAN en deçà duquel on n'utilise pas le point. */
  scoreGeocodeMin: 0.6,
} as const

/**
 * Field mask Google — CONSTANTE UNIQUE ET PARTAGÉE.
 * La facturation s'applique au champ le plus cher demandé : un `places.rating`
 * ajouté par mégarde bascule sur un palier supérieur. Ne jamais construire
 * cette liste dynamiquement.
 */
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
  'places.regularOpeningHours',
  'places.nationalPhoneNumber',
].join(',')

export const TYPES_GOOGLE = ['restaurant', 'cafe', 'bar', 'meal_takeaway'] as const

/** Quota Enterprise gratuit par mois. Au-delà, c'est la carte bancaire — il n'y a pas de crédit. */
export const QUOTA_MENSUEL_GRATUIT = 1000

/**
 * Plafond dur de `Nearby Search` : 20 lieux par appel, le reste est perdu sans que
 * rien ne le signale. C'est la définition même de la troncature.
 */
export const RESULTATS_MAX_NEARBY = 20

/**
 * Mesuré (D16) : Google renvoie 1,16 établissement là où SIRENE en compte 1.
 * Partagé entre `plan:cells`, qui PRÉDIT la troncature, et `sweep:google`, qui la
 * DÉTECTE — deux valeurs divergentes feraient prévoir un coût que le balayage
 * ne consommerait pas, sans que rien ne le signale.
 */
export const RATIO_GOOGLE_SIRENE = 1.16

/**
 * Garde-fous du balayage.
 *
 * L'ordre de déclenchement compte autant que les valeurs :
 *
 *   appelsMax (900)  <  quota Google journalier (1 000)  =  QUOTA_MENSUEL_GRATUIT
 *
 * Notre compteur s'arrête donc AVANT le plafond Google, ce qui donne un message
 * explicite au lieu d'un HTTP 429 opaque en plein milieu du balayage. Et comme 900
 * reste sous le quota mensuel gratuit, **un balayage ne peut à lui seul provoquer
 * aucune facturation**, même s'il consomme tout son budget en subdivisions.
 */
export const BALAYAGE = {
  /** Plafond dur côté script. Se déclenche avant le quota Google, volontairement. */
  appelsMax: 900,
  /** Profondeur de subdivision au-delà de laquelle une cellule est dite irréductible. */
  profondeurMax: 4,
  /**
   * Un balayage réussi dans les N derniers jours bloque toute nouvelle exécution.
   * Le quota est mensuel : deux balayages dans le mois le consommeraient entièrement.
   */
  joursEntreBalayages: 25,
} as const

/** Durée de conservation du contenu Places imposée par les CGU Google (D7). */
export const TTL_HORAIRES_JOURS = 30
