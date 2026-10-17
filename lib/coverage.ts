/**
 * What a pass refreshes, and what the plan still hides.
 *
 * Kept free of any database import, like `lib/quota`: these are the rules the sweep, the
 * monthly cycle, the simulation and the tests all have to agree on, and they have to be
 * unit-testable.
 *
 * See .specs/technique/13-rafraichissement-par-couverture.md
 */
import {
  CELLS_PER_TRUNCATION, CONTAINMENT_TOLERANCE_METERS, CYCLE, HOURS_TTL_DAYS, MAX_NEARBY_RESULTS,
} from './config'
import { distanceInMeters, METERS_PER_DEGREE_LAT, type Circle, type Point } from './grid'

type CellStatus = 'pending' | 'done' | 'truncated' | 'irreducible' | 'failed'

const HOUR_MS = 3_600_000
const TTL_MS = HOURS_TTL_DAYS * 24 * HOUR_MS

// --- Truncations nobody has resolved ----------------------------------------------------

/**
 * A truncated cell has been paid for and hid an unknown number of results behind the
 * 20-result cap; it is only resolved once the cells that recover what it hid are themselves
 * resolved. Nothing in the pipeline ever moves a cell OUT of `truncated`, so counting every
 * truncated cell as unresolved would be a rule that can never come true.
 *
 * `irreducible` counts as resolved. It means the sweep queried the cell, could not subdivide
 * further and said so loudly; there is no further call to make.
 */
export interface ResolvableCell {
  id: string
  parentId: string | null
  status: CellStatus
}

export function buildResolution<T extends ResolvableCell>(cells: T[]): (c: T) => boolean {
  const children = new Map<string, T[]>()
  for (const c of cells) {
    if (!c.parentId) continue
    const list = children.get(c.parentId) ?? []
    list.push(c)
    children.set(c.parentId, list)
  }
  const isResolved = (c: T): boolean => {
    if (c.status === 'done' || c.status === 'irreducible') return true
    if (c.status !== 'truncated') return false
    const kids = children.get(c.id) ?? []
    return kids.length > 0 && kids.every(isResolved)
  }
  return isResolved
}

// --- The cover --------------------------------------------------------------------------

export interface PlanCell extends Circle {
  id: string
  parentId: string | null
  depth: number
  status: CellStatus
  googleCount: number | null
  /** Distance of its farthest result: where a truncated cell's answer stops being exact. */
  lastResultDistance: number | null
  queriedAt: Date | null
}

/**
 * How far from its centre a queried cell's answer is exact — its reach (D36 rule 1).
 *
 * The call ranks its results by distance. A cell that returned fewer than 20 returned its
 * whole disk; one that returned 20 returned everything closer than its 20th, and nothing it
 * says past that can be trusted. Null for a cell with no answer to read: never queried, or
 * whose last call failed.
 */
export function reachOf(
  c: Pick<PlanCell, 'status' | 'googleCount' | 'radius' | 'lastResultDistance' | 'queriedAt'>,
): number | null {
  if (!c.queriedAt || c.googleCount === null) return null
  if (c.status === 'pending' || c.status === 'failed') return null
  return c.googleCount < MAX_NEARBY_RESULTS ? c.radius : c.lastResultDistance
}

export function contains(c: Circle, p: Point, tolerance = CONTAINMENT_TOLERANCE_METERS): boolean {
  return distanceInMeters(c, p) <= c.radius + tolerance
}

export interface KnownRecord extends Point {
  /** Null for a record with no hours: it has nothing to refresh, and the cover leaves it. */
  hoursExpiresAt: Date | null
  name?: string
}

/** What the cover has to contain: a record with hours, or a geocoded SIRENE point. */
export interface CoverItem extends Point {
  kind: 'record' | 'sirene'
  /** A record's name, for the report that names what no reach contains. */
  name?: string
  /**
   * When its content stops being usable, in ms: a record's hours on their own date, a SIRENE
   * point 30 days after the last call whose reach contained it. Null when none ever has.
   *
   * Mutable: the simulation moves it as passes refresh the item.
   */
  due: number | null
}

export interface CoverIndex<C extends PlanCell> {
  /**
   * Queried cells with a reach, empty cells aside: what a cover is drawn from. In the order
   * that settles a tie — shallower, then queried earlier, then by id.
   */
  candidates: C[]
  /** Zero results and no record ever seen inside: out of the cover, replayed once a semester. */
  empty: C[]
  /** Records first, each kind by position: an order that does not depend on the database's. */
  items: CoverItem[]
  /** Per candidate, the items inside its reach: what its call answers for, and refreshes. */
  members: number[][]
  /** Per item, the candidates whose reach contains it. Empty: out of every reach. */
  holders: number[][]
  /** Records with hours, inside a reach or not: the forecast's denominator. */
  hoursTotal: number
}

/** Points sorted by latitude, so a circle only scans its own band. */
function byLatitude<T extends Point>(points: T[]): { sorted: T[]; order: number[] } {
  const order = points.map((_, i) => i).sort((a, b) => points[a].lat - points[b].lat)
  return { sorted: order.map((i) => points[i]), order }
}

function lowerBound(sorted: Point[], lat: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].lat < lat) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Indexes, in `points`, of the points inside `c`. */
function within(band: { sorted: Point[]; order: number[] }, c: Circle): number[] {
  const dLat = (c.radius + CONTAINMENT_TOLERANCE_METERS) / METERS_PER_DEGREE_LAT
  const found: number[] = []
  for (let k = lowerBound(band.sorted, c.lat - dLat); k < band.sorted.length; k++) {
    const p = band.sorted[k]
    if (p.lat > c.lat + dLat) break
    if (contains(c, p)) found.push(band.order[k])
  }
  return found
}

const byPosition = (a: Point, b: Point) => a.lat - b.lat || a.lng - b.lng

/**
 * Everything a pass needs to draw a cover, read from the plan's geometry and the positions
 * of what it has to contain. Nothing here is stored: it is recomputed on every pass, on the
 * latest results (D36).
 *
 * An EMPTY cell returned zero results and contains no record ever seen. Records are never
 * deleted, so any call that ever returned something inside this circle — by this cell or by
 * an overlapping one — left one there. On 2026-10-17 that gives 97.
 */
export function buildCoverIndex<C extends PlanCell>(
  cells: C[], records: KnownRecord[], sirene: Point[],
): CoverIndex<C> {
  const recordBand = byLatitude(records)
  const reached = cells
    .map((c) => ({ c, reach: reachOf(c) }))
    .filter((x): x is { c: C; reach: number } => x.reach !== null)
    .sort((a, b) => a.c.depth - b.c.depth
      || (a.c.queriedAt!.getTime() - b.c.queriedAt!.getTime())
      || a.c.id.localeCompare(b.c.id))
  const isEmpty = ({ c }: { c: C }) =>
    c.status === 'done' && c.googleCount === 0 && within(recordBand, c).length === 0
  const empty = reached.filter(isEmpty).map((x) => x.c)
  const kept = reached.filter((x) => !isEmpty(x))

  // A SIRENE point inside an empty cell no longer counts in the robust constraint: the cell
  // has said there is nothing there, and says it again once a semester.
  const sireneBand = byLatitude(sirene)
  const silenced = new Set(empty.flatMap((c) => within(sireneBand, c)))

  const items: CoverItem[] = [
    ...records.filter((r) => r.hoursExpiresAt !== null).sort(byPosition)
      .map((r): CoverItem => ({
        lat: r.lat, lng: r.lng, kind: 'record', name: r.name, due: r.hoursExpiresAt!.getTime(),
      })),
    ...sirene.filter((_, i) => !silenced.has(i)).sort(byPosition)
      .map((p): CoverItem => ({ lat: p.lat, lng: p.lng, kind: 'sirene', due: null })),
  ]

  const itemBand = byLatitude(items)
  const members = kept.map(({ c, reach }) => within(itemBand, { lat: c.lat, lng: c.lng, radius: reach }))
  const holders: number[][] = items.map(() => [])
  members.forEach((list, ci) => { for (const i of list) holders[i].push(ci) })

  const candidates = kept.map((x) => x.c)
  items.forEach((item, i) => {
    if (item.kind !== 'sirene') return
    const last = Math.max(0, ...holders[i].map((ci) => candidates[ci].queriedAt!.getTime()))
    item.due = last ? last + TTL_MS : null
  })

  return {
    candidates,
    empty,
    items,
    members,
    holders,
    hoursTotal: items.filter((i) => i.kind === 'record').length,
  }
}

/**
 * 0: due before this pass is safely over — already lapsed, or lapsing within the margin.
 * 1: due before the next pass plus the margin (D38 rule 3).
 * 2: the rest, in order of due date.
 */
export type Tier = 0 | 1 | 2

export interface CoverPick<C> {
  cell: C
  /** Its position in the index's candidates. */
  slot: number
  tier: Tier
}

export interface CoverPlan<C> {
  robust: boolean
  /** Cells to query, in order, within the ceiling. */
  picks: CoverPick<C>[]
  /** Picks serving content due before the next pass plus the margin: reported, the rest is ahead of time. */
  urgent: number
  /**
   * Share of the records with hours still usable at the worst hour before the next pass, GitHub's
   * delay included (D39 rule 3). Read on the picks' expected reach, without a margin: with the
   * 10 m one it read about seven points under the real worst hour.
   */
  forecast: number
}

export interface PassContext {
  now: Date
  /** When the next pass is scheduled — its start, before GitHub's delay. */
  nextPass: Date
  /** Calls this pass may spend on the cover. */
  ceiling: number
}

/**
 * Greedy, by due date: each step takes the cell that adds the most content not yet answered
 * for, inside the most urgent tier still open (D38 rule 3). The last tier goes item by item in
 * order of due date, each to its best cell.
 *
 * Tier 0 exists because, under two passes a month, everything is due before the next pass plus
 * twelve hours at every pass: what the previous pass refreshed expires 30 days later, right
 * around the next one. Greedy by count over that whole set picks the same dense cells every
 * pass and never reaches what lapsed because the previous pass ran out — measured, it starves
 * those cells for good. So what has lapsed, or is about to, goes first.
 *
 * The order is total (D36 rule 2): 97% of the choices are ties, and without it the dry run and
 * the live one would not buy the same cells. At equal gain, the cell one of whose added records
 * expires first; then the candidates' own order — shallower, queried earlier, id.
 */
export function selectCover<C extends PlanCell>(
  index: CoverIndex<C>, context: PassContext & { robust: boolean; untiered?: boolean },
): CoverPlan<C> {
  const { items, candidates, members, holders } = index
  const soon = context.now.getTime() + CYCLE.urgentMarginHours * HOUR_MS
  const beforeNext = context.nextPass.getTime() + CYCLE.urgentMarginHours * HOUR_MS
  const tierOf = (item: CoverItem): Tier =>
    context.untiered || item.due === null || item.due < soon ? 0 : item.due < beforeNext ? 1 : 2

  const covered = new Uint8Array(items.length)
  const used = new Uint8Array(candidates.length)
  const picks: CoverPick<C>[] = []
  const wanted = (i: number) => holders[i].length > 0 && (context.robust || items[i].kind === 'record')

  for (const tier of [0, 1, 2] as const) {
    const active = (i: number) => !covered[i] && wanted(i) && tierOf(items[i]) <= tier
    const count = new Int32Array(candidates.length)
    members.forEach((list, ci) => { for (const i of list) if (active(i)) count[ci]++ })
    // The earliest due among the records a cell would add, read lazily: only ties need it.
    const firstDue = new Float64Array(candidates.length).fill(Number.NaN)
    const addedDue = (ci: number) => {
      if (Number.isNaN(firstDue[ci])) {
        let first = Number.POSITIVE_INFINITY
        for (const i of members[ci]) {
          if (active(i) && items[i].kind === 'record' && items[i].due! < first) first = items[i].due!
        }
        firstDue[ci] = first
      }
      return firstDue[ci]
    }
    const better = (ci: number, best: number) => best < 0
      || count[ci] > count[best]
      || (count[ci] === count[best] && addedDue(ci) < addedDue(best))

    while (picks.length < context.ceiling) {
      let best = -1
      if (tier < 2) {
        for (let ci = 0; ci < candidates.length; ci++) {
          if (!used[ci] && count[ci] > 0 && better(ci, best)) best = ci
        }
      } else {
        let first = -1
        for (let i = 0; i < items.length; i++) {
          if (active(i) && (first < 0 || (items[i].due ?? 0) < (items[first].due ?? 0))) first = i
        }
        if (first >= 0) for (const ci of holders[first]) if (!used[ci] && better(ci, best)) best = ci
      }
      if (best < 0) break
      used[best] = 1
      picks.push({ cell: candidates[best], slot: best, tier })
      // Everything inside the cell's reach is refreshed by its call, whatever tier it sits in:
      // a later tier must not pay a second cell for it.
      for (const i of members[best]) {
        if (active(i)) {
          for (const cj of holders[i]) {
            count[cj]--
            firstDue[cj] = Number.NaN
          }
        }
        covered[i] = 1
      }
    }
  }

  const horizon = forecastHorizon(context.nextPass).getTime()
  let fresh = 0
  items.forEach((item, i) => {
    if (item.kind === 'record' && (covered[i] || item.due! > horizon)) fresh++
  })

  return {
    robust: context.robust,
    picks,
    urgent: picks.filter((p) => p.tier < 2).length,
    forecast: index.hoursTotal === 0 ? 1 : fresh / index.hoursTotal,
  }
}

/** The worst hour before the next pass: its scheduled start plus GitHub's worst delay. */
export function forecastHorizon(nextPass: Date): Date {
  return new Date(nextPass.getTime() + CYCLE.maxScheduleDelayHours * HOUR_MS)
}

/**
 * Share of the records with hours still usable at `horizon`, read on their stored expiry:
 * the forecast once a pass is over, when what it refreshed is in the database (D39 rule 3).
 *
 * A record with hours is one with an expiry date, not one whose hours are still stored: the
 * purge empties those at their expiry (D45), and a denominator that shrank with it would
 * read a dying base as a fresh one.
 */
export function freshShare(expiries: (Date | null)[], horizon: Date): number {
  const dated = expiries.filter((e): e is Date => e !== null)
  return dated.length === 0 ? 1 : dated.filter((e) => e > horizon).length / dated.length
}

export interface PassPlan<C> {
  /** The cover this pass serves. */
  chosen: CoverPlan<C>
  robust: CoverPlan<C>
  known: CoverPlan<C>
  /**
   * What each cover costs whole: plain greedy, uncapped, every item in one tier. The cost of
   * one refresh of everything — the figure D37 decides on.
   */
  robustCost: number
  knownCost: number
}

/**
 * The robust cover while its forecast keeps D38's target; the cover of known records
 * otherwise, without a new discussion (D36 rule 3).
 *
 * Decided per pass, on the pass's own forecast, because that is what "fits the budget"
 * means: the budget is what keeps the worst hour, and the worst hour is what the forecast
 * reads.
 */
export function planPass<C extends PlanCell>(index: CoverIndex<C>, context: PassContext): PassPlan<C> {
  const robust = selectCover(index, { ...context, robust: true })
  const known = selectCover(index, { ...context, robust: false })
  const whole = { ...context, ceiling: Number.POSITIVE_INFINITY, untiered: true }
  return {
    chosen: robust.forecast >= CYCLE.freshnessTarget ? robust : known,
    robust,
    known,
    robustCost: selectCover(index, { ...whole, robust: true }).picks.length,
    knownCost: selectCover(index, { ...whole, robust: false }).picks.length,
  }
}

/** What no reach contains, named on every pass (D36): no cover can refresh it. */
export function outOfReach<C extends PlanCell>(index: CoverIndex<C>): { records: CoverItem[]; sirene: number } {
  const records = index.items.filter((item, i) => item.kind === 'record' && index.holders[i].length === 0)
  const sirene = index.items.filter((item, i) => item.kind === 'sirene' && index.holders[i].length === 0).length
  return { records, sirene }
}

/** An empty cell owes its semestrial replay. */
export function emptyReplayDue(c: Pick<PlanCell, 'queriedAt'>, now: Date): boolean {
  return !c.queriedAt || now.getTime() - c.queriedAt.getTime() >= CYCLE.emptyReplayDays * 24 * HOUR_MS
}

/**
 * The empty cells a pass replays (D38 rule 2): those owed their semestrial replay, oldest
 * first, within the share the 16th's pass sets aside before any content. The 1st's pass
 * replays none — the cover takes its whole ceiling.
 */
export function emptyReplays<C extends Pick<PlanCell, 'queriedAt'>>(empty: C[], now: Date, secondPass: boolean): C[] {
  if (!secondPass) return []
  return empty.filter((c) => emptyReplayDue(c, now))
    .sort((a, b) => (a.queriedAt?.getTime() ?? 0) - (b.queriedAt?.getTime() ?? 0))
    .slice(0, CYCLE.emptyReplayReserve)
}

/**
 * Cells the plan converges to, depth by depth, at the measured re-truncation rates (D37).
 *
 * Not a monthly bill — under the cover, the tree is a discovery backlog. It is what the
 * one-level floor used to pass for.
 */
export function convergedTree(
  depth0: number, rates: readonly number[], maxDepth: number,
): { byDepth: number[]; total: number } {
  const byDepth = [depth0]
  for (let d = 0; d < maxDepth; d++) {
    const rate = rates[Math.min(d, rates.length - 1)]
    byDepth.push(byDepth[d] * rate * CELLS_PER_TRUNCATION)
  }
  const total = Math.round(byDepth.reduce((a, b) => a + b, 0))
  return { byDepth: byDepth.map(Math.round), total }
}
