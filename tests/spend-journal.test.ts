import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { cell, sweepExecution, sweepRun } from '@/lib/db/schema'
import {
  STAMP_SLACK, bookCall, bookedForPlan, closeAbandoned, journalGap, openExecution, periodSpend,
  planSpend,
} from '@/lib/spend-journal'

/*
 * The journal's arithmetic lives in Postgres: a sum per period, a count of stamps on the
 * Pacific window, an increment that must hit exactly one running row. PGlite runs the real
 * statements on the schema generated from lib/db/schema.ts.
 *
 * The scenarios are D52's table, on synthetic stamps: what the 12-month replay measured on the
 * copy of 17 October, with the same re-buys.
 */

// The ESM build of drizzle-kit's API breaks on a dynamic require of `fs`; the CommonJS one loads.
const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)(
  'drizzle-kit/api',
) as typeof import('drizzle-kit/api')

async function databaseOf(tables: Record<string, unknown>): Promise<PGlite> {
  const client = new PGlite()
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tables))
  for (const statement of statements) await client.exec(statement)
  return client
}

const at = (iso: string) => new Date(iso)
const PLAN = '00000000-0000-4000-8000-000000000001'
const FIRST_PASS = at('2026-11-01T09:00:00Z')
const SECOND_PASS = at('2026-11-16T09:00:00Z')
const NOVEMBER_20 = at('2026-11-20T12:00:00Z')

let client: PGlite
let db: ReturnType<typeof drizzle>

beforeAll(async () => {
  client = await databaseOf(schema)
  db = drizzle(client)
})

afterAll(async () => {
  await client?.close()
})

beforeEach(async () => {
  await db.delete(sweepExecution)
  await db.delete(cell)
  await db.delete(sweepRun)
  await db.insert(sweepRun).values({ id: PLAN })
})

/** Cells queried once, at `when`. */
async function stampNew(n: number, when: Date): Promise<void> {
  if (n === 0) return
  await db.insert(cell).values(Array.from({ length: n }, () => ({
    sweepRunId: PLAN, lat: 45.76, lng: 4.83, radius: 500, status: 'done' as const, queriedAt: when,
  })))
}

/** Cells stamped in [from, to) queried again at `when`: a cell keeps one stamp, the last. */
async function rebuy(n: number, from: Date, to: Date, when: Date): Promise<void> {
  const picked = await db.select({ id: cell.id }).from(cell)
    .where(and(gte(cell.queriedAt, from), lt(cell.queriedAt, to))).limit(n)
  expect(picked).toHaveLength(n)
  await db.update(cell).set({ queriedAt: when }).where(inArray(cell.id, picked.map((c) => c.id)))
}

/**
 * One pass as the sweep leaves it: `rebuys` cells stamped since `since` queried again, `fresh`
 * cells queried for the first time, its row closed, and the plan's total rewritten from the
 * journal.
 */
async function pass(
  period: string, which: 'first' | 'second', when: Date, calls: number,
  { fresh = 0, rebuys = 0, since = at('2000-01-01T00:00:00Z') } = {},
): Promise<void> {
  if (rebuys > 0) await rebuy(rebuys, since, when, when)
  await stampNew(fresh, when)
  expect(rebuys + fresh).toBeLessThanOrEqual(calls)
  await db.insert(sweepExecution).values({
    runId: PLAN, period, pass: which, startedAt: when, finishedAt: when, callsMade: calls, status: 'capped',
  })
  await db.update(sweepRun).set({ callsMade: bookedForPlan(PLAN) }).where(eq(sweepRun.id, PLAN))
}

/** November as the 12-month replay measured it: 234 of the 16th's 450 calls re-buy the 1st's cells. */
async function twoPassesOfNovember(): Promise<void> {
  await pass('2026-11', 'first', FIRST_PASS, 450, { fresh: 450 })
  await pass('2026-11', 'second', SECOND_PASS, 450, { fresh: 216, rebuys: 234, since: FIRST_PASS })
}

async function gapAt(now: Date): Promise<string | null> {
  return journalGap(await periodSpend(db, now), await planSpend(db, PLAN), PLAN)
}

describe('what a period has spent (D52 rule 3)', () => {
  it('reads a November of two passes at 900, where its stamps say 666', async () => {
    await twoPassesOfNovember()
    expect(await periodSpend(db, NOVEMBER_20)).toEqual({
      period: '2026-11', booked: 900, stamped: 666, charged: 900,
    })
    expect(await gapAt(NOVEMBER_20)).toBeNull()
  })

  it('lets a 16th cut at 200 calls resume up to the period ceiling', async () => {
    await pass('2026-11', 'first', FIRST_PASS, 450, { fresh: 450 })
    await pass('2026-11', 'second', SECOND_PASS, 200, { fresh: 177, rebuys: 23, since: FIRST_PASS })
    const spend = await periodSpend(db, NOVEMBER_20)
    expect(spend).toMatchObject({ booked: 650, stamped: 627, charged: 650 })
    // 900 - 650: the resume may spend what the period has left, no more.
    expect(900 - spend.charged).toBe(250)
    expect(await gapAt(NOVEMBER_20)).toBeNull()
  })

  it('reads the full December after it at 900, where the stamps said 651 and allowed 249 more', async () => {
    const december = at('2026-12-01T09:00:00Z')
    await pass('2026-11', 'first', FIRST_PASS, 450, { fresh: 450 })
    await pass('2026-11', 'second', SECOND_PASS, 200, { fresh: 177, rebuys: 23, since: FIRST_PASS })
    // The 1st refreshes November's cells; the 16th re-buys 249 of those.
    await pass('2026-12', 'first', december, 450, { rebuys: 450 })
    await pass('2026-12', 'second', at('2026-12-16T09:00:00Z'), 450, { fresh: 201, rebuys: 249, since: december })
    expect(await periodSpend(db, at('2026-12-20T12:00:00Z'))).toMatchObject({ booked: 900, stamped: 651, charged: 900 })
    expect(await gapAt(at('2026-12-20T12:00:00Z'))).toBeNull()
  })

  it('counts every plan, hand rows, and rows a killed execution left running', async () => {
    const other = '00000000-0000-4000-8000-000000000002'
    await db.insert(sweepRun).values({ id: other })
    await db.insert(sweepExecution).values([
      { runId: PLAN, period: '2026-11', callsMade: 100, status: 'capped' },
      { runId: other, period: '2026-11', callsMade: 40, status: 'running' },
      { runId: null, source: 'hand', note: 'billing console, 3 November', period: '2026-11', callsMade: 7, status: 'recorded' },
      { runId: PLAN, period: '2026-10', callsMade: 900, status: 'capped' },
    ])
    expect((await periodSpend(db, NOVEMBER_20)).booked).toBe(147)
  })

  it('reads the stamps on the Pacific month, like the ceiling', async () => {
    // 07:30 UTC on 1 December is still 30 November in California.
    await stampNew(1, at('2026-12-01T07:30:00Z'))
    await stampNew(1, at('2026-12-01T08:30:00Z'))
    expect((await periodSpend(db, NOVEMBER_20)).stamped).toBe(1)
  })

  it('charges the stamps when they read more than the journal', async () => {
    await stampNew(30, FIRST_PASS)
    expect(await periodSpend(db, NOVEMBER_20)).toMatchObject({ booked: 0, stamped: 30, charged: 30 })
  })
})

describe('the two checks: nothing spent without booking (D52 rule 5)', () => {
  it('refuses when the 16th\'s row is deleted, naming the gap and the way out', async () => {
    await twoPassesOfNovember()
    await db.delete(sweepExecution).where(eq(sweepExecution.pass, 'second'))
    const gap = await gapAt(NOVEMBER_20)
    expect(gap).toMatch(/at least 450 call\(s\) were made without being booked/)
    expect(gap).toMatch(/666 cell\(s\) carry a queried_at in 2026-11, which books only 450/)
    expect(gap).toMatch(/sweep_run.calls_made says 900 for plan .*, the journal books it 450/)
    expect(gap).toMatch(/billing console/)
    expect(gap).toMatch(/hand row/)
  })

  it('refuses on the plan\'s total when sweep_run.calls_made is raised by hand', async () => {
    await twoPassesOfNovember()
    await db.update(sweepRun).set({ callsMade: sql`${sweepRun.callsMade} + 10` })
    const gap = await gapAt(NOVEMBER_20)
    expect(gap).toMatch(/sweep_run.calls_made says 910 for plan .*, the journal books it 900/)
    expect(gap).not.toMatch(/carry a queried_at/)
  })

  it('refuses what an old checkout spent: stamps and sweep_run, without a journal row', async () => {
    await twoPassesOfNovember()
    await stampNew(120, at('2026-11-18T10:00:00Z'))
    await db.update(sweepRun).set({ callsMade: sql`${sweepRun.callsMade} + 120` })
    expect(await gapAt(NOVEMBER_20)).toMatch(/at least 120 call\(s\)/)
    // The way out the message names: a hand row carrying what the console shows.
    await db.insert(sweepExecution).values({
      runId: PLAN, source: 'hand', note: 'billing console, 18 November: old checkout', period: '2026-11',
      callsMade: 120, status: 'recorded',
    })
    expect(await gapAt(NOVEMBER_20)).toBeNull()
    expect((await periodSpend(db, NOVEMBER_20)).charged).toBe(1020)
  })

  it('tolerates one stamp past the journal: a call booked before midnight, answered after it', async () => {
    await db.insert(sweepExecution).values({ runId: PLAN, period: '2026-11', callsMade: 10, status: 'capped' })
    await stampNew(10 + STAMP_SLACK, FIRST_PASS)
    expect(await gapAt(NOVEMBER_20)).toBeNull()
    await stampNew(1, FIRST_PASS)
    expect(await gapAt(NOVEMBER_20)).toMatch(/carry a queried_at/)
  })

  it('stays silent when the journal reads more than the stamps and the plan', async () => {
    // Re-buys, a booked call never answered, a killed execution: all on the safe side.
    await db.insert(sweepExecution).values({ runId: PLAN, period: '2026-11', callsMade: 50, status: 'running' })
    await stampNew(20, FIRST_PASS)
    expect(await gapAt(NOVEMBER_20)).toBeNull()
  })
})

describe('booking a call (D52 rule 2)', () => {
  const opened = () => openExecution(db, { runId: PLAN, period: '2026-11', pass: 'first', status: 'running' })

  it('adds one call to the running row', async () => {
    const id = await opened()
    await bookCall(db, id)
    await bookCall(db, id)
    const [row] = await db.select().from(sweepExecution).where(eq(sweepExecution.id, id))
    expect(row.callsMade).toBe(2)
  })

  it('throws when no running row takes it: deleted, or closed under it', async () => {
    const closed = await opened()
    await db.update(sweepExecution).set({ status: 'failed' }).where(eq(sweepExecution.id, closed))
    await expect(bookCall(db, closed)).rejects.toThrow(/no running row/)
    const deleted = await opened()
    await db.delete(sweepExecution).where(eq(sweepExecution.id, deleted))
    await expect(bookCall(db, deleted)).rejects.toThrow(/no running row/)
  })

  it('closes what a killed execution left running, and keeps its calls', async () => {
    const id = await opened()
    for (let i = 0; i < 3; i++) await bookCall(db, id)
    expect(await closeAbandoned(db)).toBe(1)
    const [row] = await db.select().from(sweepExecution).where(eq(sweepExecution.id, id))
    expect(row).toMatchObject({ status: 'failed', callsMade: 3, finishedAt: null })
    expect((await periodSpend(db, NOVEMBER_20)).booked).toBe(3)
  })

  it('rewrites the plan\'s total from the journal', async () => {
    await db.insert(sweepExecution).values([
      { runId: PLAN, period: '2026-10', callsMade: 900, status: 'capped' },
      { runId: PLAN, period: '2026-11', callsMade: 12, status: 'failed' },
    ])
    await db.update(sweepRun).set({ callsMade: bookedForPlan(PLAN) }).where(eq(sweepRun.id, PLAN))
    expect(await planSpend(db, PLAN)).toEqual({ logged: 912, booked: 912 })
  })

  it('refuses a hand row that does not say where its figure comes from', async () => {
    await expect(db.insert(sweepExecution).values({
      source: 'hand', period: '2026-11', callsMade: 5, status: 'recorded',
    })).rejects.toThrow()
  })
})

describe('the hand migration (drizzle/manual/d52-sweep-execution.sql)', () => {
  const migration = readFileSync('drizzle/manual/d52-sweep-execution.sql', 'utf8')
  // Production before the migration: every table but the journal.
  const { sweepExecution: _journal, ...production } = schema
  let before: PGlite

  beforeEach(async () => {
    before = await databaseOf(production)
  })

  afterEach(async () => {
    await before.close()
  })

  const plan = (calls: number) =>
    before.query(`INSERT INTO sweep_run (id, calls_made) VALUES ($1, $2)`, [PLAN, calls])

  async function columns(c: PGlite) {
    const { rows } = await c.query(`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'sweep_execution' ORDER BY ordinal_position`)
    const { rows: constraints } = await c.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'sweep_execution'::regclass ORDER BY conname`)
    const { rows: indexes } = await c.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'sweep_execution' ORDER BY indexname`)
    return { rows, constraints, indexes }
  }

  it('creates the table lib/db/schema.ts describes', async () => {
    await plan(2700)
    await before.exec(migration)
    expect(await columns(before)).toEqual(await columns(client))
  })

  it('enables row-level security', async () => {
    await plan(2700)
    await before.exec(migration)
    const { rows } = await before.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'sweep_execution'`)
    expect(rows[0].relrowsecurity).toBe(true)
  })

  it('books the past: 900 a month, 2,700 on the plan, where the stamps say 0, 899 and 900', async () => {
    await plan(2700)
    await before.exec(migration)
    const { rows } = await before.query<{ period: string; calls: number; rows: number }>(`
      SELECT period, sum(calls_made)::int AS calls, count(*)::int AS rows FROM sweep_execution
      WHERE run_id = $1 AND source = 'hand' AND status = 'recorded' GROUP BY period ORDER BY period`, [PLAN])
    expect(rows).toEqual([
      { period: '2026-08', calls: 900, rows: 1 },
      { period: '2026-09', calls: 900, rows: 2 },
      { period: '2026-10', calls: 900, rows: 1 },
    ])
  })

  it('rolls everything back when the past does not add up to sweep_run.calls_made', async () => {
    // An old-code pass ran since, and its row was not added.
    await plan(3150)
    await expect(before.exec(migration)).rejects.toThrow(/journal books 2700 call\(s\), sweep_run.calls_made says 3150/)
    await before.exec('ROLLBACK')
    const { rows } = await before.query(`SELECT to_regclass('sweep_execution') AS journal`)
    expect(rows).toEqual([{ journal: null }])
  })

  it('refuses a database with more than one plan', async () => {
    await plan(2700)
    await before.query(`INSERT INTO sweep_run (id) VALUES ('00000000-0000-4000-8000-000000000002')`)
    await expect(before.exec(migration)).rejects.toThrow()
  })
})
