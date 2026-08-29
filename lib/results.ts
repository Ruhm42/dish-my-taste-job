import { and, asc, count, eq, gt, or, sql } from 'drizzle-orm'
import { db } from './db/client'
import { cell, restaurant, sireneEstablishment } from './db/schema'
import { buildConditions, type Filters } from './filters'

import { PAGE_SIZE } from './config'
export { PAGE_SIZE }

/**
 * Exactly the columns the list and the map render.
 *
 * `raw_opening_hours` is the largest column in the table and nothing on screen reads it.
 * Selecting explicitly also means adding a field to the UI without adding it here fails
 * to compile, rather than silently reading undefined.
 */
const COLUMNS = {
  id: restaurant.id,
  name: restaurant.name,
  commune: restaurant.commune,
  lat: restaurant.lat,
  lng: restaurant.lng,
  phone: restaurant.phone,
  formattedAddress: restaurant.formattedAddress,
  googlePlaceId: restaurant.googlePlaceId,
  category: restaurant.category,
  cuisine: restaurant.cuisine,
  headcountCode: restaurant.headcountCode,
  splitShiftRisk: restaurant.splitShiftRisk,
  confidence: restaurant.confidence,
  closedWeekend: restaurant.closedWeekend,
  maxConsecutiveDaysOff: restaurant.maxConsecutiveDaysOff,
  explanation: restaurant.explanation,
  schedule: restaurant.schedule,
}

export type ResultRow = {
  [K in keyof typeof COLUMNS]: (typeof restaurant.$inferSelect)[K]
}

/** Where the previous page stopped. Null on the first page. */
export interface Cursor {
  name: string
  id: string
}

export interface Page {
  rows: ResultRow[]
  /** Null when the list is exhausted — that is what stops the infinite scroll. */
  nextCursor: Cursor | null
}

/**
 * One page of results, ordered by name.
 *
 * Keyset pagination rather than OFFSET: an OFFSET makes the database walk and discard
 * every skipped row, so page 40 costs forty times page 1. It also duplicates or drops
 * rows when the underlying data shifts between requests — and this table is rewritten
 * wholesale by the monthly sweep.
 *
 * Names are not unique (two "Le Bouchon"), so the key is the pair (name, id). Without the
 * id the pagination would loop on a name collision, showing the same rows forever.
 */
export async function fetchPage(filters: Filters, cursor: Cursor | null): Promise<Page> {
  const conditions = buildConditions(filters)
  const after = cursor
    ? or(
        gt(restaurant.name, cursor.name),
        and(eq(restaurant.name, cursor.name), gt(restaurant.id, cursor.id)),
      )
    : undefined

  // One extra row: its presence is what tells us another page exists, without a second
  // count query.
  const rows = await db
    .select(COLUMNS)
    .from(restaurant)
    .where(conditions && after ? and(conditions, after) : (conditions ?? after))
    .orderBy(asc(restaurant.name), asc(restaurant.id))
    .limit(PAGE_SIZE + 1)

  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = page[page.length - 1]

  return {
    rows: page,
    nextCursor: hasMore && last ? { name: last.name, id: last.id } : null,
  }
}

/** Total matching the filters, independent of pagination. */
export async function countResults(filters: Filters): Promise<number> {
  const [row] = await db.select({ n: count() }).from(restaurant).where(buildConditions(filters))
  return row?.n ?? 0
}

export interface SweepProgress {
  /** Establishments the sweep has actually brought back. */
  found: number
  /** Cells queried at least once. */
  queried: number
  /** Cells never queried yet. */
  pending: number
  /** Cells that returned the 20-result cap and still owe their subdivisions. */
  truncated: number
  /** Cells created so far. It GROWS as truncations are discovered. */
  known: number
  /** SIRENE establishments in the perimeter — an exhaustive reference for scale. */
  sirene: number
}

/**
 * How far the sweep has got, in measured quantities only.
 *
 * There is deliberately no "estimated total" here. A truncated cell returned exactly 20
 * results and hid an unknown number beyond that: the data is censored, so any total would
 * be a guess dressed as a measurement. Worse, extrapolating from the measured
 * Google/SIRENE ratio understates it precisely where it matters — a cell truncates
 * *because* its density exceeds that ratio.
 *
 * `known` is not a finish line either: resolving a truncation creates four new cells, so
 * the denominator rises as the sweep advances. Saying "900 of 1,501" would promise a
 * fixed target that does not exist.
 */
export async function fetchSweepProgress(): Promise<SweepProgress> {
  const [row] = await db
    .select({
      found: sql<number>`(SELECT count(*) FROM ${restaurant})::int`,
      queried: sql<number>`count(*) FILTER (WHERE ${cell.status} <> 'pending')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${cell.status} = 'pending')::int`,
      truncated: sql<number>`count(*) FILTER (WHERE ${cell.status} = 'truncated')::int`,
      known: sql<number>`count(*)::int`,
      sirene: sql<number>`(SELECT count(*) FROM ${sireneEstablishment})::int`,
    })
    .from(cell)

  return row ?? { found: 0, queried: 0, pending: 0, truncated: 0, known: 0, sirene: 0 }
}
