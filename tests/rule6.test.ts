import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { and, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  buildConditions, buildUserConditions, EXCLUDED_BECAUSE, HOURS_EXPIRED, HOURS_USABLE, parseFilters,
} from '@/lib/filters'

/*
 * D30 rule 6 lives in SQL, and its failure mode is three-valued logic: a predicate that
 * returns NULL fails both a filter and its negation, so the row leaves the page and every
 * count at once. Only an engine can show that, and a string comparison of the rendered SQL
 * cannot. The expressions are rendered through Drizzle's Postgres dialect and evaluated in
 * an in-memory DuckDB — no database, no network — whose NULL semantics are the standard
 * ones Postgres follows too.
 *
 * What this does NOT cover: `countExcluded` and `fetchHoursFreshness` themselves, which need
 * the Postgres client. They are thin `count(*) FILTER` wrappers over the expressions tested
 * here, which is why those expressions live in lib/filters.
 */

type Hours =
  | 'fresh'
  | 'expired'
  /** Hours with no expiry date: no writer produces it today, and the gate must still be total. */
  | 'undated'
  | 'none'
  /** Google sent an hours object with no usable period: dated, yet no week ever shown. */
  | 'none-but-dated'

interface Place {
  id: string
  hours: Hours
  trading?: boolean
  /** Stored rhythm columns — for an expired record, those of its last profile. */
  rhythm?: boolean
}

const EXPIRES_AT: Record<Hours, string> = {
  fresh: 'now() + INTERVAL 10 DAY',
  expired: 'now() - INTERVAL 1 DAY',
  undated: 'NULL',
  none: 'NULL',
  'none-but-dated': 'now() - INTERVAL 1 DAY',
}

const PLACES: Place[] = [
  { id: 'fresh-rhythm', hours: 'fresh', rhythm: true },
  { id: 'fresh-plain', hours: 'fresh' },
  { id: 'expired-rhythm', hours: 'expired', rhythm: true },
  { id: 'expired-plain', hours: 'expired' },
  { id: 'undated-rhythm', hours: 'undated', rhythm: true },
  { id: 'no-hours', hours: 'none' },
  { id: 'no-hours-dated', hours: 'none-but-dated' },
  { id: 'closed-fresh', hours: 'fresh', trading: false, rhythm: true },
  { id: 'closed-expired', hours: 'expired', trading: false, rhythm: true },
]

let instance: DuckDBInstance
let db: DuckDBConnection
const dialect = new PgDialect()

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:')
  db = await instance.connect()
  await db.run(`
    CREATE TABLE restaurant (
      id TEXT, name TEXT, commune TEXT, insee_code TEXT, category TEXT, headcount_code TEXT,
      business_status TEXT, has_hours BOOLEAN NOT NULL, hours_expires_at TIMESTAMPTZ,
      split_shift_risk TEXT NOT NULL, closed_weekend BOOLEAN NOT NULL,
      closed_sunday BOOLEAN NOT NULL, max_consecutive_days_off INTEGER NOT NULL
    )`)
  for (const p of PLACES) {
    const hasHours = p.hours !== 'none' && p.hours !== 'none-but-dated'
    // A record with no hours has no rhythm: the profile writes the same fallbacks the
    // projection shows. That is what lets the gate hold under a rhythm criterion for free.
    const rhythm = hasHours && p.rhythm === true
    await db.run(`
      INSERT INTO restaurant VALUES (
        '${p.id}', '${p.id}', 'Lyon 1er', '69381', 'bistro', '01',
        ${p.trading === false ? `'CLOSED_PERMANENTLY'` : 'NULL'}, ${hasHours}, ${EXPIRES_AT[p.hours]},
        '${rhythm ? 'none' : hasHours ? 'high' : 'unknown'}', ${rhythm}, ${rhythm}, ${rhythm ? 2 : 0}
      )`)
  }
})

afterAll(() => {
  db?.closeSync()
  instance?.closeSync()
})

async function idsWhere(where: SQL | undefined): Promise<string[]> {
  const q = where ? dialect.sqlToQuery(where) : { sql: 'true', params: [] }
  const reader = await db.runAndReadAll(
    `SELECT id FROM restaurant WHERE ${q.sql} ORDER BY id`, q.params as never,
  )
  return reader.getRows().map(([id]) => String(id))
}

async function valueOf(expr: SQL): Promise<Record<string, boolean | null>> {
  const q = dialect.sqlToQuery(expr)
  const reader = await db.runAndReadAll(`SELECT id, ${q.sql} FROM restaurant`, q.params as never)
  return Object.fromEntries(reader.getRows().map(([id, v]) => [String(id), v as boolean | null]))
}

const search = (params: Parameters<typeof parseFilters>[0]) => parseFilters(params)

describe('the rule 6 gate', () => {
  it('lets fresh hours through and nothing else', async () => {
    expect(await valueOf(HOURS_USABLE)).toEqual({
      'fresh-rhythm': true,
      'fresh-plain': true,
      'expired-rhythm': false,
      'expired-plain': false,
      'undated-rhythm': false,
      'no-hours': false,
      'no-hours-dated': false,
      'closed-fresh': true,
      'closed-expired': false,
    })
  })

  // A bare `hours_expires_at > now()` is NULL on an undated row, and NULL fails the filter
  // AND its negation: the row left the list and both counts together.
  it('is never NULL, even on hours with no expiry date', async () => {
    for (const expr of [HOURS_USABLE, HOURS_EXPIRED, ...Object.values(EXCLUDED_BECAUSE)]) {
      expect(Object.values(await valueOf(expr))).not.toContain(null)
    }
  })

  it('reads undated hours as expired: they cannot be proven under 30 days', async () => {
    const expired = await valueOf(HOURS_EXPIRED)
    expect(expired['undated-rhythm']).toBe(true)
    expect(expired['expired-plain']).toBe(true)
  })

  it('does not call expired what never showed a week', async () => {
    const expired = await valueOf(HOURS_EXPIRED)
    expect(expired['no-hours']).toBe(false)
    expect(expired['no-hours-dated']).toBe(false)
  })
})

describe('what a search sets aside, and says it did', () => {
  it('sets expired hours aside by default and counts them apart from missing ones', async () => {
    const f = search({})
    expect(await idsWhere(buildConditions(f))).toEqual(['fresh-plain', 'fresh-rhythm'])
    const matching = buildUserConditions(f)
    expect(await idsWhere(and(matching, EXCLUDED_BECAUSE.expiredHours)))
      .toEqual(['expired-plain', 'expired-rhythm', 'undated-rhythm'])
    expect(await idsWhere(and(matching, EXCLUDED_BECAUSE.unknownHours)))
      .toEqual(['no-hours', 'no-hours-dated'])
    expect(await idsWhere(and(matching, EXCLUDED_BECAUSE.closed)))
      .toEqual(['closed-expired', 'closed-fresh'])
  })

  it('brings expired records back on inconnus=1 when no rhythm criterion is set', async () => {
    const shown = await idsWhere(buildConditions(search({ inconnus: '1' })))
    expect(shown).toEqual(expect.arrayContaining(['expired-plain', 'expired-rhythm', 'undated-rhythm']))
    expect(shown).not.toContain('closed-fresh')
  })

  // Invariant (a): the stored columns of an expired record still say "free weekend", and
  // the page must not repeat a claim its hours can no longer back.
  it.each([
    { coupure: 'sans' },
    { coupure: 'sans-ou-probable' },
    { weekend: 'libre' },
    { weekend: 'dimanche' },
    { repos2: '1' },
  ])('never lists an expired record under a rhythm criterion, even on inconnus=1: %o', async (criterion) => {
    const f = search({ ...criterion, inconnus: '1' })
    expect(await idsWhere(buildConditions(f))).toEqual(['fresh-rhythm'])
  })

  // Invariant (b): the criteria stay ungated for the count, so the records the gate removed
  // are still reported, under the reason that removed them.
  it('still counts the expired records a rhythm criterion set aside', async () => {
    for (const inconnus of ['', '1']) {
      const matching = buildUserConditions(search({ weekend: 'libre', inconnus }))
      expect(await idsWhere(and(matching, EXCLUDED_BECAUSE.expiredHours)))
        .toEqual(['expired-rhythm', 'undated-rhythm'])
    }
  })

  // Invariant (c): every record matching the reader's criteria is either on the page or in
  // exactly one of the stated buckets. A record in neither is the silent drop.
  it.each([
    {}, { weekend: 'libre' }, { coupure: 'sans' }, { repos2: '1' }, { weekend: 'dimanche', coupure: 'sans-ou-probable' },
    { zone: '69381' }, { categorie: 'bistro' }, { taille: 'petit' }, { q: 'rhythm' },
    { zone: '69381', weekend: 'libre', q: 'expired' },
  ])('accounts for every matching record: %o', async (params) => {
    for (const inconnus of ['', '1']) {
      const f = search({ ...params, inconnus })
      const hasRhythmCriterion = !!(f.splitShift || f.weekend || f.twoDaysOff)
      const matching = buildUserConditions(f)
      const kept = new Set(await idsWhere(buildConditions(f)))
      const buckets: Record<string, Set<string>> = {}
      for (const [reason, expr] of Object.entries(EXCLUDED_BECAUSE)) {
        buckets[reason] = new Set(await idsWhere(and(matching, expr)))
      }

      for (const id of await idsWhere(matching)) {
        const reasons = Object.entries(buckets).filter(([, ids]) => ids.has(id)).map(([k]) => k)
        expect(reasons.length, `${id} counted under ${reasons.join(', ')}`).toBeLessThanOrEqual(1)
        if (!kept.has(id)) {
          expect(reasons, `${id} dropped without a reason`).toHaveLength(1)
          continue
        }
        // Kept AND counted is the "les masquer" state: only hours buckets, only on inconnus=1,
        // and never an expired record under a rhythm criterion.
        if (reasons.length === 1) {
          expect(inconnus).toBe('1')
          expect(reasons[0]).not.toBe('closed')
          if (hasRhythmCriterion) expect(reasons[0]).not.toBe('expiredHours')
        }
      }
    }
  })
})
