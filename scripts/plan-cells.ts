/**
 * plan:cells — computes the sweep plan from the known SIRENE density, and announces what
 * it would cost in Google calls.
 *
 * This script spends no quota, but it DECIDES the quota `sweep:google` will spend: one
 * cell = one `Nearby Search` call. It is the pipeline's checkpoint — we do not sweep a
 * plan whose cost has not been read.
 *
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts            (dry run)
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts --write    (writes)
 */
import { count, inArray } from 'drizzle-orm'
import {
  COMMUNE_CODES, COMMUNE_NAMES, FREE_MONTHLY_QUOTA, GOOGLE_TO_SIRENE_RATIO,
  GRID, MAX_NEARBY_RESULTS, SWEEP,
} from '../lib/config'
import { db } from '../lib/db/client'
import { cell, sireneEstablishment, sweepRun } from '../lib/db/schema'
import { planCells } from '../lib/grid'
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

function printCost(cells: Cell[]) {
  const calls = cells.length
  const headroom = FREE_MONTHLY_QUOTA - calls

  console.log('\nSWEEP COST')
  row('Nearby Search calls', num(calls))
  row('ceiling per quota period', num(SWEEP.maxCallsPerPeriod))
  row('ceiling per UTC day', num(SWEEP.maxCallsPerDay), 'so a plan this size takes several days')
  row('free monthly quota', num(FREE_MONTHLY_QUOTA))
  row(
    'headroom for subdivisions',
    num(headroom),
    headroom > 0 ? `${Math.round((100 * headroom) / calls)}% of the cells` : 'OVER BUDGET',
  )
  return calls
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

  const calls = printCost(cells)

  if (calls > SWEEP.maxCallsPerPeriod) {
    console.log(
      `\n!!! WARNING — the plan asks for ${num(calls)} calls, beyond what one quota period ` +
        `allows (${num(SWEEP.maxCallsPerPeriod)}).\n` +
        `    The free monthly quota is ${num(FREE_MONTHLY_QUOTA)} calls and truncated cells\n` +
        '    subdivide: the sweep will spend more than that figure.\n' +
        '    Rework GRID (target, maxRadius) or shrink the perimeter before sweeping.',
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
  console.error(`\nplan:cells failed — ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
