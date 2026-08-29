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
 * `--go` the only way to spend. In dry run it only runs the two steps that know how to
 * write nothing — the plan and the dry sweep.
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
import { countUnfinished } from '../lib/coverage'
import { COMMUNE_NAMES, DISTRICT_BY_COMMUNE, HOURS_TTL_DAYS } from '../lib/config'
import { fetchHoursFreshness, type HoursFreshness } from '../lib/results'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Cells that still owe a Google call, all runs taken together.
 *
 * A truncated cell has been paid for, but the subdivisions that recover what it hid may
 * not have been — so it counts as unfinished until they ARE, and not for ever. Counting
 * every truncated cell as unfinished, which is what this did, could never reach zero:
 * nothing moves a cell out of `truncated`. Planning would then be skipped for ever, and
 * every cycle would fail the moment the last pending cell was queried.
 *
 * Read whole rather than counted in SQL: coverage is recursive, it is the same rule the
 * sweep reports its own truncations with, and the table is a few thousand rows.
 */
async function unfinishedCellCount(): Promise<number> {
  const cells = await db
    .select({ id: cell.id, parentId: cell.parentId, status: cell.status })
    .from(cell)
  return countUnfinished(cells)
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
   * skipped. We do not pretend to match against a database we have not swept.
   */
  dryRunArgs: string[] | null
  /** Overrides `dryRunArgs` when the cycle is resuming an unfinished sweep. */
  dryRunOnResume?: string[]
}

const STEPS: Step[] = [
  // The only step playable dry, and the only one that matters for the budget: the number
  // of cells it announces IS the number of calls the sweep will spend.
  { name: 'plan:cells', file: 'plan-cells.ts', args: ['--write'], dryRunArgs: [] },
  // The dry run of `sweep` reads the plan from the database; in dry run the plan is
  // precisely not written there. Calling it anyway would fail on "no cell to do", a
  // failure that says nothing about the real sweep.
  //
  // A RESUME is the exception: the plan is already in the database, so the dry sweep has
  // something real to read and is the only thing that reports what the quota period still
  // allows. Without it a dry cycle on an unfinished sweep played nothing at all.
  { name: 'sweep:google', file: 'sweep.ts', args: ['--go'], dryRunArgs: null, dryRunOnResume: ['--dry-run'] },
  { name: 'match:sirene', file: 'match-sirene.ts', args: [], dryRunArgs: null },
  { name: 'compute:profiles', file: 'compute-profiles.ts', args: [], dryRunArgs: null },
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
    // The cycle stops dead. Chaining `match:sirene` after an incomplete sweep would match
    // against a truncated database and display a reassuring canary for the wrong reasons —
    // exactly the defect that does not show up in the UI.
    throw new Error(`${step.name} failed (exit code ${result.status}) — cycle interrupted`)
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

  // An unfinished sweep must be RESUMED, never replanned.
  //
  // `plan:cells --write` opens a brand-new run with its own cells. Doing that on top of an
  // interrupted sweep would strand the pending subdivisions, re-query the cells already
  // paid for, and spend a whole monthly quota without ever reaching the end — the base
  // would stay incomplete while the bill says otherwise. Finish what was started first.
  const unfinished = await unfinishedCellCount()
  const skipPlanning = unfinished > 0

  if (skipPlanning) {
    console.log(
      `\nUNFINISHED SWEEP DETECTED — ${unfinished} cell(s) still to query.\n` +
      'Planning is skipped: this cycle resumes the run in progress. Cells already\n' +
      'queried are not replayed, so only the remainder is paid for.',
    )
  }

  // Held rather than thrown, so the expiry below is still reported. A sweep that stops on
  // its quota ceiling fails the cycle by design (D22), and that is precisely the run whose
  // freshness matters most: reporting it only when everything else went well would keep it
  // quiet for exactly as long as the sweep takes to converge.
  let failure: Error | null = null
  try {
    for (const step of STEPS) {
      if (skipPlanning && step.name === 'plan:cells') continue

      const stepArgs = go ? step.args : (skipPlanning && step.dryRunOnResume) || step.dryRunArgs
      if (stepArgs === null) {
        console.log(`\n=== ${step.name} — not played in dry run ===`)
        continue
      }
      run(step, stepArgs)
    }
  } catch (error) {
    failure = error as Error
  }

  // While the sweep still owes cells, expiry is a known consequence of a sweep that
  // outlived its quota; once it has converged, a single expired record is a defect — the
  // base would be claiming a freshness it does not have.
  const freshness = await fetchHoursFreshness()
  reportFreshness(freshness)
  const converged = (await unfinishedCellCount()) === 0

  if (failure) throw failure

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(go
    ? `\nMonthly cycle finished in ${minutes} min. To check: the billing console ` +
      '(Enterprise usage ≈ number of cells, NOTHING on the Atmosphere tier), ' +
      'unresolved truncations, SIRENE unmatched rate.'
    : `\nDry run finished in ${minutes} min. Nothing was spent nor written.\n` +
      'The number of cells announced above is the number of calls --go would spend.')

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
