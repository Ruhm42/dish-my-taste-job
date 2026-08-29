import { and, eq, gte, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { restaurant } from './db/schema'

/**
 * Search filters, read from the URL query string.
 *
 * Two vocabularies meet here, and mixing them up returns an empty page with no error:
 *  - the WIRE vocabulary — query parameter names and their values — is frozen in French,
 *    because it is part of links the user may already have bookmarked
 *  - the DB vocabulary is English, because it is the Postgres enum
 *
 * `categories` is the one place the two coincide: its values go straight into the
 * `category` enum comparison, so they had to follow the enum when it was translated.
 */
export interface Filters {
  zones: string[]
  splitShift: 'sans' | 'sans-ou-probable' | ''
  weekend: 'libre' | 'dimanche' | ''
  twoDaysOff: boolean
  /** Values of the `category` enum, e.g. `bistro`, `fast_food`. */
  categories: string[]
  teamSize: 'petit' | 'moyen' | 'grand' | ''
  q: string
  /** Bring back the establishments whose hours Google does not publish. Off by default. */
  includeUnknownHours: boolean
}

/** The only Google business status the directory lists. See D29. */
const OPERATIONAL = 'OPERATIONAL'

/** Inverse of the headcount table in lib/hours: keep the brackets in sync with it. */
const HEADCOUNT_CODES_BY_SIZE: Record<string, string[]> = {
  petit: ['00', '01', '02'],
  moyen: ['03', '11'],
  grand: ['12', '21', '22', '31', '32', '41', '42', '51', '52', '53'],
}

const toList = (v: string | string[] | undefined): string[] =>
  !v ? [] : Array.isArray(v) ? v : [v]

export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]) ?? ''
  return {
    zones: toList(params.zone),
    splitShift: one('coupure') as Filters['splitShift'],
    weekend: one('weekend') as Filters['weekend'],
    twoDaysOff: one('repos2') === '1',
    categories: toList(params.categorie),
    teamSize: one('taille') as Filters['teamSize'],
    q: one('q').trim(),
    includeUnknownHours: one('inconnus') === '1',
  }
}

/**
 * What the reader asked for. Filtering rests entirely on the denormalized columns: no
 * inference here.
 */
function userConditions(f: Filters): SQL[] {
  const c: (SQL | undefined)[] = []

  if (f.zones.length) c.push(inArray(restaurant.inseeCode, f.zones))

  if (f.splitShift === 'sans') c.push(eq(restaurant.splitShiftRisk, 'none'))
  else if (f.splitShift === 'sans-ou-probable') {
    c.push(inArray(restaurant.splitShiftRisk, ['none', 'low']))
  }

  if (f.weekend === 'libre') c.push(eq(restaurant.closedWeekend, true))
  else if (f.weekend === 'dimanche') c.push(eq(restaurant.closedSunday, true))

  if (f.twoDaysOff) c.push(gte(restaurant.maxConsecutiveDaysOff, 2))
  if (f.categories.length) c.push(inArray(restaurant.category, f.categories as never[]))
  if (f.teamSize && HEADCOUNT_CODES_BY_SIZE[f.teamSize]) {
    c.push(inArray(restaurant.headcountCode, HEADCOUNT_CODES_BY_SIZE[f.teamSize]))
  }

  if (f.q) {
    c.push(or(ilike(restaurant.name, `%${f.q}%`), ilike(restaurant.commune, `%${f.q}%`)))
  }

  return c.filter(Boolean) as SQL[]
}

/**
 * What the directory leaves out, whatever the search.
 *
 * Two very different silences, and only one of them is the reader's to lift:
 *
 *  - **Google says the place is shut.** That is not missing information, it is information:
 *    a closed restaurant is not an employer. It never appears, and the screen says how many
 *    were set aside rather than letting the count drop without a word.
 *  - **Google publishes no hours.** Measured: those establishments match SIRENE 8% of the
 *    time against 41% for the rest, and carry a phone number once in five against nine in
 *    ten. Thin sheets, and the tool can say nothing about the one thing it exists to say.
 *    They are set aside BY DEFAULT and come back in one click — the spec forbids hiding
 *    what we do not know, not leaving it out of the default answer.
 */
function exclusions(f: Filters): SQL[] {
  const out: SQL[] = []

  const stillTrading = or(isNull(restaurant.businessStatus), eq(restaurant.businessStatus, OPERATIONAL))
  if (stillTrading) out.push(stillTrading)

  if (!f.includeUnknownHours) out.push(eq(restaurant.hasHours, true))

  return out
}

export function buildConditions(f: Filters): SQL | undefined {
  const all = [...userConditions(f), ...exclusions(f)]
  return all.length ? and(...all) : undefined
}

/**
 * The same search WITHOUT the exclusions.
 *
 * This is what the count line reports on: "349 set aside" only means something measured
 * against the reader's own criteria, not against the whole table.
 */
export function buildUserConditions(f: Filters): SQL | undefined {
  const c = userConditions(f)
  return c.length ? and(...c) : undefined
}

export function countActive(f: Filters): number {
  return [
    f.zones.length > 0, !!f.splitShift, !!f.weekend, f.twoDaysOff,
    f.categories.length > 0, !!f.teamSize, !!f.q, f.includeUnknownHours,
  ].filter(Boolean).length
}
