import { and, count, gt, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { restaurant } from './db/schema'

/**
 * D45: the terms limit what we KEEP, not only what we show. D30 rule 6 already hides hours
 * past `hours_expires_at`; this is what stops storing them.
 */

const DEFAULT = sql`DEFAULT`

/**
 * Every column the purge empties: the raw payload, and every column `profileColumns` derives
 * from it but one. Reset to the column default, which is what a record with no hours holds —
 * and what the projection already shows for an expired record, so the screen does not change.
 *
 * `has_hours` stays, with `hours_fetched_at` and `hours_expires_at`. The three are facts
 * about our collection, not Google content, and `has_hours` is the one the counters read:
 * HOURS_EXPIRED is `has_hours AND NOT usable`. Cleared, an expired record would read as
 * hours Google never published, and the screen would say the wrong silence.
 */
export const CLEARED = {
  rawOpeningHours: DEFAULT,
  schedule: DEFAULT,
  openDaysCount: DEFAULT,
  closedDays: DEFAULT,
  closedSaturday: DEFAULT,
  closedSunday: DEFAULT,
  closedWeekend: DEFAULT,
  maxConsecutiveDaysOff: DEFAULT,
  splitDaysCount: DEFAULT,
  splitShiftRisk: DEFAULT,
  confidence: DEFAULT,
  servicePattern: DEFAULT,
  earliestOpenMin: DEFAULT,
  latestCloseMin: DEFAULT,
  weeklyOpenMinutes: DEFAULT,
  explanation: DEFAULT,
}

type ClearedColumn = keyof typeof CLEARED
const CLEARED_COLUMNS = Object.keys(CLEARED) as ClearedColumn[]

/**
 * The column holds something other than what the purge writes into it. Read off the schema
 * rather than listed again, so a column added to CLEARED is a column this predicate watches.
 */
function holdsContent(key: ClearedColumn): SQL {
  const column: AnyPgColumn = restaurant[key]
  return column.default === undefined ? isNotNull(column) : ne(column, column.default)
}

/**
 * Past its expiry and holding anything the purge clears.
 *
 * Not only the payload (D49). An offline step that read a record before the purge and wrote it
 * after puts back a schedule and a profile while the payload stays empty; the purge still owes
 * that content. Every cleared column holds its default once the purge has run, so its own write
 * takes a record out of this set, and a second run finds nothing.
 *
 * `<=` because HOURS_USABLE is `> now()`: the purge starts on the very instant the page stops
 * showing, so no record is ever hidden yet still stored past the next run. On the database
 * clock, for the same reason the page reads it.
 *
 * Undated hours are left alone: the page treats them as expired, but no writer produces them
 * and there is no expiry date to purge them on.
 */
export const HOURS_TO_PURGE = and(
  lte(restaurant.hoursExpiresAt, sql`now()`),
  or(...CLEARED_COLUMNS.map(holdsContent)),
)!

/**
 * Among HOURS_TO_PURGE, the records whose payload a purge already emptied: content written
 * back after it. Since D49 rule 2 the offline steps no longer do that, so a non-zero count
 * names a writer that does not check what it read.
 */
const REWRITTEN_AFTER_PURGE = and(HOURS_TO_PURGE, isNull(restaurant.rawOpeningHours))!

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

export async function countToPurge(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(restaurant).where(HOURS_TO_PURGE)
  return row?.n ?? 0
}

export async function countRewrittenAfterPurge(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(restaurant).where(REWRITTEN_AFTER_PURGE)
  return row?.n ?? 0
}

/** Returns how many records it cleared. One statement: a failure clears nothing. */
export async function purgeExpiredHours(db: Db): Promise<number> {
  const cleared = await db.update(restaurant)
    .set(CLEARED)
    .where(HOURS_TO_PURGE)
    .returning({ id: restaurant.id })
  return cleared.length
}

type HoursAsRead = { rawOpeningHours: unknown; hoursFetchedAt: Date | null }

/**
 * A record whose hours were dated, then purged. Recomputing its profile would read the empty
 * payload as hours Google never published and clear `has_hours`, turning *expired* into
 * *unknown*: the recompute scripts leave it as the purge wrote it, until a sweep brings
 * fresh hours back.
 */
export function hoursPurged(row: HoursAsRead): boolean {
  return row.rawOpeningHours === null && row.hoursFetchedAt !== null
}

/**
 * D49 rule 2: the record still holds the hours a recompute read — not emptied by a purge, not
 * refreshed by a sweep — so what it computed from them may be written. A condition of the
 * UPDATE itself rather than a check before it: the row lock re-reads it if the purge commits
 * in between, so no window is left.
 *
 * The purge empties the payload and keeps the dates, hence the payload's presence; a sweep
 * re-dates it, hence the fetch date. Compared within a millisecond: Postgres keeps
 * microseconds and a JS Date does not, so a date read and sent back is not always equal to
 * itself. Two fetches of the same record are days apart.
 */
export function hoursUnchangedSince(read: HoursAsRead): SQL {
  const payload = read.rawOpeningHours === null
    ? isNull(restaurant.rawOpeningHours)
    : isNotNull(restaurant.rawOpeningHours)
  if (read.hoursFetchedAt === null) return and(payload, isNull(restaurant.hoursFetchedAt))!
  const fetched = sql`${read.hoursFetchedAt.toISOString()}::timestamptz`
  return and(
    payload,
    gt(restaurant.hoursFetchedAt, sql`${fetched} - interval '1 millisecond'`),
    lt(restaurant.hoursFetchedAt, sql`${fetched} + interval '1 millisecond'`),
  )!
}
