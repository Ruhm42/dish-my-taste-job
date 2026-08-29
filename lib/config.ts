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
   * Maximum radius in meters. It is a COST ceiling, not a truncation threshold.
   *
   * The 8-cell calibration this figure came from put truncation at ~265 m; the first real
   * sweep measured it from 40 m — there are more than twenty Google places inside forty
   * metres in Presqu'île (D22). No radius avoids truncation in the dense core, so what
   * this constant buys is a bounded number of cells, and the subdivision does the rest.
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
 * Daily cap we set on `SearchNearbyRequest` in the Google console (D15). It is LOWER than
 * the monthly quota, so it — not the month — is what a single execution runs into first.
 */
export const GOOGLE_DAILY_NEARBY_CAP = 800

/**
 * Hard ceiling of `Nearby Search`: 20 places per call, the rest is lost with
 * nothing signalling it. That is the very definition of truncation.
 */
export const MAX_NEARBY_RESULTS = 20

/**
 * Google returns 0.78 establishments where SIRENE counts 1 — 4,465 for 5,720 in perimeter.
 *
 * The 1.16 this replaces came from the 8-cell sample D22 invalidated, and it made the
 * plan's cost forecast lie, which is the one number the perimeter arbitration rests on.
 *
 * Shared between `plan:cells`, which PREDICTS truncation, and `sweep:google`, which
 * DETECTS it — two diverging values would forecast a cost the sweep never spends, with
 * nothing signalling the gap. Lowering it does raise the bar of the sweep's SECOND
 * truncation signal, from 18 SIRENE points per cell to 26; measured on the 900 cells
 * queried so far, that changes no verdict at all, because only 2 of them ever reached the
 * state where that signal decides alone. The distance of the last result does the work.
 *
 * Itself a floor, not a ceiling: 601 cells have never been queried, so the true ratio can
 * only be higher than what is measured here.
 */
export const GOOGLE_TO_SIRENE_RATIO = 0.78

/**
 * Sweep guard rails.
 *
 * There are two ceilings, not one, and each has to sit under the Google limit it shadows —
 * the point being an explicit message instead of an opaque HTTP 429 mid-sweep:
 *
 *   maxCallsPerDay (750)     <  Google daily cap for SearchNearbyRequest (800, D15)
 *   maxCallsPerPeriod (900)  <  FREE_MONTHLY_QUOTA (1,000)
 *
 * The earlier version of this comment collapsed the two into one line and got the order
 * backwards: it read the daily cap as 1,000 and left our counter ABOVE it (D28).
 *
 * The monthly ceiling counts the CALENDAR MONTH, never the sweep. Counting the sweep
 * deadlocked the resume: a run's total can only rise, so once it reached the ceiling no
 * further call could ever be spent, and only a spent call could have moved it.
 *
 * Because the daily ceiling is the lower of the two, one execution can never spend the
 * monthly budget: reaching 900 takes at least two executions on two different UTC days.
 */
export const SWEEP = {
  /** Hard ceiling for one quota period — the month Google bills. See lib/quota.ts. */
  maxCallsPerPeriod: 900,
  /** Hard ceiling for one UTC day. Sits under D15's 800, which is lower than the month. */
  maxCallsPerDay: 750,
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
