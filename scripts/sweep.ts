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
 * And so is the plan itself: everything a cell collects expires 30 days later (D7), so
 * `done` means "done in THIS period" and one single plan is walked in the order its content
 * expires — refresh first, oldest first, discovery on what the quota leaves (D30 rule 1).
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
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sum } from 'drizzle-orm'
import { db, isTransactionPooler, sql as rawSql } from '../lib/db/client'
import { cell, restaurant, sireneEstablishment, sweepRun } from '../lib/db/schema'
import {
  DISTRICT_BY_COMMUNE, SWEEP, FIELD_MASK, GRID, COMMUNE_NAMES, FREE_MONTHLY_QUOTA,
  GOOGLE_TO_SIRENE_RATIO, MAX_NEARBY_RESULTS, HOURS_TTL_DAYS, GOOGLE_PLACE_TYPES,
} from '../lib/config'
import { callsLeft, monthKey, monthWindow, type Window } from '../lib/quota'
import { inferCategory, inferCuisine } from '../lib/category'
import { computeProfile, parseOpeningHours } from '../lib/hours'
import type { Category, GoogleOpeningHours } from '../lib/hours'
import { profileColumns } from '../lib/profile-columns'
// The grid laid its circles down with THIS distance: cross-checking them with another
// approximation would push points the plan had placed inside a circle out of it.
import { distanceInMeters, METERS_PER_DEGREE_LAT } from '../lib/grid'
// Shared with cron:refresh: the same rules decide what a period owes and what a
// truncation still hides, so the sweep and the cycle cannot disagree about either.
import { buildCoverage, countOwed, owesCall } from '../lib/coverage'

const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby'

/** Beyond this, the nearest SIRENE point is no longer proof of a commune, just a neighbour. */
const COMMUNE_ATTACHMENT_RADIUS = 300

const RAD = Math.PI / 180

/** Simulates a quota period so spec 10's acceptance criteria can be played, not argued. */
const AS_OF = '--as-of='

/** Arbitrary but fixed: an advisory lock key is only ever compared with itself. */
const SWEEP_LOCK_KEY = 828_100_128

type ReservedConnection = Awaited<ReturnType<typeof rawSql.reserve>>

/**
 * The reserved connection holding the advisory lock, at module scope so that every way out
 * of this script can give it back — the top-level `catch` included.
 */
let heldLock: ReservedConnection | null = null

/**
 * Hands the advisory lock back, explicitly.
 *
 * The comment where the lock is taken used to claim that a session-level lock leaves with
 * its connection, so a killed process frees it. Measured, that holds in exactly one case:
 *
 *  - giving the connection back mid-run frees nothing, on any kind of connection. `release()`
 *    returns it to postgres.js's pool, the backend stays alive, and the lock stays held —
 *    which is what the refusal below relied on and got wrong.
 *  - a process that dies on a DIRECT connection does free it, with the socket.
 *  - a process that dies through a POOLER does not: the backend stays parked at Supavisor
 *    still holding the lock, and every later sweep — the monthly cron included — is then
 *    refused by a lock whose owner is gone. It happened, and clearing it took a
 *    `pg_terminate_backend` on the holder.
 *
 * Called before each `process.exit` rather than from a `finally`, because `process.exit`
 * does not run one. Idempotent, so no call site has to know whether another already did it.
 */
async function releaseLock(): Promise<void> {
  const lock = heldLock
  if (!lock) return
  heldLock = null
  try {
    await lock`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`
  } catch (error) {
    console.error(
      `! the sweep lock could not be released: ${(error as Error).message}\n` +
      '  Every later sweep will be refused until it is cleared. Find the holder with\n' +
      `  select pid from pg_locks where locktype = 'advisory' and objid = ${SWEEP_LOCK_KEY}\n` +
      '  and terminate that backend.',
    )
  }
  await lock.release()
}

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
   * It carries the period it was measured for: an execution can outlive its month (the
   * first sweep already outlived its day), and a counter that did not notice would refuse
   * calls the new period allows.
   */
  periodSpent: number
  period: string
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

/**
 * Expiry order: the cell queried longest ago is the one whose content dies first, so it is
 * bought back first. Never-queried cells sort LAST — freshness before completeness (D30
 * rule 1) — and among those the shallow before the deep, the order the plan was written in.
 */
function byExpiry(a: CellRow, b: CellRow): number {
  if (a.queriedAt && b.queriedAt) return a.queriedAt.getTime() - b.queriedAt.getTime()
  if (a.queriedAt) return -1
  if (b.queriedAt) return 1
  return a.depth - b.depth || a.id.localeCompare(b.id)
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
      `HTTP 429 — Google refused on quota. Our ceiling of ${SWEEP.maxCallsPerPeriod} sits ` +
      `under both the daily cap and the ${FREE_MONTHLY_QUOTA} free monthly calls, so ` +
      'reaching this means the local count is short of what Google counted, or something ' +
      'else is spending on the same project. DO NOT RERUN before reading the billing ' +
      `console. Response: ${(await response.text()).slice(0, 300)}`,
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
 * Books one call against the quota period, and refuses when it is out. Called BEFORE the
 * request: a call we cannot account for is a call we must not make.
 *
 * A sweep runs for hours and can outlive its own period, so the period is re-read on every
 * cell rather than once at startup. Crossing into a new one resets the counter to zero:
 * nothing carries over, in either direction (D28). No query needed for that, since nothing
 * else can have queried a cell in a period we have only just entered.
 */
function spendOne(state: State, now: Date): void {
  const period = monthKey(now)
  if (period !== state.period) {
    state.period = period
    state.periodSpent = 0
  }

  if (callsLeft(state.periodSpent, SWEEP.maxCallsPerPeriod) <= 0) {
    throw new Error(
      `ceiling of ${SWEEP.maxCallsPerPeriod} calls reached for ${state.period} ` +
      `(SWEEP.maxCallsPerPeriod, under the ${FREE_MONTHLY_QUOTA} free ones) — ` +
      `${state.periodSpent} spent in that period, ${state.calls} of them by this ` +
      'execution. Stopping before any further spending. Resume once the period rolls ' +
      'over: the cells already queried are not replayed, and there is nothing to replan.',
    )
  }

  state.periodSpent++
  state.calls++
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

  // A cell re-queried in a later period can truncate again, and it already has the cells
  // that recover what it hid. Inserting a second set would multiply the plan on every
  // period, and for nothing: the split is read from the SIRENE registry, which has not
  // moved. So the measurement is written and the existing children stand.
  const [existing] = await db.select({ n: count() }).from(cell).where(eq(cell.parentId, c.id))
  if ((existing?.n ?? 0) > 0) {
    await db.update(cell).set({ ...measurement, status: 'truncated' }).where(eq(cell.id, c.id))
    console.log(`  truncation again (${reason}) -> ${existing.n} cell(s) already planned for it`)
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
 * through `measurement`, the error branch through the `failed` update — so the count needs
 * no ledger kept in step with reality.
 *
 * It under-reports in four ways, all of them losing a call that WAS billed: a throw in
 * `writePlaces`, in the measurement update or in the truncation transaction never reaches
 * the write; a kill between Google's response and that write does the same; a cell
 * requeried in a later execution overwrites its earlier `queried_at`; and deleting cell
 * rows erases their calls outright.
 *
 * Hence the floor below. `sweep_run` survives a cleanup of the cell table, so the calls of
 * runs opened inside the window cannot be erased by one. A floor only: a run opened in an
 * earlier period keeps adding to `calls_made` inside this one, and that part is not
 * attributable to the window from the logbook alone.
 */
async function spentIn(w: Window): Promise<number> {
  const [cells] = await db.select({ n: count() }).from(cell)
    .where(and(gte(cell.queriedAt, w.start), lt(cell.queriedAt, w.end)))
  const [runs] = await db.select({ n: sum(sweepRun.callsMade) }).from(sweepRun)
    .where(and(gte(sweepRun.startedAt, w.start), lt(sweepRun.startedAt, w.end)))
  return Math.max(cells?.n ?? 0, Number(runs?.n ?? 0))
}

// --- Summary --------------------------------------------------------------------------

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
  const asOfArgs = args.filter((a) => a.startsWith(AS_OF))
  if (asOfArgs.length > 1) {
    console.error(`${AS_OF}<ISO date> given ${asOfArgs.length} times: which period is meant?`)
    process.exit(1)
  }
  if (asOfArgs.length === 1 && asOfArgs[0] === AS_OF) {
    console.error(`${AS_OF} needs a date, e.g. ${AS_OF}2026-09-01T03:00:00Z`)
    process.exit(1)
  }
  const asOf = asOfArgs[0]?.slice(AS_OF.length)
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

  // A batch script must not come in through the transaction pooler: its pool holds exactly
  // one connection, and the advisory lock below reserves it — every query issued after that
  // waits for a connection that never frees, with no error and no timeout. The dry run is
  // refused too, because a check that only fires under `--go` is a check that fires while
  // spending.
  if (isTransactionPooler) {
    console.error(
      'REFUSING TO START: DATABASE_URL points at the transaction pooler (:6543), which ' +
      'hands out a single connection.\n' +
      'The sweep reserves one for its advisory lock, so the run would hang for ever — no ' +
      'error, no timeout, no call spent.\n' +
      'Use the session pooler: same host, port 5432.',
    )
    process.exit(1)
  }

  // 1. The plan. Every cell of it owes a call once per quota period, so a run whose cells
  // are all `done` is a run to replay — not a run with nothing left to do.
  const plannedRuns = await db.selectDistinct({ runId: cell.sweepRunId }).from(cell)

  if (plannedRuns.length === 0) {
    console.error(
      'No sweep plan to execute: not a single cell.\n' +
      'Run `plan:cells` first — the sweep does not invent its own grid.',
    )
    process.exit(1)
  }

  const ids = plannedRuns.map((r) => r.runId)
  const knownRuns = await db.select().from(sweepRun)
    .where(inArray(sweepRun.id, ids))
    .orderBy(desc(sweepRun.startedAt))

  if (knownRuns.length === 0 && ids.length > 1) {
    console.error(
      `${ids.length} pending sweep plans, none of them has a row in sweep_run: ` +
      'impossible to choose. Attach the stray cells to a run, or delete ONLY the ones ' +
      'whose queried_at is null — the queried ones are this period\'s spend ledger, and ' +
      'deleting them re-opens a ceiling that has already been paid for.',
    )
    process.exit(1)
  }
  const runId = knownRuns[0]?.id ?? ids[0]
  if (ids.length > 1) {
    console.warn(`! ${ids.length} plans in the database — only the most recent one (${runId}) is swept.`)
  }

  const cells = await db.select().from(cell).where(eq(cell.sweepRunId, runId))
  const planned = cells.filter((c) => !c.parentId).length

  // One plan, walked in the order its content expires. Not a refresh budget and a discovery
  // budget to split: the cells whose content dies first come first, and what the quota
  // leaves goes to the ones never queried (D30 rule 1).
  const periodWindow = monthWindow(now)
  const owedCells = cells.filter((c) => owesCall(c, periodWindow)).sort(byExpiry)
  const toRefresh = owedCells.filter((c) => c.queriedAt).length
  const toDiscover = owedCells.length - toRefresh

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
  const period = monthKey(now)
  const periodSpent = await spentIn(periodWindow)
  const headroom = callsLeft(periodSpent, SWEEP.maxCallsPerPeriod)
  // Still on screen because it is the logbook figure D22 was written from. It decides nothing.
  const runTotalToDate = knownRuns[0]?.callsMade ?? 0

  console.log('--- Sweep plan ---')
  console.log(`run                     : ${runId}`)
  console.log(`cells in the plan       : ${cells.length}  (${planned} at depth 0)`)
  console.log(`CALLS OWED FOR ${period}  : ${owedCells.length}`)
  console.log(`  content to buy back   : ${toRefresh}  (queried in an earlier period)`)
  console.log(`  never queried         : ${toDiscover}`)
  console.log('  + the cells a truncation adds, until convergence')
  console.log(`spent this period       : ${periodSpent} / ${SWEEP.maxCallsPerPeriod}  (${period})`)
  console.log(`THIS RUN CAN SPEND      : ${headroom}  before the ceiling stops it`)
  console.log(`run total to date       : ${runTotalToDate}  (logbook only, no longer the refusal)`)

  // The order is the rule, so it is printed rather than asserted: the head of the queue is
  // what a dry run is read for before a period is paid for.
  if (toRefresh > 0) {
    const head = owedCells.filter((c) => c.queriedAt).slice(0, 3)
    const tail = owedCells.filter((c) => c.queriedAt).slice(-1)
    const day = (c: CellRow) => c.queriedAt!.toISOString().slice(0, 10)
    console.log(`first to be bought back : ${head.map(day).join(', ')} … ${tail.map(day).join('')}`)
  }

  if (headroom === 0) {
    console.warn('! the ceiling for this period is already reached: nothing can be spent.')
  } else if (owedCells.length > headroom) {
    console.warn(
      `! ${owedCells.length} cells owed for ${headroom} call(s) left: the run will be cut ` +
      'short and what it does not reach stays old, counted, and said in the banner. ' +
      'Nothing to replan.',
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
  // Before the writes below, not after. Opening the run clears its recorded error and flips
  // its failed cells back to pending; doing that only to refuse the first call would erase
  // why the previous execution stopped.
  if (headroom === 0) {
    console.error(
      `\nREFUSING TO START: ${periodSpent} of ${SWEEP.maxCallsPerPeriod} calls already spent ` +
      `in ${period}. Nothing is left to spend before the period rolls over. The run is ` +
      'untouched and resumes then, with nothing to replan.',
    )
    process.exit(1)
  }

  // The ceiling is read once and spent against for hours. Without a lock, a local --go
  // overlapping the scheduled one reads the same figure twice and each spends the whole
  // remainder. The workflow's concurrency group guards CI against CI, and nothing guards
  // this. It is released explicitly on the way out — see `releaseLock`.
  const lock = await rawSql.reserve()
  const [{ acquired }] = await lock`SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS acquired`
  if (!acquired) {
    console.error(
      '\nREFUSING TO START: another sweep holds the lock on this database. Two sweeps ' +
      'reading the same remaining quota would each spend it in full.\n' +
      'If no sweep is running, the lock was leaked by one that was killed: through a pooler ' +
      'the backend stays parked still holding it. Find it with\n' +
      `  select pid from pg_locks where locktype = 'advisory' and objid = ${SWEEP_LOCK_KEY}\n` +
      'and terminate that backend. Ask from a session-pooler connection — through the ' +
      'transaction pooler the question can land on the holding backend and be granted ' +
      're-entrantly, which reads as free when it is not.',
    )
    await lock.release()
    process.exit(1)
  }
  heldLock = lock

  // Re-read UNDER the lock. The figure printed above was read before it, and closing the
  // read-then-spend race is the only reason the lock exists: a sweep that finished in that
  // interval would otherwise have its calls counted twice over.
  const lockedPeriodSpent = await spentIn(monthWindow(now))
  if (callsLeft(lockedPeriodSpent, SWEEP.maxCallsPerPeriod) <= 0) {
    console.error(
      `\nREFUSING TO START: ${lockedPeriodSpent} of ${SWEEP.maxCallsPerPeriod} calls were ` +
      `spent in ${period} while this execution was starting up. Nothing left to spend.`,
    )
    await releaseLock()
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
  const alreadyFresh = cells.length - owedCells.length
  if (alreadyFresh > 0) {
    console.log(`${alreadyFresh} cell(s) already queried in ${period}, not replayed.`)
  }

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
    periodSpent: lockedPeriodSpent,
    period,
    cellsQueried: 0,
    seen: new Set(),
    withHours: new Set(),
    withoutCommune: new Set(),
    sirenePoints: points as SirenePoint[],
  }

  console.log('\n--- Sweep running ---')
  let interruption: Error | null = null

  // What THIS execution has already paid for. A run can outlive its period, and the next
  // one owes every cell again — without this the queue would hand back cells the run has
  // just bought, for as long as it kept going.
  const queriedHere = new Set<string>()

  try {
    // Wave after wave: the cells a truncation adds are picked up on the next pass.
    for (;;) {
      const inPlan = await db.select().from(cell).where(eq(cell.sweepRunId, runId))
      const batch = inPlan
        .filter((c) => owesCall(c, periodWindow) && !queriedHere.has(c.id))
        .sort(byExpiry)
      if (batch.length === 0) break

      for (const c of batch) {
        // Sequential and never parallel: the call counter has to stay exact.
        queriedHere.add(c.id)
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
  // What the period still owes, refresh and discovery in one figure — the plan is one queue.
  const stillOwed = countOwed(finalCells, periodWindow)
  const neverQueried = finalCells.filter((c) => !c.queriedAt).length

  const reasons: string[] = []
  if (unresolved > 0) reasons.push(`${unresolved} unresolved truncation(s)`)
  if (irreducible > 0) reasons.push(`${irreducible} irreducible cell(s)`)
  if (failed > 0) reasons.push(`${failed} failed cell(s)`)
  if (stillOwed > 0) reasons.push(`${stillOwed} cell(s) still owed for ${period}`)
  if (interruption) reasons.push(`interrupted: ${interruption.message}`)

  // Cumulative across resumes: this is the counter we compare with the billing console.
  const [{ runTotal }] = await db.select({ runTotal: count() }).from(restaurant)
    .where(gte(restaurant.lastSeenAt, runStartedAt))
  const resumed = previousCalls > 0

  console.log('\n--- Sweep summary ---')
  console.log(`cells planned            : ${planned}`)
  console.log(`cells queried            : ${state.cellsQueried}`)
  console.log(`CALLS SPENT              : ${state.calls}  (owed at the start: ${owedCells.length})`)
  console.log(`spent this period        : ${state.periodSpent} / ${SWEEP.maxCallsPerPeriod}  (${state.period})`)
  if (resumed) {
    console.log(`  run total              : ${previousCalls + state.calls} calls, ` +
      `${previousCellsQueried + state.cellsQueried} cells queried`)
  }
  console.log(`truncations resolved     : ${resolved}`)
  console.log(`truncations UNRESOLVED   : ${unresolved}`)
  console.log(`irreducible cells        : ${irreducible}`)
  console.log(`failed cells             : ${failed}`)
  console.log(`cells STILL OWED         : ${stillOwed}  (${period})`)
  console.log(`  of them never queried  : ${neverQueried}`)
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

  await releaseLock()

  if (!succeeded) {
    console.error(`\nSWEEP FAILED — ${reasons.join(' ; ')}`)
    console.error('A silently incomplete database is worse than a script in error: ' +
      'resume this run (cells already done are not replayed) once the cause is handled.')
    process.exit(1)
  }

  console.log('\nSweep succeeded. Next in the pipeline: match:sirene then compute:profiles.')
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e)
  // The lock outlives the process through a pooler, so an unexpected throw has to give it
  // back too — otherwise one crash refuses every sweep that follows.
  await releaseLock()
  process.exit(1)
})
