import { and, count, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { cell, sweepExecution, sweepRun } from './db/schema'
import { monthKey, monthWindow } from './quota'

/**
 * The spend journal (D52): what a quota period has spent is what its executions booked, one
 * call at a time, before making each call.
 *
 * Neither older record could say it. A cell keeps one `queried_at`, and the 16th's pass re-buys
 * cells the 1st already stamped in the same period, so stamps read short every month. The floor
 * drawn from `sweep_run`'s single row was exact only while every other period had spent the
 * whole ceiling. Both read short of the real spend, which is the one direction that bills.
 *
 * Apart from scripts/sweep.ts so the tests can run it on PGlite: lib/db/client needs a live
 * DATABASE_URL at import time.
 *
 * See .specs/technique/14-cycle-d-import-mensuel.md § 5.
 */

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

/**
 * A call booked just before Pacific midnight can be answered just after it, and its cell is
 * then stamped in the next period, which never booked it.
 */
export const STAMP_SLACK = 1

// `sum` of an integer is a bigint, which postgres.js returns as a string.
const bookedSum = sql<number>`coalesce(sum(${sweepExecution.callsMade}), 0)::int`

export interface PeriodSpend {
  period: string
  /** What the journal books to the period: every execution of every plan, hand rows included. */
  booked: number
  /** Cells whose `queried_at` falls in the period. */
  stamped: number
  /**
   * What the ceiling is charged with: the journal, unless calls escaped it. The stamps then
   * read more, and `journalGap` refuses before anything is spent on it.
   */
  charged: number
}

/**
 * `running` rows count too: a killed execution leaves its row open, and every call it booked
 * was made, or about to be.
 */
export async function periodSpend(db: Db, now: Date): Promise<PeriodSpend> {
  const period = monthKey(now)
  const w = monthWindow(now)
  const [journal] = await db.select({ n: bookedSum }).from(sweepExecution)
    .where(eq(sweepExecution.period, period))
  const [cells] = await db.select({ n: count() }).from(cell)
    .where(and(gte(cell.queriedAt, w.start), lt(cell.queriedAt, w.end)))
  const booked = journal?.n ?? 0
  const stamped = cells?.n ?? 0
  return { period, booked, stamped, charged: Math.max(booked, stamped) }
}

export interface PlanSpend {
  /** `sweep_run.calls_made`: the plan's total as last written. */
  logged: number
  /** What the journal books to the plan. */
  booked: number
}

export async function planSpend(db: Db, runId: string): Promise<PlanSpend> {
  const [run] = await db.select({ n: sweepRun.callsMade }).from(sweepRun).where(eq(sweepRun.id, runId))
  const [journal] = await db.select({ n: bookedSum }).from(sweepExecution)
    .where(eq(sweepExecution.runId, runId))
  return { logged: run?.n ?? 0, booked: journal?.n ?? 0 }
}

/**
 * What `sweep_run.calls_made` is rewritten to at the end of every execution: the plan's total
 * becomes a reading of the journal rather than a second count kept beside it.
 */
export function bookedForPlan(runId: string): SQL<number> {
  return sql<number>`(select coalesce(sum(${sweepExecution.callsMade}), 0)::int from ${sweepExecution} where ${sweepExecution.runId} = ${runId})`
}

/**
 * Calls that reached Google without going through the journal, as the reason to refuse; null
 * when there are none.
 *
 * Both checks run the opposite way to the old one, which refused when the stamps read LESS than
 * the logbook. The journal is now the record, and what may not exceed it is anything else that
 * saw the calls:
 *  - the cells stamped in the period, give or take STAMP_SLACK;
 *  - the plan's `sweep_run.calls_made`, to which a checkout predating D52 still adds its calls.
 *
 * Either gap is spending the journal does not hold, of unknown size, and spending on top of an
 * unknown spend is how the free quota gets overrun.
 */
export function journalGap(period: PeriodSpend, plan: PlanSpend, runId: string): string | null {
  const gaps: string[] = []
  if (period.stamped > period.booked + STAMP_SLACK) {
    gaps.push(`${period.stamped} cell(s) carry a queried_at in ${period.period}, which books only ${period.booked} call(s)`)
  }
  if (plan.logged > plan.booked) {
    gaps.push(`sweep_run.calls_made says ${plan.logged} for plan ${runId}, the journal books it ${plan.booked}`)
  }
  if (gaps.length === 0) return null
  const missing = Math.max(period.stamped - period.booked, plan.logged - plan.booked)
  return (
    `at least ${missing} call(s) were made without being booked in the journal: ${gaps.join('; ')}.\n` +
    'Something spent outside it: a sweep run from a checkout that predates D52, or a journal row ' +
    'deleted or edited.\n' +
    `Establish from the billing console what ${period.period} really spent, write what the journal ` +
    "lacks as a hand row — source 'hand', status 'recorded', the period, run_id " +
    `'${runId}', calls_made, and a note naming where the figure comes from — then run again.`
  )
}

export type NewExecution = typeof sweepExecution.$inferInsert

export async function openExecution(db: Db, row: NewExecution): Promise<string> {
  const [opened] = await db.insert(sweepExecution).values(row).returning({ id: sweepExecution.id })
  return opened.id
}

/**
 * Books one call on a running execution. Throws when no running row took it — deleted, or closed
 * under it — so that the caller never sends a call the journal does not hold.
 */
export async function bookCall(db: Db, executionId: string): Promise<void> {
  const booked = await db.update(sweepExecution)
    .set({ callsMade: sql`${sweepExecution.callsMade} + 1` })
    .where(and(eq(sweepExecution.id, executionId), eq(sweepExecution.status, 'running')))
    .returning({ id: sweepExecution.id })
  if (booked.length !== 1) {
    throw new Error(`execution ${executionId} has no running row in sweep_execution`)
  }
}

/**
 * Closes what killed executions left `running`. Their calls stay booked: they were made.
 *
 * Under the sweep lock only. Whoever holds it is the one execution running, so any other row
 * still open belongs to a process that is gone.
 */
export async function closeAbandoned(db: Db): Promise<number> {
  const closed = await db.update(sweepExecution)
    .set({ status: 'failed', error: 'left running: the process was killed before it could close its row' })
    .where(eq(sweepExecution.status, 'running'))
    .returning({ id: sweepExecution.id })
  return closed.length
}
