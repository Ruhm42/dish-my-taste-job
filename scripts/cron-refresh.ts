/**
 * cron:refresh — pipeline step 7: one pass of the refresh cycle.
 *
 * Chains `plan:cells`, `sweep:google`, `match:sirene` and `compute:profiles`.
 * `ingest:sirene` and `ingest:geocode` are not in it: the company registry moves slowly, a
 * quarterly rerun is enough (spec 06).
 *
 * This is the script .github/workflows/sweep.yml triggers twice a month, on the 1st and the
 * 16th (D38). Firing on the 1st was said to guarantee the replacement before the 30-day
 * expiry; it did not, seven months a year — twelve monthly refreshes cover 360 days, not 365.
 * What the cycle does instead is spread the expiries over two passes, so that only part of
 * the base can lapse at once; what lapses anyway is not shown (D30 rule 6) and is counted in
 * the banner.
 *
 * IT SPENDS QUOTA, through `sweep:google`: `--dry-run` is therefore its default mode, and
 * `--go` the only way to spend. Dry, every step has a write-free mode, so the whole chain is
 * rehearsed without a call or a row.
 *
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts        # nothing is spent
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts --go   # actually spends
 *
 * Each step keeps its own guard rails: they live in the scripts, not here. In particular,
 * the sweep's ceiling is the PASS's, read on the period's total: a manual trigger in the first
 * half of the month shares the first pass's CYCLE.firstPassCeiling, one after the 16th what
 * the period has left.
 *
 * A cycle fails on D39's conditions and on nothing else. The sweep judges its own; this adds,
 * once the pass is over, the share of the records with hours still usable at the worst hour
 * before the next pass, GitHub's delay included, read on what the pass actually wrote. It also
 * reports how much of the database is past the 30-day retention — reported, never red: under
 * two passes some of it lapses every month by arithmetic (D38).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { cell, restaurant, sweepRun } from '../lib/db/schema'
import { buildCoverIndex, buildResolution, forecastHorizon, freshShare, planPass } from '../lib/coverage'
import { cycleNotice } from '../lib/cycle-notice'
import { errorReason } from '../lib/error-reason'
import { loadCoverInputs } from '../lib/db/cover-inputs'
import { nextScheduledPass } from '../lib/quota'
import { COMMUNE_NAMES, CYCLE, DISTRICT_BY_COMMUNE, HOURS_TTL_DAYS, SWEEP } from '../lib/config'
import { fetchHoursFreshness, type HoursFreshness } from '../lib/results'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

interface PlanState {
  /** Cells in the database, all runs taken together. Zero means there is no plan. */
  total: number
  /** Cells never queried, or whose last call failed: the discovery backlog. */
  backlog: number
  /** Truncations whose recovering cells are not themselves resolved. */
  unresolved: number
}

/**
 * What the plan is, and what it still hides — reported, never a reason to fail (D39).
 *
 * Scoped to the run the sweep would pick — the most recent one with cells — and not to the
 * whole table. A recalibration leaves the previous plan's rows in place, on purpose: their
 * `queried_at` is the spend ledger. Counting them here would have the cycle announce a figure
 * the sweep does not walk.
 *
 * Read whole rather than counted in SQL: resolution is recursive, it is the same rule the
 * sweep reports its own truncations with, and the table is a few thousand rows.
 */
async function planState(): Promise<PlanState> {
  const runs = await db.selectDistinct({ runId: cell.sweepRunId }).from(cell)
  if (runs.length === 0) return { total: 0, backlog: 0, unresolved: 0 }

  const [latest] = await db.select({ id: sweepRun.id }).from(sweepRun)
    .where(inArray(sweepRun.id, runs.map((r) => r.runId)))
    .orderBy(desc(sweepRun.startedAt))
    .limit(1)
  const runId = latest?.id ?? runs[0].runId

  const cells = await db
    .select({ id: cell.id, parentId: cell.parentId, status: cell.status })
    .from(cell)
    .where(eq(cell.sweepRunId, runId))
  const isResolved = buildResolution(cells)
  return {
    total: cells.length,
    backlog: cells.filter((c) => c.status === 'pending' || c.status === 'failed').length,
    unresolved: cells.filter((c) => c.status === 'truncated' && !isResolved(c)).length,
  }
}

/**
 * The share of the records with hours still usable at the worst hour before the next pass,
 * read on the expiries in the database (D39 rule 3).
 */
async function forecastFreshness(now: Date): Promise<{ share: number; nextPass: Date }> {
  const nextPass = nextScheduledPass(now, CYCLE.scheduleDays, CYCLE.scheduleHourUtc)
  const rows = await db.select({ expiresAt: restaurant.hoursExpiresAt }).from(restaurant)
  return { share: freshShare(rows.map((r) => r.expiresAt), forecastHorizon(nextPass)), nextPass }
}

/** What one refresh of everything costs today, for the run's annotation (D36). */
async function coverCost(): Promise<{ robust: number; known: number } | null> {
  const inputs = await loadCoverInputs()
  if (!inputs) return null
  const index = buildCoverIndex(inputs.cells, inputs.records, inputs.sirene)
  const now = new Date()
  const plan = planPass(index, {
    now, nextPass: nextScheduledPass(now, CYCLE.scheduleDays, CYCLE.scheduleHourUtc), ceiling: 0,
  })
  return { robust: plan.robustCost, known: plan.knownCost }
}

const DISTRICT_LABEL = new Map(
  Object.entries(DISTRICT_BY_COMMUNE).map(([code, d]) => [d, COMMUNE_NAMES[code] ?? code]),
)

/**
 * Reports how much of the database is past the retention the terms of service impose.
 *
 * `hours_expires_at` was written by every sweep and read by nobody. Reporting it here is
 * what turns the drift into a fact the cycle states out loud, at the same place it already
 * states what the sweep still owes.
 */
function reportFreshness(freshness: HoursFreshness): void {
  const { withHours, expired, oldestFetchedAt, nextExpiryAt, byDistrict } = freshness
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : 'n/a')

  console.log(`\n=== opening-hours freshness (${HOURS_TTL_DAYS}-day retention, D7) ===\n`)
  console.log(`records with hours   : ${withHours}`)
  console.log(`EXPIRED              : ${expired}`)
  if (expired > 0) {
    console.log(`oldest collected on  : ${iso(oldestFetchedAt)}`)
    for (const { district, expired: n } of byDistrict) {
      console.log(`  ${(DISTRICT_LABEL.get(district) ?? 'commune inconnue').padEnd(20)}${String(n).padStart(6)}`)
    }
  }
  console.log(`next batch expires   : ${iso(nextExpiryAt)}`)
}

interface Step {
  name: string
  file: string
  /** Arguments in live mode. */
  args: string[]
  /**
   * Arguments in dry run, or `null` when the step has no write-free mode: it is then
   * skipped.
   */
  dryRunArgs: string[] | null
  /**
   * Spends no Google quota and needs no complete sweep: it reworks what is already in the
   * database, row by row. These still run when the sweep fails.
   */
  offline?: boolean
  /** Overrides `dryRunArgs` when a plan is already in the database. */
  dryRunOnResume?: string[]
}

const STEPS: Step[] = [
  // The budget step: it announces what a month costs — the cover — beside the one-level floor
  // and the converged tree, each named for what it is (D37). Played dry even when a plan is in
  // place, so the figures are read before a call is spent.
  { name: 'plan:cells', file: 'plan-cells.ts', args: ['--write'], dryRunArgs: [] },
  // The dry run of `sweep` reads the plan from the database; in dry run the plan is
  // precisely not written there. Calling it anyway would fail on "no cell to do", a
  // failure that says nothing about the real sweep.
  //
  // A PLAN ALREADY IN PLACE is the exception: the dry sweep then has something real to read,
  // and is the only thing that reports this pass's cover, its forecast and its verdict.
  // Without it a dry cycle on an existing plan played nothing at all.
  { name: 'sweep:google', file: 'sweep.ts', args: ['--go'], dryRunArgs: null, dryRunOnResume: ['--dry-run'] },
  // Both have a write-free mode, so a dry cycle rehearses the whole chain instead of
  // stopping after the sweep. That is also what makes the ordering above testable.
  { name: 'match:sirene', file: 'match-sirene.ts', args: [], dryRunArgs: ['--dry-run'], offline: true },
  { name: 'compute:profiles', file: 'compute-profiles.ts', args: [], dryRunArgs: ['--check'], offline: true },
]

/** The step running right now, so a stop signal can be handed on to it. */
let current: ChildProcess | null = null
let stoppedBy: NodeJS.Signals | null = null

/**
 * A stop signal is forwarded to the step instead of killing this process on the spot.
 *
 * Killing only the parent orphans the step, and when that step is the sweep it goes on
 * spending with nobody watching, and dies later without releasing its advisory lock — which
 * then refuses every sweep after it. The sweep's own handler records its calls and releases
 * the lock; it only runs if the signal reaches it. The cycle then stops: the offline steps
 * that normally survive a failure do not survive a cancel.
 */
function onStopSignal(signal: NodeJS.Signals): void {
  stoppedBy ??= signal
  if (current && current.exitCode === null && current.signalCode === null) {
    current.kill(signal)
  } else {
    process.exit(1)
  }
}

/**
 * Each step runs in its own process: that is what guarantees it applies its own guard
 * rails and its own exit code, instead of being short-circuited by a function call from
 * here. `--import tsx` rather than `npm run`: the package.json scripts carry
 * `--env-file=.env.local`, which does not exist in CI.
 *
 * Asynchronous rather than `spawnSync`: a parent blocked in `spawnSync` cannot run a signal
 * handler, so it could never forward one.
 */
async function run(step: Step, args: string[]): Promise<void> {
  const path = join(SCRIPTS_DIR, step.file)
  console.log(`\n=== ${step.name} ${args.join(' ')} ===\n`)

  const child = spawn(process.execPath, ['--import', 'tsx', path, ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  current = child
  try {
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', (error) => reject(new Error(`${step.name} could not start: ${error.message}`)))
        child.once('close', (code, signal) => resolve({ code, signal }))
      },
    )
    if (signal) throw new Error(`${step.name} was interrupted by signal ${signal}`)
    if (code !== 0) throw new Error(`${step.name} failed (exit code ${code})`)
  } finally {
    current = null
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => !['--go', '--dry-run'].includes(a))
  if (unknown.length > 0) {
    console.error(`Unknown options: ${unknown.join(' ')}. Expected: --go, --dry-run`)
    process.exit(1)
  }
  const go = args.includes('--go')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing — see .specs/technique/08-infrastructure.md')
    process.exit(1)
  }
  // Checked here rather than mid-cycle: discovering the missing key AFTER writing a plan
  // would leave "pending" cells behind.
  if (go && !process.env.GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is missing — see .specs/technique/08-infrastructure.md')
    process.exit(1)
  }

  process.on('SIGINT', onStopSignal)
  process.on('SIGTERM', onStopSignal)

  console.log(go
    ? 'REFRESH PASS — LIVE MODE, the sweep is going to spend Google quota'
    : 'REFRESH PASS — DRY RUN, no call made, nothing written (add --go to spend)')

  const startedAt = Date.now()

  // An existing plan is WALKED, never replanned.
  //
  // The cover is drawn from the plan's complete cells and the positions of what they hold,
  // recomputed on every pass (D36): there is nothing to replan for. What `plan:cells --write`
  // would cost is what the plan in place knows: it opens a brand-new run whose cells have
  // never been queried, so no cell is complete and no cover exists until discovery has walked
  // it again, and the old plan's resolved truncations are paid for a second time.
  // Recalibrating is a deliberate act, run by hand, at the start of a period.
  const plan = await planState()
  const skipPlanning = plan.total > 0

  if (skipPlanning) {
    console.log(
      `\nPLAN IN PLACE — ${plan.total} cell(s), ${plan.backlog} of them still to discover and ` +
      `${plan.unresolved} truncation(s) unresolved — reported, never red (D39).\n` +
      'Planning is skipped in live mode: the pass draws its cover from the plan it has.',
    )
  }

  // Held rather than thrown, so the expiry below is still reported: a failing pass is
  // precisely the one whose freshness matters most.
  let failure: Error | null = null
  /**
   * A failing step does not abandon the offline ones.
   *
   * Neither `match:sirene` nor `compute:profiles` spends a call, and neither depends on the
   * pass having served its whole cover: both work establishment by establishment on rows
   * already in the database. What did depend on it was `match:sirene`'s canary, and the
   * script withholds it itself, saying why. The cycle still fails: the first error is kept
   * and rethrown below.
   */
  for (const step of STEPS) {
    // Dry, planning is still played: it writes nothing, and it prints what a month costs
    // before a call is spent (D37). Live, it would replace the plan being walked.
    if (skipPlanning && go && step.name === 'plan:cells') continue
    if (failure && !step.offline) {
      console.log(`\n=== ${step.name} — skipped, an earlier step failed ===`)
      continue
    }

    const stepArgs = go ? step.args : (skipPlanning && step.dryRunOnResume) || step.dryRunArgs
    if (stepArgs === null) {
      console.log(`\n=== ${step.name} — not played in dry run ===`)
      continue
    }
    try {
      await run(step, stepArgs)
    } catch (error) {
      if (stoppedBy) throw new Error(`stopped by ${stoppedBy} during ${step.name}: ${(error as Error).message}`)
      // The FIRST failure is the one that gets reported: a later step erroring because of it
      // would bury the cause.
      failure ??= error as Error
      console.error(`\n! ${step.name} failed — continuing with the offline steps.`)
    }
  }

  // Expiry is reported, never red: under two passes some of the base lapses every month by
  // arithmetic (D38). What fails is the forecast below — and the alarm that used to fire when
  // a converged sweep left anything expired is gone, since the plan never converges (D39).
  const freshness = await fetchHoursFreshness()
  reportFreshness(freshness)

  // Live only: dry, the pass has written nothing, and the stored expiries say what happens
  // if it never runs. The dry sweep has already judged the forecast of what it would serve.
  //
  // Reported beside the first failed step, never instead of it and never hidden by it: it is
  // not a step downstream of the sweep but its consequence for the product (D39 rule 5).
  const reasons = failure ? [failure.message] : []
  if (go) {
    const { share, nextPass } = await forecastFreshness(new Date())
    const horizon = forecastHorizon(nextPass)
    console.log(`forecast             : ${(100 * share).toFixed(1)}% usable at ${horizon.toISOString()}, ` +
      'the worst hour before the next pass')
    if (share < CYCLE.freshnessFloor) {
      reasons.push(
        `forecast freshness ${(100 * share).toFixed(1)}% at the worst hour before the next pass, ` +
        `under ${100 * CYCLE.freshnessFloor}% (D39): the list is going dark beyond the structural dip`,
      )
    }
    const after = await planState()
    const cost = await coverCost()
    const notice = cycleNotice({
      backlog: after.backlog,
      awaiting: after.unresolved,
      robustCost: cost?.robust ?? 0,
      knownCost: cost?.known ?? 0,
      ceiling: SWEEP.maxCallsPerPeriod,
      forecast: share,
      horizon,
    })
    if (notice) console.log(notice)
  }

  if (reasons.length > 0) throw new Error(reasons.join(' ; '))

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(go
    ? `\nPass finished in ${minutes} min. To check: the billing console ` +
      '(Enterprise usage ≈ number of calls, NOTHING on the Atmosphere tier), ' +
      'the forecast above, SIRENE unmatched rate.'
    : `\nDry run finished in ${minutes} min. Nothing was spent nor written.\n` +
      'The cost that decides is the cover the plan step and the dry sweep announce (D37).')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nREFRESH CYCLE FAILED — ${errorReason(e)}`)
    process.exit(1)
  })
