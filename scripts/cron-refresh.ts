/**
 * cron:refresh — pipeline step 7: the monthly refresh.
 *
 * Chains `plan:cells`, `sweep:google`, `match:sirene` and `compute:profiles`.
 * `ingest:sirene` and `ingest:geocode` are not in it: the company registry moves slowly, a
 * quarterly rerun is enough (spec 06).
 *
 * This is the script .github/workflows/sweep.yml triggers on the 1st of the month. Firing
 * on the 1st guarantees the replacement happens before the 30-day terms-of-service
 * expiry (D7).
 *
 * IT SPENDS QUOTA, through `sweep:google`: `--dry-run` is therefore its default mode, and
 * `--go` the only way to spend. Dry, every step has a write-free mode, so the whole chain is
 * rehearsed without a call or a row.
 *
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts        # nothing is spent
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts --go   # actually spends
 *
 * Each step keeps its own guard rails: they live in the scripts, not here. In particular,
 * `sweep:google` refuses to replay a sweep that succeeded less than SWEEP.daysBetweenSweeps
 * days ago — a manual trigger mid-month will spend nothing.
 *
 * It also reports, on every execution, how much of the database is past the 30-day
 * retention the terms of service impose — and fails when a CONVERGED sweep has left any
 * expired at all (spec technique/10 §2).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../lib/db/client'
import { cell } from '../lib/db/schema'
import { buildCoverage, countOwed } from '../lib/coverage'
import { monthWindow } from '../lib/quota'
import { COMMUNE_NAMES, DISTRICT_BY_COMMUNE, HOURS_TTL_DAYS } from '../lib/config'
import { fetchHoursFreshness, type HoursFreshness } from '../lib/results'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

interface PlanState {
  /** Cells in the database, all runs taken together. Zero means there is no plan. */
  total: number
  /** Cells this quota period still has to pay for: content to buy back, and discovery. */
  owed: number
  /** Truncations whose recovering cells are not themselves covered. */
  unresolved: number
}

/**
 * What the plan is, and what this period still owes on it — two questions, both needed.
 *
 * `owed` decides nothing about planning any more; it is the cycle's budget figure. Under
 * D30 rule 1 every cell owes a call once per quota period, since everything it collects
 * expires in 30 days, so this is nonzero at the start of every period by construction.
 *
 * `unresolved` is the other thing a period cannot fix on its own: a truncated cell has been
 * paid for, but the cells that recover what it hid may not have been. It counts as
 * unresolved until they ARE, and not for ever — nothing moves a cell out of `truncated`, so
 * counting every truncated cell would be a rule that can never come true.
 *
 * Read whole rather than counted in SQL: coverage is recursive, it is the same rule the
 * sweep reports its own truncations with, and the table is a few thousand rows.
 */
async function planState(): Promise<PlanState> {
  const cells = await db
    .select({
      id: cell.id, parentId: cell.parentId, status: cell.status, queriedAt: cell.queriedAt,
    })
    .from(cell)
  const isCovered = buildCoverage(cells)
  return {
    total: cells.length,
    owed: countOwed(cells, monthWindow(new Date())),
    unresolved: cells.filter((c) => c.status === 'truncated' && !isCovered(c)).length,
  }
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
  // The budget step: the number of cells it announces is what a converged sweep costs every
  // month, since every cell owes one call per period (D30 rules 1 and 4). Played dry even
  // when a plan is in place — that figure is the one the arbitration is made on.
  { name: 'plan:cells', file: 'plan-cells.ts', args: ['--write'], dryRunArgs: [] },
  // The dry run of `sweep` reads the plan from the database; in dry run the plan is
  // precisely not written there. Calling it anyway would fail on "no cell to do", a
  // failure that says nothing about the real sweep.
  //
  // A PLAN ALREADY IN PLACE is the exception: the dry sweep then has something real to read
  // and is the only thing that reports what the quota period still owes, and in which order.
  // Without it a dry cycle on an existing plan played nothing at all.
  { name: 'sweep:google', file: 'sweep.ts', args: ['--go'], dryRunArgs: null, dryRunOnResume: ['--dry-run'] },
  // Both have a write-free mode, so a dry cycle rehearses the whole chain instead of
  // stopping after the sweep. That is also what makes the ordering above testable.
  { name: 'match:sirene', file: 'match-sirene.ts', args: [], dryRunArgs: ['--dry-run'], offline: true },
  { name: 'compute:profiles', file: 'compute-profiles.ts', args: [], dryRunArgs: ['--check'], offline: true },
]

/**
 * Each step runs in its own process: that is what guarantees it applies its own guard
 * rails and its own exit code, instead of being short-circuited by a function call from
 * here. `--import tsx` rather than `npm run`: the package.json scripts carry
 * `--env-file=.env.local`, which does not exist in CI.
 */
function run(step: Step, args: string[]): void {
  const path = join(SCRIPTS_DIR, step.file)
  console.log(`\n=== ${step.name} ${args.join(' ')} ===\n`)

  const result = spawnSync(process.execPath, ['--import', 'tsx', path, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    throw new Error(`${step.name} could not start: ${result.error.message}`)
  }
  if (result.signal) {
    throw new Error(`${step.name} was interrupted by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    throw new Error(`${step.name} failed (exit code ${result.status})`)
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

  console.log(go
    ? 'MONTHLY REFRESH — LIVE MODE, the sweep is going to spend Google quota'
    : 'MONTHLY REFRESH — DRY RUN, no call made, nothing written (add --go to spend)')

  const startedAt = Date.now()

  // An existing plan is WALKED, never replanned.
  //
  // `plan:cells --write` opens a brand-new run with its own cells. Doing that on top of the
  // plan in place would strand its pending subdivisions, re-query cells this period has
  // already paid for, and spend a whole monthly quota without ever reaching the end — the
  // base would stay incomplete while the bill says otherwise. And under D30 rule 1 there is
  // nothing to replan for: one single plan is walked once per period, in the order its
  // content expires. Recalibrating it is a deliberate act, run by hand.
  const plan = await planState()
  const skipPlanning = plan.total > 0

  if (skipPlanning) {
    console.log(
      `\nPLAN IN PLACE — ${plan.total} cell(s), of which ${plan.owed} owed for this quota ` +
      `period and ${plan.unresolved} truncation(s) unresolved.\n` +
      'Planning is skipped in live mode: the cycle walks the plan it has, oldest content\n' +
      'first. Cells already queried inside this period are not replayed.',
    )
  }

  // Held rather than thrown, so the expiry below is still reported. A sweep that stops on
  // its quota ceiling fails the cycle by design (D22), and that is precisely the run whose
  // freshness matters most: reporting it only when everything else went well would keep it
  // quiet for exactly as long as the sweep takes to converge.
  let failure: Error | null = null
  /**
   * A failing step no longer abandons the offline ones.
   *
   * The sweep fails on its quota ceiling every month until it converges (D22), and it used to
   * take `match:sirene` and `compute:profiles` down with it — so establishments that HAD been
   * imported and paid for sat there with no headcount and a profile computed under older
   * rules, for as long as convergence took. Neither step spends a call, and neither depends
   * on the sweep being complete: both work establishment by establishment on rows already in
   * the database.
   *
   * What did depend on completeness was `match:sirene`'s canary, and that is handled where it
   * belongs — the script now withholds it itself and says why. The cycle still fails: the
   * first error is kept and rethrown below, so the exit code and the red build are unchanged.
   */
  for (const step of STEPS) {
    // Dry, planning is still played: it writes nothing, and the number of cells it announces
    // is what D30 rule 4 arbitrates on — the cost of a converged sweep, every month, before
    // a call is spent. Live, it would replace the plan being walked.
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
      run(step, stepArgs)
    } catch (error) {
      // The FIRST failure is the one that gets reported: a later step erroring because of it
      // would bury the cause.
      failure ??= error as Error
      console.error(`\n! ${step.name} failed — continuing with the offline steps.`)
    }
  }

  // While the sweep still owes cells, expiry is a known consequence of a sweep that
  // outlived its quota; once it has converged, a single expired record is a defect — the
  // base would be claiming a freshness it does not have.
  const freshness = await fetchHoursFreshness()
  reportFreshness(freshness)
  const after = await planState()
  const converged = after.owed === 0 && after.unresolved === 0

  if (failure) throw failure

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(go
    ? `\nMonthly cycle finished in ${minutes} min. To check: the billing console ` +
      '(Enterprise usage ≈ number of cells, NOTHING on the Atmosphere tier), ' +
      'unresolved truncations, SIRENE unmatched rate.'
    : `\nDry run finished in ${minutes} min. Nothing was spent nor written.\n` +
      `This period owes ${plan.owed} call(s) on the plan in place; the cell count the plan ` +
      'step announces is what a converged sweep would cost each month (D30 rule 4).')

  if (converged && freshness.expired > 0) {
    const message =
      `the sweep has converged and ${freshness.expired} record(s) still carry hours older ` +
      `than ${HOURS_TTL_DAYS} days. A converged sweep replaces every record it covers, so ` +
      'this is a hole in the coverage, not a leftover of an unfinished run.'
    // A dry run spends nothing and writes nothing, and comes back clean: it says the same
    // thing without turning a read-only check into a red build.
    if (go) throw new Error(message)
    console.warn(`\n! ${message}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nMONTHLY CYCLE FAILED — ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  })
