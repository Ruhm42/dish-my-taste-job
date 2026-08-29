/**
 * Google `Nearby Search` sweep — THE ONLY SCRIPT IN THE REPO THAT COSTS MONEY.
 *
 * A full sweep was forecast at ~692 calls; the first real one spent 900 without converging
 * (D22), and the account has no safety credit — any overage goes on the credit card from
 * the very first euro. Hence `--dry-run` by default, the two hard-stop counters, and the
 * refusal to replay a recent sweep.
 *
 * The counters are indexed on the QUOTA PERIOD, never on the sweep: a sweep that outlives
 * the month paying for it must still be resumable (D28, spec technique/10).
 *
 * See .specs/technique/02-budget-google-et-garde-fous.md
 *  and .specs/technique/03-algorithme-de-balayage.md
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/sweep.ts            # dry run, 0 calls
 *   node --env-file=.env.local --import tsx scripts/sweep.ts --go       # actually spends
 *   node --env-file=.env.local --import tsx scripts/sweep.ts --go --force
 *   node --env-file=.env.local --import tsx scripts/sweep.ts --as-of=2026-09-01T03:00:00Z
 */
import { and, count, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { cell, restaurant, sireneEstablishment, sweepRun } from '../lib/db/schema'
import {
  DISTRICT_BY_COMMUNE, SWEEP, FIELD_MASK, GRID, COMMUNE_NAMES, GOOGLE_DAILY_NEARBY_CAP,
  GOOGLE_TO_SIRENE_RATIO, MAX_NEARBY_RESULTS, HOURS_TTL_DAYS, GOOGLE_PLACE_TYPES,
} from '../lib/config'
import { callsLeft, dayKey, dayWindow, monthKey, monthWindow, type Window } from '../lib/quota'
import { inferCategory, inferCuisine } from '../lib/category'
import { computeProfile, parseOpeningHours } from '../lib/hours'
import type { Category, GoogleOpeningHours } from '../lib/hours'
import { profileColumns } from '../lib/profile-columns'
// The grid laid its circles down with THIS distance: cross-checking them with another
// approximation would push points the plan had placed inside a circle out of it.
import { distanceInMeters, METERS_PER_DEGREE_LAT } from '../lib/grid'

const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby'

/** Beyond this, the nearest SIRENE point is no longer proof of a commune, just a neighbour. */
const COMMUNE_ATTACHMENT_RADIUS = 300

const RAD = Math.PI / 180

/** Simulates a quota period so spec 10's acceptance criteria can be played, not argued. */
const AS_OF = '--as-of='

const SWEEP_SUCCEEDED = 'succeeded'
const SWEEP_FAILED = 'failed'

type CellRow = typeof cell.$inferSelect

interface GooglePlace {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  businessStatus?: string
  regularOpeningHours?: GoogleOpeningHours
  nationalPhoneNumber?: string
}

interface SirenePoint {
  lat: number
  lng: number
  communeCode: string
  commune: string | null
}

interface State {
  calls: number
  /**
   * Calls billed inside the CURRENT quota period, all runs and all executions taken
   * together — the sweep's own total is not what Google bills (D28).
   *
   * Both counters carry the window they were measured for: an execution outlives its day
   * (the first sweep started at 23:55 UTC) and can outlive its month, and a counter that
   * did not notice would refuse calls the new window allows.
   */
  periodSpent: number
  period: string
  daySpent: number
  day: string
  cellsQueried: number
  seen: Set<string>
  withHours: Set<string>
  withoutCommune: Set<string>
  sirenePoints: SirenePoint[]
}

// --- Geometry ----------------------------------------------------------------------

function distance(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return distanceInMeters({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
}

/** Bounding-box prefilter before the exact distance — there is no PostGIS (D12). */
function pointsInCircle(points: SirenePoint[], lat: number, lng: number, radius: number): SirenePoint[] {
  const dLat = radius / METERS_PER_DEGREE_LAT
  const dLng = dLat / Math.max(0.01, Math.cos(lat * RAD))
  return points.filter(
    (p) =>
      Math.abs(p.lat - lat) <= dLat &&
      Math.abs(p.lng - lng) <= dLng &&
      distance(lat, lng, p.lat, p.lng) <= radius,
  )
}

/**
 * Four circles covering the parent circle WITH NO GAP.
 *
 * We cover the square circumscribing the parent: each of its four quadrants, of side R,
 * fits inside a circle of radius R·√2/2 centred on that quadrant. A tighter split (four
 * circles of radius R/2) would leave four areas that are never queried — exactly the kind
 * of defect that never shows up in the UI.
 */
function subdivide(parent: CellRow): { lat: number; lng: number; radius: number }[] {
  const radius = Math.max(GRID.minRadius, parent.radius * Math.SQRT1_2)
  const half = parent.radius / 2
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(parent.lat * RAD))

  return [
    [-half, -half], [half, -half], [-half, half], [half, half],
  ].map(([dx, dy]) => ({
    lat: parent.lat + dy / METERS_PER_DEGREE_LAT,
    lng: parent.lng + dx / metersPerDegreeLng,
    radius,
  }))
}

// --- Google call --------------------------------------------------------------------

async function queryGoogle(lat: number, lng: number, radius: number): Promise<GooglePlace[]> {
  const response = await fetch(NEARBY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY as string,
      // Shared constant, never rebuilt: billing follows the most expensive field.
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [...GOOGLE_PLACE_TYPES],
      maxResultCount: MAX_NEARBY_RESULTS,
      // Without this ordering, the distance of the last result says nothing: it is what
      // makes truncation detectable at all.
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    }),
  })

  // Here a 429 does not mean "slow down" but "quota exhausted": we do not retry.
  if (response.status === 429) {
    throw new Error(
      'HTTP 429 — Google quota reached. DO NOT RERUN before the monthly renewal. ' +
      `Response: ${(await response.text()).slice(0, 300)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`)
  }

  const data = (await response.json()) as { places?: GooglePlace[] }
  return data.places ?? []
}

/**
 * Results being sorted by distance and capped at 20, any establishment past the 20th was
 * dropped: the cell is only covered up to the distance of the last one. The SIRENE count
 * acts as a second signal, independent of how right the first one is.
 */
function detectTruncation(
  found: number, maxDistance: number, radius: number, sireneCount: number,
): { truncated: boolean; reason: string } {
  if (found < MAX_NEARBY_RESULTS) return { truncated: false, reason: '' }

  if (maxDistance < radius) {
    return {
      truncated: true,
      reason: `20 results, the farthest at ${Math.round(maxDistance)} m for a radius of ${Math.round(radius)} m`,
    }
  }
  if (sireneCount * GOOGLE_TO_SIRENE_RATIO >= MAX_NEARBY_RESULTS) {
    return {
      truncated: true,
      reason: `20 results and ${sireneCount} SIRENE establishments expected inside the circle`,
    }
  }
  return { truncated: false, reason: '' }
}

// --- Writing the establishments -------------------------------------------------------

/**
 * Administrative attachment through the nearest geocoded SIRENE point: without commune
 * geometry (D12), that is the only membership we can establish. It is approximate along
 * commune borders — preferable to an invented district.
 */
function nearestSirenePoint(state: State, lat: number, lng: number): SirenePoint | null {
  const nearby = pointsInCircle(state.sirenePoints, lat, lng, COMMUNE_ATTACHMENT_RADIUS)
  let best: SirenePoint | null = null
  let bestDistance = Infinity
  for (const p of nearby) {
    const d = distance(lat, lng, p.lat, p.lng)
    if (d < bestDistance) {
      bestDistance = d
      best = p
    }
  }
  return best
}

async function writePlaces(places: GooglePlace[], state: State): Promise<void> {
  const valid = places.filter((p) => p.id && p.location?.latitude != null && p.location?.longitude != null)
  for (const rejected of places.filter((p) => !valid.includes(p))) {
    console.warn(`  ! place without an id or a position, skipped: ${JSON.stringify(rejected).slice(0, 160)}`)
  }
  if (valid.length === 0) return

  // Headcount and activity code belong to `match:sirene`, the refined category to
  // `compute:profiles`. We read them back so this sweep degrades nothing they produced.
  const known = await db
    .select({
      id: restaurant.googlePlaceId,
      headcount: restaurant.headcountCode,
      naf: restaurant.nafCode,
      category: restaurant.category,
    })
    .from(restaurant)
    .where(inArray(restaurant.googlePlaceId, valid.map((p) => p.id as string)))
  const previous = new Map(known.map((r) => [r.id, r]))

  const now = new Date()
  const expiresAt = new Date(now.getTime() + HOURS_TTL_DAYS * 24 * 3600 * 1000)

  for (const place of valid) {
    const id = place.id as string
    const lat = place.location!.latitude as number
    const lng = place.location!.longitude as number

    const hours = place.regularOpeningHours ?? null
    const windows = parseOpeningHours(hours)
    const name = place.displayName?.text ?? '(sans nom)'

    // `other` from a place with no types at all is ignorance and must not overwrite what
    // is stored; `other` decided from real types is a verdict — a supermarket is not an
    // eating place — and it must.
    const stored = previous.get(id)
    const inferred = inferCategory({ types: place.types, naf: stored?.naf, name })
    const hadSignal = (place.types?.length ?? 0) > 0
    const category: Category =
      inferred === 'other' && !hadSignal ? (stored?.category ?? 'other') : inferred

    const cuisine = inferCuisine(place.types)
    const profile = computeProfile({ windows, headcountCode: stored?.headcount, category })

    const point = nearestSirenePoint(state, lat, lng)
    if (!point) state.withoutCommune.add(id)

    const row = {
      googlePlaceId: id,
      name,
      formattedAddress: place.formattedAddress ?? null,
      lat,
      lng,
      googleTypes: place.types ?? [],
      businessStatus: place.businessStatus ?? null,
      inseeCode: point?.communeCode ?? null,
      commune: point ? (COMMUNE_NAMES[point.communeCode] ?? point.commune) : null,
      district: point ? (DISTRICT_BY_COMMUNE[point.communeCode] ?? null) : null,
      category,
      cuisine,
      phone: place.nationalPhoneNumber ?? null,
      rawOpeningHours: hours,
      hoursFetchedAt: hours ? now : null,
      hoursExpiresAt: hours ? expiresAt : null,
      ...profileColumns(windows, profile),
      profileComputedAt: now,
      lastSeenAt: now,
    }

    // What `row` does not carry is not rewritten: `firstSeenAt`, which dates the first
    // appearance, and the SIRENE link, which belongs to `match:sirene`.
    await db.insert(restaurant).values(row)
      .onConflictDoUpdate({ target: restaurant.googlePlaceId, set: row })

    state.seen.add(id)
    if (hours) state.withHours.add(id)
  }
}

// --- Processing one cell --------------------------------------------------------------

/**
 * Books one call against the two windows a ceiling applies to, and refuses when either is
 * out. Called BEFORE the request: a call we cannot account for is a call we must not make.
 *
 * A sweep runs for hours — the first one crossed UTC midnight mid-run — so the windows are
 * re-read every cell rather than once at startup. Crossing into a new one resets that
 * counter to zero: nothing carries over, in either direction (D28). No query needed to do
 * it, since nothing else can have queried a cell in a window we have only just entered.
 */
function spendOne(state: State, now: Date): void {
  const period = monthKey(now)
  const day = dayKey(now)
  if (period !== state.period) {
    state.period = period
    state.periodSpent = 0
  }
  if (day !== state.day) {
    state.day = day
    state.daySpent = 0
  }

  const { left, binding } = callsLeft(
    { month: state.periodSpent, day: state.daySpent },
    { perMonth: SWEEP.maxCallsPerPeriod, perDay: SWEEP.maxCallsPerDay },
  )
  if (left <= 0) throw new Error(ceilingReached(state, binding))

  state.periodSpent++
  state.daySpent++
  state.calls++
}

/**
 * The message has to say what to do next, because the two ceilings call for opposite
 * moves — and because the run it stops is resumable either way, with nothing to replan.
 */
function ceilingReached(state: State, binding: 'month' | 'day'): string {
  return binding === 'month'
    ? `monthly ceiling of ${SWEEP.maxCallsPerPeriod} calls reached for ${state.period} ` +
      `(SWEEP.maxCallsPerPeriod) — ${state.periodSpent} spent in that period, ` +
      `${state.calls} of them by this execution. Stopping before any further spending. ` +
      'Resume on the 1st of next month: the cells already queried are not replayed.'
    : `daily ceiling of ${SWEEP.maxCallsPerDay} calls reached for ${state.day} UTC ` +
      `(SWEEP.maxCallsPerDay, under the ${GOOGLE_DAILY_NEARBY_CAP}/day set on the Google side) — ` +
      `${state.daySpent} spent today, ${state.calls} by this execution. ` +
      'Rerun tomorrow: nothing to replan, the resume picks up where this stopped.'
}

async function processCell(c: CellRow, state: State): Promise<void> {
  spendOne(state, new Date())

  let places: GooglePlace[]
  try {
    places = await queryGoogle(c.lat, c.lng, c.radius)
  } catch (error) {
    await db.update(cell)
      .set({ status: 'failed', queriedAt: new Date() })
      .where(eq(cell.id, c.id))
    throw error
  }
  state.cellsQueried++

  const maxDistance = places.reduce((max, p) => {
    const lat = p.location?.latitude
    const lng = p.location?.longitude
    if (lat == null || lng == null) return max
    return Math.max(max, distance(c.lat, c.lng, lat, lng))
  }, 0)

  await writePlaces(places, state)

  const measurement = {
    googleCount: places.length,
    lastResultDistance: places.length ? maxDistance : null,
    queriedAt: new Date(),
  }
  const { truncated, reason } = detectTruncation(places.length, maxDistance, c.radius, c.sireneCount)

  if (!truncated) {
    await db.update(cell).set({ ...measurement, status: 'done' }).where(eq(cell.id, c.id))
    return
  }

  if (c.depth >= SWEEP.maxDepth) {
    await db.update(cell).set({ ...measurement, status: 'irreducible' }).where(eq(cell.id, c.id))
    console.warn(
      `  ! IRREDUCIBLE — ${c.lat.toFixed(5)},${c.lng.toFixed(5)} r=${Math.round(c.radius)} m ` +
      `depth ${c.depth}: ${reason}. Inspect by hand.`,
    )
    return
  }

  const children = subdivide(c).map((child) => ({
    sweepRunId: c.sweepRunId,
    lat: child.lat,
    lng: child.lng,
    radius: child.radius,
    sireneCount: pointsInCircle(state.sirenePoints, child.lat, child.lng, child.radius).length,
    depth: c.depth + 1,
    parentId: c.id,
    status: 'pending' as const,
  }))

  // Marking and children in the same transaction: a truncated cell without children
  // would be a truncation lost from sight.
  await db.transaction(async (tx) => {
    await tx.update(cell).set({ ...measurement, status: 'truncated' }).where(eq(cell.id, c.id))
    await tx.insert(cell).values(children)
  })

  console.log(`  truncation (${reason}) -> 4 cells of ${Math.round(children[0].radius)} m`)
}

// --- What the quota period has already paid for -----------------------------------------

/**
 * Calls booked inside one window, all runs taken together.
 *
 * One queried cell is one call, and every call writes `queried_at` — the success branch
 * through `measurement`, the error branch through the `failed` update. So this count IS
 * the spend, with no ledger to keep in step with reality.
 *
 * It under-reports by one per cell that had to be requeried in a LATER execution, since
 * the retry overwrites the earlier `queried_at`. A cell-level failure halts the whole
 * sweep, so that is bounded by one call per failed execution — against the 100 calls of
 * slack between our 900 and the free 1,000.
 */
async function spentIn(w: Window): Promise<number> {
  const [row] = await db.select({ n: count() }).from(cell)
    .where(and(gte(cell.queriedAt, w.start), lt(cell.queriedAt, w.end)))
  return row?.n ?? 0
}

// --- Summary --------------------------------------------------------------------------

/** A truncated cell is covered only if ALL its children are, recursively. */
function buildCoverage(cells: CellRow[]): (c: CellRow) => boolean {
  const children = new Map<string, CellRow[]>()
  for (const c of cells) {
    if (!c.parentId) continue
    const list = children.get(c.parentId) ?? []
    list.push(c)
    children.set(c.parentId, list)
  }
  const isCovered = (c: CellRow): boolean => {
    if (c.status === 'done') return true
    if (c.status !== 'truncated') return false
    const kids = children.get(c.id) ?? []
    return kids.length > 0 && kids.every(isCovered)
  }
  return isCovered
}

function percent(part: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((part / total) * 100)}%`
}

// --- Main program -----------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter(
    (a) => !['--go', '--dry-run', '--force'].includes(a) && !a.startsWith(AS_OF),
  )
  if (unknown.length) {
    console.error(
      `Unknown options: ${unknown.join(' ')}. Expected: --go, --dry-run, --force, ${AS_OF}<ISO date>`,
    )
    process.exit(1)
  }
  const go = args.includes('--go')
  const force = args.includes('--force')

  // Reading what another period would allow is useful; letting a run that SPENDS pick its
  // own clock would be a way to talk the ceiling out of its budget. Dry run only.
  const asOf = args.find((a) => a.startsWith(AS_OF))?.slice(AS_OF.length)
  if (asOf && go) {
    console.error('--as-of simulates a quota period and cannot be combined with --go.')
    process.exit(1)
  }
  const now = asOf ? new Date(asOf) : new Date()
  if (Number.isNaN(now.getTime())) {
    console.error(`--as-of=${asOf} is not a date. Expected an ISO instant, e.g. 2026-09-01T03:00:00Z`)
    process.exit(1)
  }
  if (asOf) console.log(`SIMULATED CLOCK — reading the plan as of ${now.toISOString()}\n`)

  // 1. The plan. A run with cells still to do, or with cells that failed.
  const pendingRuns = await db
    .selectDistinct({ runId: cell.sweepRunId })
    .from(cell)
    .where(inArray(cell.status, ['pending', 'failed']))

  if (pendingRuns.length === 0) {
    console.error(
      'No sweep plan to execute: not a single "pending" cell.\n' +
      'Run `plan:cells` first — the sweep does not invent its own grid.',
    )
    process.exit(1)
  }

  const ids = pendingRuns.map((r) => r.runId)
  const knownRuns = await db.select().from(sweepRun)
    .where(inArray(sweepRun.id, ids))
    .orderBy(desc(sweepRun.startedAt))

  if (knownRuns.length === 0 && ids.length > 1) {
    console.error(
      `${ids.length} pending sweep plans, none of them has a row in sweep_run: ` +
      'impossible to choose. Clean up the cell table before continuing.',
    )
    process.exit(1)
  }
  const runId = knownRuns[0]?.id ?? ids[0]
  if (ids.length > 1) {
    console.warn(`! ${ids.length} pending plans — only the most recent one (${runId}) is swept.`)
  }

  const cells = await db.select().from(cell).where(eq(cell.sweepRunId, runId))
  const planned = cells.filter((c) => !c.parentId).length
  const toQuery = cells.filter((c) => c.status === 'pending' || c.status === 'failed').length

  // 2. Recency: the quota is monthly, two sweeps in a month consume it entirely.
  const [lastSucceeded] = await db.select().from(sweepRun)
    .where(eq(sweepRun.status, SWEEP_SUCCEEDED))
    .orderBy(desc(sweepRun.finishedAt))
    .limit(1)

  const daysSince = lastSucceeded?.finishedAt
    ? (now.getTime() - lastSucceeded.finishedAt.getTime()) / 86_400_000
    : Infinity
  const tooRecent = daysSince < SWEEP.daysBetweenSweeps

  // What the CURRENT QUOTA PERIOD still allows — not what this run has spent since it
  // opened. Judging the refusal on the run total deadlocked the resume: the total only
  // ever rises, so a run that reached the ceiling could never spend again (D28).
  const periodSpent = await spentIn(monthWindow(now))
  const daySpent = await spentIn(dayWindow(now))
  const headroom = callsLeft(
    { month: periodSpent, day: daySpent },
    { perMonth: SWEEP.maxCallsPerPeriod, perDay: SWEEP.maxCallsPerDay },
  )
  const binding = headroom.binding === 'month' ? 'monthly' : 'daily'
  // Still on screen because it is the logbook figure D22 was written from. It decides nothing.
  const runTotalToDate = knownRuns[0]?.callsMade ?? 0

  console.log('--- Sweep plan ---')
  console.log(`run                     : ${runId}`)
  console.log(`cells in the plan       : ${planned}`)
  console.log(`cells to query          : ${toQuery}`)
  console.log(`CALLS PLANNED           : ${toQuery}`)
  console.log('  + 4 calls per truncated cell, until convergence')
  console.log(`spent this period       : ${periodSpent} / ${SWEEP.maxCallsPerPeriod}  (${monthKey(now)})`)
  console.log(`spent today             : ${daySpent} / ${SWEEP.maxCallsPerDay}  (${dayKey(now)} UTC)`)
  console.log(`THIS RUN CAN SPEND      : ${headroom.left}  before the ${binding} ceiling stops it`)
  console.log(`run total to date       : ${runTotalToDate}  (logbook only, no longer the refusal)`)

  if (headroom.left === 0) {
    console.warn(`! the ${binding} ceiling is already reached: this run would stop on its first call.`)
  } else if (toQuery > headroom.left) {
    console.warn(
      `! ${toQuery} cells to query for ${headroom.left} call(s) left: the run will be cut ` +
      `short on the ${binding} ceiling and will have to be resumed. Nothing to replan.`,
    )
  }
  if (tooRecent) {
    console.warn(
      `! a sweep succeeded ${daysSince.toFixed(1)} day(s) ago, ` +
      `less than the ${SWEEP.daysBetweenSweeps} days required.`,
    )
  }

  if (!go) {
    console.log('\nDRY RUN — no call made, nothing written. Add --go to actually spend.')
    process.exit(0)
  }

  if (tooRecent && !force) {
    console.error(
      '\nREFUSING TO START: the Google quota is monthly and a full sweep consumes two ' +
      'thirds of it. Rerun after that delay, or force with --force knowingly.',
    )
    process.exit(1)
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is missing — see .specs/technique/08-infrastructure.md')
    process.exit(1)
  }

  // 3. The run may already exist (created by plan:cells, or interrupted and resumed).
  await db.insert(sweepRun).values({ id: runId, cellsPlanned: planned }).onConflictDoNothing()
  await db.update(sweepRun)
    .set({ cellsPlanned: planned, finishedAt: null, status: 'running', error: null })
    .where(eq(sweepRun.id, runId))
  const [current] = await db.select().from(sweepRun).where(eq(sweepRun.id, runId))

  // A resume does not reset the counters: what was already spent has been spent.
  const previousCalls = current.callsMade
  const previousCellsQueried = current.cellsQueried
  const runStartedAt = current.startedAt ?? new Date()

  // A failed cell never returned a result: the resume has to replay it.
  const toRetry = cells.filter((c) => c.status === 'failed').length
  if (toRetry > 0) {
    await db.update(cell).set({ status: 'pending' })
      .where(and(eq(cell.sweepRunId, runId), eq(cell.status, 'failed')))
    console.log(`${toRetry} failed cell(s) put back to pending.`)
  }
  const alreadyDone = cells.filter((c) => c.status === 'done').length
  if (alreadyDone > 0) console.log(`${alreadyDone} cell(s) already done, not replayed.`)

  const points = await db
    .select({
      lat: sireneEstablishment.lat,
      lng: sireneEstablishment.lng,
      communeCode: sireneEstablishment.communeCode,
      commune: sireneEstablishment.commune,
    })
    .from(sireneEstablishment)
    .where(and(
      isNotNull(sireneEstablishment.lat),
      isNotNull(sireneEstablishment.lng),
      gte(sireneEstablishment.geocodeScore, GRID.minGeocodeScore),
    ))

  if (points.length === 0) {
    console.warn(
      '! no geocoded SIRENE point: neither truncation cross-check nor commune attachment. ' +
      'The sweep goes on, but the database will come out without districts.',
    )
  }

  const state: State = {
    calls: 0,
    periodSpent,
    period: monthKey(now),
    daySpent,
    day: dayKey(now),
    cellsQueried: 0,
    seen: new Set(),
    withHours: new Set(),
    withoutCommune: new Set(),
    sirenePoints: points as SirenePoint[],
  }

  console.log('\n--- Sweep running ---')
  let interruption: Error | null = null

  try {
    // Wave after wave: the children a truncation creates are picked up on the next pass.
    for (;;) {
      const batch = await db.select().from(cell)
        .where(and(eq(cell.sweepRunId, runId), eq(cell.status, 'pending')))
        .orderBy(cell.depth, cell.id)
      if (batch.length === 0) break

      for (const c of batch) {
        // Sequential and never parallel: the call counter has to stay exact.
        await processCell(c, state)
        if (state.cellsQueried % 25 === 0) {
          console.log(`  ${state.calls} calls, ${state.seen.size} establishments`)
        }
      }
    }
  } catch (error) {
    // Any error stops the sweep: keeping on calling an API that answers badly is spending
    // without collecting. The cells already done will not be replayed.
    interruption = error as Error
    console.error(`\nSWEEP HALTED IMMEDIATELY — ${interruption.message}`)
  }

  // 4. Summary. It is authoritative: it is what decides whether the sweep succeeded.
  const finalCells = await db.select().from(cell).where(eq(cell.sweepRunId, runId))
  const isCovered = buildCoverage(finalCells)
  const truncatedCells = finalCells.filter((c) => c.status === 'truncated')
  const resolved = truncatedCells.filter(isCovered).length
  const unresolved = truncatedCells.length - resolved
  const irreducible = finalCells.filter((c) => c.status === 'irreducible').length
  const failed = finalCells.filter((c) => c.status === 'failed').length
  const remaining = finalCells.filter((c) => c.status === 'pending').length

  const reasons: string[] = []
  if (unresolved > 0) reasons.push(`${unresolved} unresolved truncation(s)`)
  if (irreducible > 0) reasons.push(`${irreducible} irreducible cell(s)`)
  if (failed > 0) reasons.push(`${failed} failed cell(s)`)
  if (remaining > 0) reasons.push(`${remaining} cell(s) never queried`)
  if (interruption) reasons.push(`interrupted: ${interruption.message}`)

  // Cumulative across resumes: this is the counter we compare with the billing console.
  const [{ runTotal }] = await db.select({ runTotal: count() }).from(restaurant)
    .where(gte(restaurant.lastSeenAt, runStartedAt))
  const resumed = previousCalls > 0

  console.log('\n--- Sweep summary ---')
  console.log(`cells planned            : ${planned}`)
  console.log(`cells queried            : ${state.cellsQueried}`)
  console.log(`CALLS SPENT              : ${state.calls}  (planned: ${toQuery})`)
  console.log(`spent this period        : ${state.periodSpent} / ${SWEEP.maxCallsPerPeriod}  (${state.period})`)
  console.log(`spent today              : ${state.daySpent} / ${SWEEP.maxCallsPerDay}  (${state.day} UTC)`)
  if (resumed) {
    console.log(`  run total              : ${previousCalls + state.calls} calls, ` +
      `${previousCellsQueried + state.cellsQueried} cells queried`)
  }
  console.log(`truncations resolved     : ${resolved}`)
  console.log(`truncations UNRESOLVED   : ${unresolved}`)
  console.log(`irreducible cells        : ${irreducible}`)
  console.log(`failed cells             : ${failed}`)
  console.log(`cells never queried      : ${remaining}`)
  console.log(`establishments found     : ${state.seen.size}`)
  if (resumed) console.log(`  run total              : ${runTotal}`)
  console.log(`  with opening hours     : ${state.withHours.size} (${percent(state.withHours.size, state.seen.size)})`)
  console.log(`  without a commune      : ${state.withoutCommune.size}`)

  if (irreducible > 0) {
    const list = finalCells.filter((c) => c.status === 'irreducible')
    console.log('\nIrreducible cells to inspect:')
    for (const c of list.slice(0, 20)) {
      console.log(`  ${c.lat.toFixed(5)},${c.lng.toFixed(5)} r=${Math.round(c.radius)} m — ${c.googleCount} results, SIRENE ${c.sireneCount}`)
    }
    if (list.length > 20) {
      console.log(`  … and ${list.length - 20} more: select * from cell where sweep_run_id = '${runId}' and status = 'irreducible'`)
    }
  }

  const succeeded = reasons.length === 0
  await db.update(sweepRun).set({
    finishedAt: new Date(),
    cellsPlanned: planned,
    cellsQueried: previousCellsQueried + state.cellsQueried,
    callsMade: previousCalls + state.calls,
    truncatedUnresolved: unresolved,
    irreducibleCells: irreducible,
    placesFound: runTotal,
    status: succeeded ? SWEEP_SUCCEEDED : SWEEP_FAILED,
    error: succeeded ? null : reasons.join(' ; '),
  }).where(eq(sweepRun.id, runId))

  if (!succeeded) {
    console.error(`\nSWEEP FAILED — ${reasons.join(' ; ')}`)
    console.error('A silently incomplete database is worse than a script in error: ' +
      'resume this run (cells already done are not replayed) once the cause is handled.')
    process.exit(1)
  }

  console.log('\nSweep succeeded. Next in the pipeline: match:sirene then compute:profiles.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
