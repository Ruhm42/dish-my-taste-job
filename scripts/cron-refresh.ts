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
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { count, inArray } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { cell } from '../lib/db/schema'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Cells left to query, all runs taken together.
 *
 * `truncated` counts as unfinished just like `pending`: a truncated cell has been paid
 * for, but the subdivisions that recover what it hid have not been queried yet.
 */
async function pendingCellCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cell)
    .where(inArray(cell.status, ['pending', 'truncated']))
  return row?.n ?? 0
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
}

const STEPS: Step[] = [
  // The only step playable dry, and the only one that matters for the budget: the number
  // of cells it announces IS the number of calls the sweep will spend.
  { name: 'plan:cells', file: 'plan-cells.ts', args: ['--write'], dryRunArgs: [] },
  // The dry run of `sweep` reads the plan from the database; in dry run the plan is
  // precisely not written there. Calling it anyway would fail on "no cell to do", a
  // failure that says nothing about the real sweep.
  { name: 'sweep:google', file: 'sweep.ts', args: ['--go'], dryRunArgs: null },
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
  const unfinished = await pendingCellCount()
  const skipPlanning = unfinished > 0

  if (skipPlanning) {
    console.log(
      `\nUNFINISHED SWEEP DETECTED — ${unfinished} cell(s) still to query.\n` +
      'Planning is skipped: this cycle resumes the run in progress. Cells already\n' +
      'queried are not replayed, so only the remainder is paid for.',
    )
  }

  for (const step of STEPS) {
    if (skipPlanning && step.name === 'plan:cells') continue

    const stepArgs = go ? step.args : step.dryRunArgs
    if (stepArgs === null) {
      console.log(`\n=== ${step.name} — not played in dry run ===`)
      continue
    }
    run(step, stepArgs)
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(go
    ? `\nMonthly cycle finished in ${minutes} min. To check: the billing console ` +
      '(Enterprise usage ≈ number of cells, NOTHING on the Atmosphere tier), ' +
      'unresolved truncations, SIRENE unmatched rate.'
    : `\nDry run finished in ${minutes} min. Nothing was spent nor written.\n` +
      'The number of cells announced above is the number of calls --go would spend.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nMONTHLY CYCLE FAILED — ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  })
