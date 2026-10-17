import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { createRequire } from 'node:module'
import { inArray, sql, type SQL } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { restaurant } from '@/lib/db/schema'
import {
  buildConditions, buildUserConditions, EXCLUDED_BECAUSE, HOURS_EXPIRED, HOURS_USABLE,
  parseFilters,
} from '@/lib/filters'
import { computeProfile, parseOpeningHours } from '@/lib/hours'
import type { GoogleOpeningHours, GooglePeriod } from '@/lib/hours'
import { profileColumns } from '@/lib/profile-columns'
import { CLEARED, countToPurge, hoursPurged, purgeExpiredHours } from '@/lib/purge'

/*
 * The purge is one UPDATE whose correctness lives in Postgres: `SET … = DEFAULT`, a date
 * compared on the database clock, and the counters' three-valued logic read back after it.
 * PGlite runs the real statement on the real schema, generated from lib/db/schema.ts, so a
 * column added there is a column the test has too.
 */

// The ESM build of drizzle-kit's API breaks on a dynamic require of `fs`; the CommonJS one loads.
const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)(
  'drizzle-kit/api',
) as typeof import('drizzle-kit/api')

let client: PGlite
let db: ReturnType<typeof drizzle>

const service = (day: number, open: number, close: number): GooglePeriod => ({
  open: { day, hour: Math.floor(open / 60), minute: open % 60 },
  close: { day, hour: Math.floor(close / 60), minute: close % 60 },
})

/** Monday to Friday, lunch and dinner: a free weekend, two days off in a row, a split. */
const WEEKDAYS: GoogleOpeningHours = {
  periods: [1, 2, 3, 4, 5].flatMap((d) => [service(d, 720, 870), service(d, 1140, 1350)]),
}

type Fixture = {
  id: string
  hours: GoogleOpeningHours | null
  expiresAt: SQL | null
}

const FIXTURES: Fixture[] = [
  { id: 'fresh', hours: WEEKDAYS, expiresAt: sql`now() + interval '10 days'` },
  { id: 'expired', hours: WEEKDAYS, expiresAt: sql`now() - interval '1 day'` },
  // What the sweep writes for a place Google gives no hours: no payload, no dates.
  { id: 'no-hours', hours: null, expiresAt: null },
  // Google sent an hours object with no usable period: dated, yet no week was ever shown.
  { id: 'no-period-expired', hours: { periods: [] }, expiresAt: sql`now() - interval '1 day'` },
]

/** Written the way the sweep writes a place, so the profile is the real one. */
function row(f: Fixture) {
  const windows = parseOpeningHours(f.hours)
  const profile = computeProfile({ windows, headcountCode: '01', category: 'bistro' })
  return {
    id: crypto.randomUUID(),
    googlePlaceId: f.id,
    name: f.id,
    lat: 45.76,
    lng: 4.83,
    inseeCode: '69381',
    category: 'bistro' as const,
    headcountCode: '01',
    rawOpeningHours: f.hours,
    hoursFetchedAt: f.expiresAt ? sql`${f.expiresAt} - interval '30 days'` : null,
    hoursExpiresAt: f.expiresAt,
    ...profileColumns(windows, profile),
  }
}

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client)
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema))
  for (const statement of statements) await client.exec(statement)
})

afterAll(async () => {
  await client?.close()
})

beforeEach(async () => {
  await db.delete(restaurant)
  await db.insert(restaurant).values(FIXTURES.map(row))
})

async function byPlace() {
  const rows = await db.select().from(restaurant)
  return Object.fromEntries(rows.map((r) => [r.googlePlaceId, r]))
}

/** The ids each expression holds for, among the rows matching `where`. */
async function where(expr: SQL | undefined): Promise<string[]> {
  const rows = await db.select({ id: restaurant.googlePlaceId }).from(restaurant)
    .where(expr).orderBy(restaurant.googlePlaceId)
  return rows.map((r) => r.id)
}

/** `countExcluded`'s query, on this database. */
async function excluded(params: Parameters<typeof parseFilters>[0]) {
  const [counts] = await db.select({
    matching: sql<number>`count(*)::int`,
    kept: sql<number>`count(*) FILTER (WHERE ${buildConditions(parseFilters(params)) ?? sql`true`})::int`,
    closed: sql<number>`count(*) FILTER (WHERE ${EXCLUDED_BECAUSE.closed})::int`,
    unknownHours: sql<number>`count(*) FILTER (WHERE ${EXCLUDED_BECAUSE.unknownHours})::int`,
    expiredHours: sql<number>`count(*) FILTER (WHERE ${EXCLUDED_BECAUSE.expiredHours})::int`,
  }).from(restaurant).where(buildUserConditions(parseFilters(params)))
  return counts!
}

describe('what the purge clears', () => {
  it('empties the payload and the profile of an expired record', async () => {
    await purgeExpiredHours(db)
    const after = (await byPlace()).expired!

    expect(after.rawOpeningHours).toBeNull()
    expect(after.schedule).toBeNull()
    expect(after).toMatchObject({
      openDaysCount: 0,
      closedDays: null,
      closedSaturday: false,
      closedSunday: false,
      closedWeekend: false,
      maxConsecutiveDaysOff: 0,
      splitDaysCount: 0,
      splitShiftRisk: 'unknown',
      confidence: 'unverified',
      servicePattern: null,
      earliestOpenMin: null,
      latestCloseMin: null,
      weeklyOpenMinutes: 0,
      explanation: '',
    })
  })

  it('keeps the dates and has_hours, which are ours and not Google content', async () => {
    const before = (await byPlace()).expired!
    await purgeExpiredHours(db)
    const after = (await byPlace()).expired!

    expect(after.hasHours).toBe(true)
    expect(after.hoursFetchedAt).toEqual(before.hoursFetchedAt)
    expect(after.hoursExpiresAt).toEqual(before.hoursExpiresAt)
    expect(after.name).toBe(before.name)
    expect(after.headcountCode).toBe(before.headcountCode)
  })

  it('leaves fresh hours and records without hours untouched', async () => {
    const before = await byPlace()
    await purgeExpiredHours(db)
    const after = await byPlace()

    expect(after.fresh).toEqual(before.fresh)
    expect(after['no-hours']).toEqual(before['no-hours'])
  })

  // A dated payload with no usable period is still Google content past its expiry.
  it('clears a dated payload that never showed a week', async () => {
    await purgeExpiredHours(db)
    expect((await byPlace())['no-period-expired']!.rawOpeningHours).toBeNull()
  })

  it('covers every column the profile writes, except has_hours', () => {
    const written = Object.keys(profileColumns([], computeProfile({ windows: [], headcountCode: null })))
    expect(Object.keys(CLEARED).sort()).toEqual(
      ['rawOpeningHours', ...written.filter((c) => c !== 'hasHours')].sort(),
    )
  })
})

describe('the dry run and the write', () => {
  it('counts exactly what the write then clears, and a second run clears nothing', async () => {
    expect(await countToPurge(db)).toBe(2)
    expect(await purgeExpiredHours(db)).toBe(2)
    expect(await countToPurge(db)).toBe(0)
    expect(await purgeExpiredHours(db)).toBe(0)
  })

  it('writes nothing when it only counts', async () => {
    const before = await byPlace()
    await countToPurge(db)
    expect(await byPlace()).toEqual(before)
  })
})

describe('the expiry boundary', () => {
  // now() is fixed for a whole transaction, which is what makes "exactly now" testable.
  it('starts on the very instant the page stops showing the hours', async () => {
    await db.transaction(async (tx) => {
      await tx.insert(restaurant).values([
        row({ id: 'expires-now', hours: WEEKDAYS, expiresAt: sql`now()` }),
        row({ id: 'expires-next', hours: WEEKDAYS, expiresAt: sql`now() + interval '1 millisecond'` }),
      ])

      const usable = async () => (await tx.select({ id: restaurant.googlePlaceId }).from(restaurant)
        .where(HOURS_USABLE)).map((r) => r.id).sort()
      expect(await usable()).toEqual(['expires-next', 'fresh'])

      await purgeExpiredHours(tx)
      const rows = await tx.select().from(restaurant)
        .where(inArray(restaurant.googlePlaceId, ['expires-now', 'expires-next']))
      const raw = Object.fromEntries(rows.map((r) => [r.googlePlaceId, r.rawOpeningHours]))

      expect(raw['expires-now']).toBeNull()
      expect(raw['expires-next']).toEqual(WEEKDAYS)
    })
  })
})

describe('expired, not unknown, after the purge', () => {
  it('still reads the purged record as expired hours', async () => {
    await purgeExpiredHours(db)
    expect(await where(HOURS_EXPIRED)).toEqual(['expired'])
    expect(await where(EXCLUDED_BECAUSE.expiredHours)).toEqual(['expired'])
    expect(await where(EXCLUDED_BECAUSE.unknownHours)).toEqual(['no-hours', 'no-period-expired'])
  })

  it('leaves the default search counts as they were', async () => {
    const before = await excluded({})
    await purgeExpiredHours(db)
    expect(await excluded({})).toEqual(before)
    expect(before).toMatchObject({ matching: 4, kept: 1, unknownHours: 2, expiredHours: 1 })
  })

  it('still lists the purged record when the reader asks for the unknown ones', async () => {
    await purgeExpiredHours(db)
    expect(await where(buildConditions(parseFilters({ inconnus: '1' })))).toEqual([
      'expired', 'fresh', 'no-hours', 'no-period-expired',
    ])
  })

  // The one count the purge changes, by design: whether the record had a free weekend is
  // exactly what D45 says we may no longer keep. The total still accounts for every match.
  it('stops matching a rhythm criterion, without breaking the total', async () => {
    const weekend = { weekend: 'libre' }
    expect(await excluded(weekend)).toMatchObject({ matching: 2, kept: 1, expiredHours: 1 })

    await purgeExpiredHours(db)
    const after = await excluded(weekend)
    expect(after).toMatchObject({ matching: 1, kept: 1, expiredHours: 0 })
    expect(after.kept + after.closed + after.unknownHours + after.expiredHours).toBe(after.matching)
  })
})

describe('the recompute guard', () => {
  it('is exactly the records the purge emptied', async () => {
    const before = await byPlace()
    expect(Object.values(before).filter(hoursPurged)).toEqual([])

    await purgeExpiredHours(db)
    const purged = Object.values(await byPlace()).filter(hoursPurged).map((r) => r.googlePlaceId)
    expect(purged.sort()).toEqual(['expired', 'no-period-expired'])
  })

  // Why the recompute scripts skip them: an empty payload reads as no hours at all.
  it('protects has_hours, which a recompute would clear', () => {
    expect(computeProfile({ windows: parseOpeningHours(null), headcountCode: '01' }).hasHours).toBe(false)
  })
})
