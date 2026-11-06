import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import * as schema from '@/lib/db/schema'
import { sweepExecution } from '@/lib/db/schema'
import { CYCLE } from '@/lib/config'
import { nextScheduledPass } from '@/lib/quota'

/*
 * The pass-age check (D50) is one psql file the workflow runs as is. PGlite runs the same file,
 * minus psql's own meta-commands, on the real schema: the journal it reads is the one
 * lib/db/schema.ts declares.
 */

const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)(
  'drizzle-kit/api',
) as typeof import('drizzle-kit/api')

const CHECK = readFileSync('scripts/check-pass-age.sql', 'utf8')
  .split('\n').filter((line) => !line.startsWith('\\')).join('\n')

const HOUR = 3_600_000
/** sweep.yml's job timeout: the hour of job the deadline adds to GitHub's delay. */
const JOB_HOURS = Number(/timeout-minutes: (\d+)/.exec(
  readFileSync('.github/workflows/sweep.yml', 'utf8'),
)![1]) / 60

let client: PGlite
let db: ReturnType<typeof drizzle>

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client)
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema))
  for (const statement of statements) await client.exec(statement)
  await client.exec(`set timezone = 'UTC'`)
})

afterAll(async () => {
  await client?.close()
})

beforeEach(async () => {
  await db.delete(sweepExecution)
})

type Row = Partial<typeof sweepExecution.$inferInsert>

/** A pass of the sweep as it closes one, finished at `finished`. */
async function execution(finished: string, row: Row = {}) {
  const end = new Date(finished)
  await db.insert(sweepExecution).values({
    source: 'sweep',
    trigger: 'schedule',
    period: '2026-11',
    pass: 'second',
    status: 'capped',
    callsMade: 450,
    startedAt: new Date(end.getTime() - HOUR / 2),
    finishedAt: end,
    ...row,
  })
}

/** Runs the check as the workflow would at `now`: the verdict, and what it printed. */
async function checkAt(now: Date | string): Promise<{ ok: boolean, message: string }> {
  const at = typeof now === 'string' ? now : now.toISOString()
  await client.query(`select set_config('pass_age.now', $1, false)`, [at])
  const notices: string[] = []
  try {
    await client.exec(CHECK, { onNotice: (n) => notices.push(n.message ?? '') })
    return { ok: true, message: notices.join('\n') }
  } catch (error) {
    const { message, detail } = error as Error & { detail?: string }
    return { ok: false, message: `${message}\n${detail ?? ''}` }
  } finally {
    // A raise leaves the read-only transaction open and aborted.
    await client.exec('rollback')
  }
}

/** The scheduled pass a message names, as the check printed it in UTC. */
function scheduledIn(message: string): string {
  const match = /scheduled at (\S+ \S+)\+00/.exec(message)
  if (!match) throw new Error(`no scheduled pass in: ${message}`)
  return new Date(`${match[1].replace(' ', 'T')}Z`).toISOString()
}

describe('the age of the last pass (D50)', () => {
  it('passes before the pass is due, on the pass before it', async () => {
    await execution('2026-11-01T16:08:57Z', { pass: 'first' })
    const check = await checkAt('2026-11-16T17:59:59Z')
    expect(check.ok).toBe(true)
    expect(scheduledIn(check.message)).toBe('2026-11-01T09:00:00.000Z')
  })

  it('fails nine hours after a scheduled pass that never finished', async () => {
    await execution('2026-11-01T16:08:57Z', { pass: 'first' })
    const check = await checkAt('2026-11-16T18:00:00Z')
    expect(check.ok).toBe(false)
    expect(scheduledIn(check.message)).toBe('2026-11-16T09:00:00.000Z')
  })

  it('passes on a pass that finished since its scheduled start', async () => {
    await execution('2026-11-16T17:30:00Z')
    expect((await checkAt('2026-11-16T18:41:00Z')).ok).toBe(true)
  })

  it('counts a failed pass: it took place, and sweep.yml is already red', async () => {
    await execution('2026-11-16T16:00:00Z', { status: 'failed', error: 'interrupted: HTTP 500' })
    expect((await checkAt('2026-11-17T02:00:00Z')).ok).toBe(true)
  })

  it('does not count a refusal: it spent nothing and refreshed nothing', async () => {
    await execution('2026-11-16T15:00:00Z', { status: 'refused', callsMade: 0, error: 'lock held' })
    const check = await checkAt('2026-11-17T02:00:00Z')
    expect(check.ok).toBe(false)
    expect(check.message).toContain('refused')
  })

  it('does not count a hand row, whatever times it carries', async () => {
    await execution('2026-11-16T15:00:00Z', {
      source: 'hand', status: 'recorded', note: 'reconciled from the console',
    })
    expect((await checkAt('2026-11-17T02:00:00Z')).ok).toBe(false)
  })

  it('does not count an execution still open, or killed and closed without an end', async () => {
    await execution('2026-11-16T15:00:00Z', { status: 'running', finishedAt: null })
    expect((await checkAt('2026-11-17T02:00:00Z')).ok).toBe(false)
    await db.delete(sweepExecution)
    await execution('2026-11-16T15:00:00Z', { status: 'failed', finishedAt: null })
    expect((await checkAt('2026-11-17T02:00:00Z')).ok).toBe(false)
  })

  it('turns green on a manual catch-up after a dropped pass', async () => {
    await execution('2026-11-01T16:08:57Z', { pass: 'first' })
    expect((await checkAt('2026-11-17T10:00:00Z')).ok).toBe(false)
    await execution('2026-11-17T11:00:00Z', { trigger: 'workflow_dispatch' })
    expect((await checkAt('2026-11-17T18:41:00Z')).ok).toBe(true)
  })

  it('reads the pass before the 1st across the year', async () => {
    expect(scheduledIn((await checkAt('2027-01-01T17:59:59Z')).message)).toBe('2026-12-16T09:00:00.000Z')
    expect(scheduledIn((await checkAt('2027-01-01T18:00:00Z')).message)).toBe('2027-01-01T09:00:00.000Z')
  })

  it('holds the schedule and the deadline to CYCLE and to the sweep job, for a year', async () => {
    // The journal is empty: every check fails, and names the pass it was waiting for.
    let previous = new Date('2026-11-01T09:00:00Z')
    for (let i = 0; i < 24; i++) {
      const scheduled = nextScheduledPass(previous, CYCLE.scheduleDays, CYCLE.scheduleHourUtc)
      const deadline = scheduled.getTime() + (CYCLE.maxScheduleDelayHours + JOB_HOURS) * HOUR
      expect(scheduledIn((await checkAt(new Date(deadline - 1_000))).message)).toBe(previous.toISOString())
      expect(scheduledIn((await checkAt(new Date(deadline))).message)).toBe(scheduled.toISOString())
      previous = scheduled
    }
  })
})
