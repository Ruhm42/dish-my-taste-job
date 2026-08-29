/**
 * Area and sweep parameters.
 * The area is configuration, never a hard-coded value (D2).
 */

/** Lyon 1st-9th districts + Villeurbanne — narrowed perimeter, see D16. */
export const COMMUNE_CODES = [
  '69381', '69382', '69383', '69384', '69385',
  '69386', '69387', '69388', '69389', // Lyon 1st → 9th
  '69266',                            // Villeurbanne
] as const

/**
 * SIRENE codes Lyon establishments by DISTRICT (69381-69389), never by the
 * global commune code 69123 — which is nonetheless the only one the French
 * government geo API returns. Filtering on the latter silently drops 5,639
 * establishments without raising a single error.
 */
export const DISTRICT_BY_COMMUNE: Record<string, number | null> = {
  '69381': 1, '69382': 2, '69383': 3, '69384': 4, '69385': 5,
  '69386': 6, '69387': 7, '69388': 8, '69389': 9,
  '69266': null, // Villeurbanne
}

export const COMMUNE_NAMES: Record<string, string> = {
  '69381': 'Lyon 1er', '69382': 'Lyon 2e', '69383': 'Lyon 3e',
  '69384': 'Lyon 4e', '69385': 'Lyon 5e', '69386': 'Lyon 6e',
  '69387': 'Lyon 7e', '69388': 'Lyon 8e', '69389': 'Lyon 9e',
  '69266': 'Villeurbanne',
}

/** Activity codes we keep. 56.21Z (caterers) is excluded: no dining-room service. */
export const NAF_CODES = [
  '56.10A', // traditional restaurants
  '56.10B', // cafeterias and self-service
  '56.10C', // fast food
  '56.29A', // contract catering
  '56.29B', // other food services
  '56.30Z', // drinking places
] as const

/** SIRENE stock file, downloadable without an account or a key (D13). */
export const SIRENE_PARQUET =
  'https://static.data.gouv.fr/resources/base-sirene-des-entreprises-et-de-leurs-etablissements' +
  '-siren-siret/20260801-074451/stock-stocketablissement-parquet.parquet'

export const BAN_CSV = 'https://api-adresse.data.gouv.fr/search/csv/'

/** Grid parameters — see D17 and technique/03-algorithme-de-balayage.md */
export const GRID = {
  /** SIRENE establishments targeted per cell. */
  target: 15,
  /**
   * Maximum radius in meters. This is the DOMINANT constraint, and it is measured:
   * beyond ~265 m Google truncates to 20 results, and at 168 m it already returns 18.
   * 200 m keeps a margin without multiplying the number of cells.
   */
  maxRadius: 200,
  /** A zero radius searches nothing. */
  minRadius: 40,
  /** BAN geocoding score below which the point is not used. */
  minGeocodeScore: 0.6,
} as const

/**
 * Google field mask — SINGLE SHARED CONSTANT.
 * Billing follows the most expensive field requested: one `places.rating` added
 * by mistake moves the whole call to a higher tier. Never build this list
 * dynamically.
 */
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  // Google's own primary classification. It belongs to the Pro tier, and billing follows
  // the most expensive field requested — `regularOpeningHours` already puts this call on
  // Enterprise, so this one is free. It replaces our inference from `types[0]`.
  'places.primaryType',
  'places.businessStatus',
  'places.regularOpeningHours',
  'places.nationalPhoneNumber',
].join(',')

export const GOOGLE_PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'meal_takeaway'] as const

/** Free Enterprise quota per month. Past it, it is the credit card — there is no trial credit. */
export const FREE_MONTHLY_QUOTA = 1000

/**
 * Hard ceiling of `Nearby Search`: 20 places per call, the rest is lost with
 * nothing signalling it. That is the very definition of truncation.
 */
export const MAX_NEARBY_RESULTS = 20

/**
 * Measured (D16): Google returns 1.16 establishments where SIRENE counts 1.
 * Shared between `plan:cells`, which PREDICTS truncation, and `sweep:google`, which
 * DETECTS it — two diverging values would forecast a cost the sweep never spends,
 * with nothing signalling the gap.
 *
 * D30 has since ruled that this ceiling calibrates on the NINTH DECILE of the measured
 * ratio (1.57) rather than its mean (0.91) — a cell truncates by what it has of the
 * extreme, never by its average — and caps a cell at 12 SIRENE establishments. Changing
 * the value belongs to that implementation: lowering it toward the mean would raise the
 * bar of the sweep's second truncation signal and make the detector LESS sensitive,
 * which is the direction of a silently incomplete database.
 */
export const GOOGLE_TO_SIRENE_RATIO = 1.16

/**
 * Sweep guard rails.
 *
 * The order in which they trip matters as much as the values:
 *
 *   maxCallsPerPeriod (900)  <  Google daily cap on SearchNearbyRequest (1,000)
 *                            =  FREE_MONTHLY_QUOTA (1,000)
 *
 * Our counter therefore stops BEFORE the Google ceiling, which yields an explicit message
 * instead of an opaque HTTP 429 in the middle of the sweep. And because 900 stays under the
 * free monthly quota, **a period can never on its own cause any billing**, even if the
 * whole budget goes on subdivisions.
 *
 * The daily cap is recorded at 1,000 in technique/02, *posés et vérifiés le 2026-08-28*.
 * D15 says 800 — that value was superseded precisely because it sat BELOW this counter.
 * A separate daily ceiling of our own would therefore protect nothing the month does not
 * already protect, and any value under 900 would only cut what the monthly cycle can spend
 * in one go.
 *
 * What the ceiling counts is the CALENDAR MONTH, never the sweep. Counting the sweep
 * deadlocked the resume: a run's total can only rise, so once it reached the ceiling no
 * further call could ever be spent, and only a spent call could have moved it (D28).
 */
export const SWEEP = {
  /** Hard ceiling for one quota period — the month Google bills. See lib/quota.ts. */
  maxCallsPerPeriod: 900,
  /** Subdivision depth beyond which a cell is declared irreducible. */
  maxDepth: 4,
  /**
   * A sweep that succeeded within the last N days blocks any new run.
   * The quota is monthly: two sweeps in one month would consume it entirely.
   */
  daysBetweenSweeps: 25,
} as const

/** Places content retention period imposed by the Google terms of service (D7). */
export const HOURS_TTL_DAYS = 30

/**
 * Rows per page in the results list.
 *
 * Lives here rather than in lib/results.ts because the client list needs the value:
 * importing it from the query module would drag the Postgres client into the browser
 * bundle, which is exactly what broke the build once.
 */
export const PAGE_SIZE = 50
