import { and, count, isNotNull, lte, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
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

/**
 * Past its expiry and still holding the payload.
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
  isNotNull(restaurant.rawOpeningHours),
)!

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

export async function countToPurge(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(restaurant).where(HOURS_TO_PURGE)
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

/**
 * A record whose hours were dated, then purged. Recomputing its profile would read the empty
 * payload as hours Google never published and clear `has_hours`, turning *expired* into
 * *unknown*: the recompute scripts leave it as the purge wrote it, until a sweep brings
 * fresh hours back.
 */
export function hoursPurged(row: { rawOpeningHours: unknown; hoursFetchedAt: Date | null }): boolean {
  return row.rawOpeningHours === null && row.hoursFetchedAt !== null
}
