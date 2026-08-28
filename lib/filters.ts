import { and, eq, gte, ilike, inArray, or, type SQL } from 'drizzle-orm'
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
}

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
  }
}

/** Filtering rests entirely on the denormalized columns: no inference here. */
export function buildConditions(f: Filters): SQL | undefined {
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

  const active = c.filter(Boolean) as SQL[]
  return active.length ? and(...active) : undefined
}

export function countActive(f: Filters): number {
  return [
    f.zones.length > 0, !!f.splitShift, !!f.weekend, f.twoDaysOff,
    f.categories.length > 0, !!f.teamSize, !!f.q,
  ].filter(Boolean).length
}
