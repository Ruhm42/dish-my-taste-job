/**
 * plan:cells — computes the sweep plan from the known SIRENE density, and announces what
 * it would cost in Google calls.
 *
 * This script spends no quota, but it DECIDES the ground `sweep:google` will spend on: one
 * cell = one `Nearby Search` call. It is the pipeline's checkpoint — we do not sweep a
 * plan whose cost has not been read, and the cost of a month is the cover of the plan in
 * place, not the plan's cell count (D37).
 *
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts            (dry run)
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts --write    (writes)
 */
import { count, inArray } from 'drizzle-orm'
import {
  CELLS_PER_TRUNCATION, COMMUNE_CODES, COMMUNE_NAMES, CYCLE, EXPECTED_TRUNCATION_RATE,
  FREE_MONTHLY_QUOTA, GOOGLE_TO_SIRENE_RATIO, GRID, MAX_NEARBY_RESULTS,
  PAID_PRICE_PER_1000_CALLS, PERIMETER_REVIEW_ABOVE, RETRUNCATION_RATE_BY_DEPTH, SWEEP,
} from '../lib/config'
import { buildCoverIndex, convergedTree, planPass } from '../lib/coverage'
import { db } from '../lib/db/client'
import { loadCoverInputs } from '../lib/db/cover-inputs'
import { cell, sireneEstablishment, sweepRun } from '../lib/db/schema'
import { errorReason } from '../lib/error-reason'
import { planCells } from '../lib/grid'
import { nextScheduledPass } from '../lib/quota'
import type { Cell, Point } from '../lib/grid'

/** Share of discarded establishments beyond which geocoding is suspect. */
const DISCARDED_ALERT_THRESHOLD = 0.05

function parseOptions() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a !== '--write' && a !== '--dry-run')
  if (unknown.length > 0) {
    throw new Error(
      `unknown option: ${unknown.join(' ')} — only --dry-run (default) and --write exist`,
    )
  }
  if (args.includes('--write') && args.includes('--dry-run')) {
    throw new Error('--write and --dry-run contradict each other: pick one')
  }
  return { write: args.includes('--write') }
}

const num = (n: number) => n.toLocaleString('en-US')

const row = (label: string, value: string | number, suffix = '') =>
  console.log(`  ${label.padEnd(32)}${String(value).padStart(9)}${suffix ? '  ' + suffix : ''}`)

/** Nearest-rank quantile: no interpolation, the value exists. */
function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

async function loadPoints() {
  const [{ n: rowsInTable }] = await db.select({ n: count() }).from(sireneEstablishment)

  const rows = await db
    .select({
      lat: sireneEstablishment.lat,
      lng: sireneEstablishment.lng,
      score: sireneEstablishment.geocodeScore,
      communeCode: sireneEstablishment.communeCode,
    })
    .from(sireneEstablishment)
    .where(inArray(sireneEstablishment.communeCode, [...COMMUNE_CODES]))

  const points: Point[] = []
  const byCommune = new Map<string, number>()
  let withoutCoordinates = 0
  let lowScore = 0

  for (const r of rows) {
    if (r.lat === null || r.lng === null) {
      withoutCoordinates++
      continue
    }
    // A badly geocoded point shifts a whole cell: a known hole beats a circle laid down
    // in the wrong place.
    if ((r.score ?? 0) < GRID.minGeocodeScore) {
      lowScore++
      continue
    }
    points.push({ lat: r.lat, lng: r.lng })
    byCommune.set(r.communeCode, (byCommune.get(r.communeCode) ?? 0) + 1)
  }

  return {
    rowsInTable,
    inPerimeter: rows.length,
    outsidePerimeter: rowsInTable - rows.length,
    withoutCoordinates,
    lowScore,
    points,
    byCommune,
  }
}

function printPlan(cells: Cell[], pointCount: number) {
  const radii = cells.map((c) => c.radius).sort((a, b) => a - b)
  const counts = cells.map((c) => c.sireneCount).sort((a, b) => a - b)
  // A cell that did not reach the target was necessarily closed by the radius. The split
  // between the two is what tells which constraint dominates.
  const atTarget = cells.filter((c) => c.sireneCount >= GRID.target).length
  const byRadius = cells.length - atTarget
  const truncationRisk = cells.filter(
    (c) => c.sireneCount * GOOGLE_TO_SIRENE_RATIO >= MAX_NEARBY_RESULTS,
  ).length
  const pct = (n: number) => `${Math.round((100 * n) / cells.length)}%`

  console.log('\nCELLS')
  row('count', num(cells.length))
  row('median radius', `${Math.round(quantile(radii, 0.5))} m`)
  row('p95 radius', `${Math.round(quantile(radii, 0.95))} m`)
  row('min / max radius', `${Math.round(radii[0])} / ${Math.round(radii[radii.length - 1])} m`)
  row('median points/cell', quantile(counts, 0.5))
  row('p95 / max points/cell', `${quantile(counts, 0.95)} / ${counts[counts.length - 1]}`)
  row('mean points/cell', (pointCount / cells.length).toFixed(1))

  console.log('\nWHAT CLOSES THE CELLS')
  row(`the radius (${GRID.maxRadius} m ceiling)`, num(byRadius), pct(byRadius))
  row(`the point target (${GRID.target})`, num(atTarget), pct(atTarget))
  row(`estimated >= ${MAX_NEARBY_RESULTS} at Google`, num(truncationRisk), `measured ratio x${GOOGLE_TO_SIRENE_RATIO}`)
}

/**
 * What a month costs, and the two figures that used to pass for it — three numbers, each
 * named for what it is (D37).
 *
 *  - THE COVER: what one refresh of everything costs, drawn from the complete cells of the
 *    plan in place (D36). It is the figure that decides, and the rule-4 table applies to it.
 *    It only exists once a plan has been queried: a cover is made of complete cells.
 *  - THE ONE-LEVEL FLOOR: this plan's cells, plus one level of recovery at the expected
 *    truncation rate. What plan:cells used to announce alone.
 *  - THE CONVERGED TREE: the plan once every truncation is recovered, at the re-truncation
 *    rates measured by depth. Under the cover it is not a bill but a discovery backlog — and
 *    arbitrating on it would reopen zero euro for a cost nobody pays.
 */
function printCost(cells: Cell[], inPlace: PlanInPlace | null) {
  const calls = cells.length
  const truncations = Math.round(calls * EXPECTED_TRUNCATION_RATE)
  const floor = calls + Math.round(truncations * CELLS_PER_TRUNCATION)
  // The tree the plan in place grows into, when there is one: that is the backlog the passes
  // will be discovering. This plan's otherwise.
  const tree = convergedTree(inPlace?.depth0 ?? calls, RETRUNCATION_RATE_BY_DEPTH, SWEEP.maxDepth)
  const cover = inPlace?.cover ?? null

  console.log('\nWHAT A MONTH COSTS (D37)')
  if (cover) {
    row('COVER, robust', num(cover.robust), 'calls per refresh — THE FIGURE THAT DECIDES')
    row('cover, known records', num(cover.known), 'the fallback when the robust one does not fit (D36 rule 3)')
  } else {
    console.log('  No plan in place has been queried yet: a cover is drawn from complete cells, and')
    console.log('  there are none before the first pass. The figures below are the only ones available.')
  }
  row('one-level floor', num(floor), `this plan + one level of recovery (${Math.round(100 * EXPECTED_TRUNCATION_RATE)}% x${CELLS_PER_TRUNCATION}) — not a cost`)
  row(`converged tree${inPlace ? ', plan in place' : ''}`, num(tree.total), `by depth ${tree.byDepth.map(num).join(' / ')} — a discovery backlog, not a bill`)
  row('ceiling per quota period', num(SWEEP.maxCallsPerPeriod), `two passes: ${num(CYCLE.firstPassCeiling)} by the 16th, the rest after`)
  row('free monthly quota', num(FREE_MONTHLY_QUOTA))

  const deciding = cover?.robust ?? floor
  console.log(`\nARBITRATION (D30 rule 4, on the ${cover ? 'robust cover' : 'one-level floor, lacking a cover'})`)
  if (deciding <= SWEEP.maxCallsPerPeriod) {
    console.log(
      `  Nothing to arbitrate: ${num(deciding)} <= ${num(SWEEP.maxCallsPerPeriod)}. The perimeter question\n` +
      '  stays closed while the cover stays under the ceiling. What the ceiling leaves goes to the\n' +
      '  16th\'s second refresh, then to discovery; `simulate:passes` says whether the two passes\n' +
      '  keep the worst hour at the D38 target.',
    )
  } else if (deciding <= PERIMETER_REVIEW_ABOVE) {
    console.log(
      `  ${num(deciding)} sits between ${num(SWEEP.maxCallsPerPeriod)} and ` +
      `${num(PERIMETER_REVIEW_ABOVE)}: the perimeter is reduced at MEASURED YIELD\n` +
      '  until it comes back under the ceiling — not at geography.\n' +
      '  See .specs/technique/11-convergence-du-balayage.md rule 5.',
    )
  } else {
    const overage = deciding - FREE_MONTHLY_QUOTA
    const price = Math.ceil(overage / 1000) * PAID_PRICE_PER_1000_CALLS
    console.log(
      `  ${num(deciding)} is above ${num(PERIMETER_REVIEW_ABOVE)}: "zero euro" does not hold\n` +
      `  at this perimeter. It reopens explicitly, with its price — ${num(overage)} calls\n` +
      `  beyond the free quota, $${PAID_PRICE_PER_1000_CALLS} per 1,000, so about $${price} a month —\n` +
      '  and with its own entry in the decision log. Raising the ceiling is not one of the\n' +
      '  options: the guard rail has one purpose, and removing it while keeping it is not it.',
    )
  }
  return { calls }
}

interface PlanInPlace {
  depth0: number
  /** Whole covers, null while none of its cells is complete. */
  cover: { robust: number; known: number } | null
}

async function planInPlace(): Promise<PlanInPlace | null> {
  const inputs = await loadCoverInputs()
  if (!inputs) return null
  const depth0 = inputs.cells.filter((c) => c.depth === 0).length
  const index = buildCoverIndex(inputs.cells, inputs.records, inputs.sirene)
  if (index.candidates.length === 0) return { depth0, cover: null }
  const now = new Date()
  const plan = planPass(index, {
    now,
    nextPass: nextScheduledPass(now, CYCLE.scheduleDays, CYCLE.scheduleHourUtc),
    ceiling: 0,
  })
  return { depth0, cover: { robust: plan.robustCost, known: plan.knownCost } }
}

async function writePlan(cells: Cell[]) {
  const [run] = await db
    .insert(sweepRun)
    .values({ cellsPlanned: cells.length })
    .returning({ id: sweepRun.id })

  await db.insert(cell).values(
    cells.map((c) => ({
      sweepRunId: run.id,
      lat: c.lat,
      lng: c.lng,
      radius: c.radius,
      sireneCount: c.sireneCount,
    })),
  )

  console.log(`\n${num(cells.length)} cells written, attached to sweep_run ${run.id}`)
  console.log('Previous plans are left untouched: every run creates its own.')
}

async function main() {
  const { write } = parseOptions()
  const source = await loadPoints()

  console.log(
    write ? '\nSWEEP PLAN — WRITING TO THE DATABASE' : '\nSWEEP PLAN — DRY RUN (nothing written)',
  )

  console.log('\nSIRENE POINTS')
  row('rows in the database', num(source.rowsInTable))
  row('outside the perimeter (ignored)', num(source.outsidePerimeter))
  row('inside the perimeter', num(source.inPerimeter))
  row('without coordinates (discarded)', num(source.withoutCoordinates))
  row(`score < ${GRID.minGeocodeScore} (discarded)`, num(source.lowScore))
  row('kept for the grid', num(source.points.length))

  if (source.points.length === 0) {
    throw new Error(
      'no geocoded establishment inside the perimeter, nothing to lay a grid on.\n' +
        `  rows in sirene_establishment: ${source.rowsInTable}\n` +
        '  run ingest:sirene then ingest:geocode first.',
    )
  }

  // A geocoding blind spot is an area that is never queried, and its absence shows up
  // nowhere in the UI: it shows up here or never.
  const discarded = source.withoutCoordinates + source.lowScore
  const discardedRate = discarded / source.inPerimeter
  if (discardedRate > DISCARDED_ALERT_THRESHOLD) {
    console.log(
      `\n! ${Math.round(100 * discardedRate)}% of the establishments in the perimeter are discarded from the grid.` +
        '\n  That many areas potentially never queried. Resume ingest:geocode before' +
        '\n  sweeping, otherwise the hole stays invisible.',
    )
  }

  const cells = planCells(source.points, GRID)
  printPlan(cells, source.points.length)

  console.log('\nPOINTS PER COMMUNE')
  for (const [code, n] of [...source.byCommune].sort((a, b) => b[1] - a[1])) {
    row(COMMUNE_NAMES[code] ?? code, num(n))
  }

  const { calls } = printCost(cells, await planInPlace())

  // The refusal is on the plan's OWN cells: a plan whose first walk already exceeds a period
  // cannot be discovered in one, and writing it would enshrine that.
  if (calls > SWEEP.maxCallsPerPeriod) {
    console.log(
      `\n!!! WARNING — the plan asks for ${num(calls)} calls before a single truncation, ` +
        `beyond what one quota period allows (${num(SWEEP.maxCallsPerPeriod)}).\n` +
        '    Apply the arbitration above before writing it: reduce the perimeter at measured\n' +
        '    yield, or reopen the zero-euro constraint knowingly. Reworking GRID will not\n' +
        '    help — the radius ceiling is what dominates, not the density target.',
    )
    if (write) {
      throw new Error(
        'write refused: a plan above the ceiling must not become executable.',
      )
    }
  }

  if (write) await writePlan(cells)
  else console.log('\nDry run: nothing was written. Rerun with --write to store the plan.')

  process.exit(0)
}

main().catch((e) => {
  console.error(`\nplan:cells failed — ${errorReason(e)}`)
  process.exit(1)
})
