import { describe, expect, it } from 'vitest'
import { CYCLE, RETRUNCATION_RATE_BY_DEPTH, SWEEP } from '@/lib/config'
import {
  buildCoverIndex, buildResolution, contains, convergedTree, emptyReplayDue, emptyReplays,
  freshShare, outOfReach, planPass, reachOf, selectCover, type PlanCell,
} from '@/lib/coverage'
import { METERS_PER_DEGREE_LAT } from '@/lib/grid'

type Status = PlanCell['status']

// Lyon, Place Bellecour. Offsets are laid in metres with the grid's own approximation, so a
// point placed "5 m inside" is 5 m inside by the distance the cover reads.
const ORIGIN = { lat: 45.7578, lng: 4.832 }
const point = (east: number, north: number) => ({
  lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  lng: ORIGIN.lng + east / (METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)),
})

const OCTOBER_01 = new Date('2026-10-01T16:00:00Z')
const NOVEMBER_01 = new Date('2026-11-01T09:30:00Z')
const NOVEMBER_16 = new Date('2026-11-16T09:00:00Z')
const DAY = 86_400_000

let ids = 0
function planCell(
  east: number, north: number, radius: number,
  over: Partial<PlanCell> = {},
): PlanCell {
  return {
    id: `c${String(ids++).padStart(3, '0')}`,
    parentId: null,
    depth: 0,
    status: 'done',
    googleCount: 5,
    lastResultDistance: null,
    queriedAt: OCTOBER_01,
    ...point(east, north),
    radius,
    ...over,
  }
}

const record = (east: number, north: number, hoursExpiresAt: Date | null = new Date(OCTOBER_01.getTime() + 30 * DAY)) => ({
  ...point(east, north), hoursExpiresAt,
})

const pass = { now: NOVEMBER_01, nextPass: NOVEMBER_16 }

describe('which cells a cover may draw from (D36 rule 1)', () => {
  // ─────────────────────────────────────────────────────────────
  // The call ranks its results by distance: what a cell returned is
  // exact up to its reach — its whole disk under 20 results, up to its
  // 20th result otherwise. Every queried cell is a candidate, up to it.
  // ─────────────────────────────────────────────────────────────
  const reach = (over: Partial<PlanCell>) => reachOf({
    status: 'done', googleCount: 5, radius: 120, lastResultDistance: 80, queriedAt: OCTOBER_01, ...over,
  })

  it('reads a complete cell up to its radius, a truncated one up to its 20th result', () => {
    expect(reach({ googleCount: 19 })).toBe(120)
    expect(reach({ status: 'truncated', googleCount: 20 })).toBe(80)
    expect(reach({ status: 'irreducible', googleCount: 20 })).toBe(80)
    // `done` with 20: the detector let it through, but nothing past the 20th is proven.
    expect(reach({ status: 'done', googleCount: 20 })).toBe(80)
  })

  it('reads nothing from a cell with no answer', () => {
    expect(reach({ status: 'pending', googleCount: null, queriedAt: null })).toBeNull()
    expect(reach({ status: 'failed' })).toBeNull()
  })

  it('counts a point on the edge, to the millimetre and no further', () => {
    // The points that set a radius sit exactly on the edge, and come back from the database
    // rounded: a strict test drops them.
    const c = { ...ORIGIN, radius: 100 }
    expect(contains(c, point(100, 0))).toBe(true)
    expect(contains(c, point(100.0005, 0))).toBe(true)
    expect(contains(c, point(100.01, 0))).toBe(false)
  })

  it('lets a truncated cell answer for what lies inside its 20th result, and nothing beyond', () => {
    const truncated = planCell(0, 0, 150, { status: 'truncated', googleCount: 20, lastResultDistance: 50 })
    const index = buildCoverIndex([truncated], [record(30, 0), record(100, 0)], [])
    expect(index.members[0]).toHaveLength(1)
    expect(outOfReach(index).records).toHaveLength(1)
  })

  it('leaves records without hours out: they have nothing to refresh', () => {
    const index = buildCoverIndex([planCell(0, 0, 60)], [record(0, 0), record(10, 0, null)], [])
    expect(index.items).toHaveLength(1)
    expect(index.hoursTotal).toBe(1)
  })
})

describe('the empty cells (D36 rule 4)', () => {
  it('takes a zero-result cell with no record inside out of the cover, and its SIRENE points too', () => {
    const empty = planCell(0, 0, 80, { googleCount: 0 })
    const index = buildCoverIndex([empty], [], [point(0, 0), point(20, 0)])
    expect(index.empty.map((c) => c.id)).toEqual([empty.id])
    expect(index.candidates).toHaveLength(0)
    expect(index.items).toHaveLength(0)
  })

  it('keeps a zero-result cell that once returned something: a record still sits inside it', () => {
    // Records are never deleted: the record is the second witness the schema keeps.
    const zero = planCell(0, 0, 80, { googleCount: 0 })
    const index = buildCoverIndex([zero], [record(0, 0)], [])
    expect(index.empty).toHaveLength(0)
    expect(index.candidates).toHaveLength(1)
  })

  it('owes a replay once a semester', () => {
    const now = new Date('2027-04-01T09:00:00Z')
    expect(emptyReplayDue({ queriedAt: new Date('2026-10-01T09:00:00Z') }, now)).toBe(true)
    expect(emptyReplayDue({ queriedAt: new Date('2026-12-01T09:00:00Z') }, now)).toBe(false)
  })

  it('replays them on the 16th only, oldest first, within the reserve (D38 rule 2)', () => {
    const now = new Date('2027-04-16T09:00:00Z')
    const owed = Array.from({ length: CYCLE.emptyReplayReserve + 5 }, (_, k) =>
      ({ id: `e${k}`, queriedAt: new Date(Date.UTC(2026, 9, 1 + k, 9)) }))
    const recent = { id: 'recent', queriedAt: new Date('2027-03-01T09:00:00Z') }
    const replayed = emptyReplays([recent, ...owed].reverse(), now, true)
    expect(replayed).toHaveLength(CYCLE.emptyReplayReserve)
    expect(replayed[0].id).toBe('e0')
    expect(replayed.map((c) => c.id)).not.toContain('recent')
    expect(emptyReplays(owed, now, false)).toEqual([])
  })
})

describe('what a pass serves first', () => {
  it('serves what has lapsed before what is due before the next pass', () => {
    // One call. Three records are due before the next pass, one has already lapsed: the lapsed
    // one goes first. Greedy by count alone would pick the three, every pass, and leave the
    // lapsed one dark for good.
    const lapsed = planCell(0, 0, 60)
    const crowded = planCell(1000, 0, 60)
    const index = buildCoverIndex([lapsed, crowded], [
      record(0, 0, new Date(NOVEMBER_01.getTime() - DAY)),
      record(1000, 0, new Date(NOVEMBER_16.getTime() - DAY)),
      record(1010, 0, new Date(NOVEMBER_16.getTime() - DAY)),
      record(1020, 0, new Date(NOVEMBER_16.getTime() - DAY)),
    ], [])
    const plan = selectCover(index, { ...pass, ceiling: 1, robust: false })
    expect(plan.picks.map((p) => p.cell.id)).toEqual([lapsed.id])
    expect(plan.urgent).toBe(1)
  })

  it('takes, inside a tier, the cell that answers for the most', () => {
    const one = planCell(0, 0, 60)
    const three = planCell(1000, 0, 60)
    const due = new Date(NOVEMBER_01.getTime() - DAY)
    const index = buildCoverIndex([one, three], [
      record(0, 0, due), record(1000, 0, due), record(1010, 0, due), record(1020, 0, due),
    ], [])
    const plan = selectCover(index, { ...pass, ceiling: 1, robust: false })
    expect(plan.picks.map((p) => p.cell.id)).toEqual([three.id])
  })

  it('breaks a tie on the record that expires first, then the shallower cell', () => {
    const due = (days: number) => new Date(NOVEMBER_01.getTime() - days * DAY)
    const later = planCell(0, 0, 60)
    const sooner = planCell(1000, 0, 60, { depth: 1 })
    const deep = planCell(2000, 0, 60, { depth: 2 })
    const shallow = planCell(3000, 0, 60, { depth: 1 })
    const index = buildCoverIndex([later, sooner, deep, shallow], [
      record(0, 0, due(1)), record(1000, 0, due(3)), record(2000, 0, due(2)), record(3000, 0, due(2)),
    ], [])
    const plan = selectCover(index, { ...pass, ceiling: 4, robust: false })
    expect(plan.picks.map((p) => p.cell.id)).toEqual([sooner.id, shallow.id, deep.id, later.id])
  })

  it('picks the same cells whatever order the database returns them in', () => {
    // D36 rule 2: without a total order, the dry run and the live one buy different cells.
    const cells = Array.from({ length: 12 }, (_, k) => planCell((k % 4) * 70, Math.floor(k / 4) * 70, 60))
    const records = Array.from({ length: 30 }, (_, k) => record((k * 37) % 250, (k * 53) % 180))
    const pick = (c: PlanCell[], r: typeof records) =>
      selectCover(buildCoverIndex(c, r, []), { ...pass, ceiling: 5, robust: false }).picks.map((p) => p.cell.id)
    expect(pick([...cells].reverse(), [...records].reverse())).toEqual(pick(cells, records))
  })

  it('does not pay a second cell for what a picked cell already refreshes', () => {
    // The overlap that broke the queried_at order (D36): parent and child hold the same record.
    const parent = planCell(0, 0, 120)
    const child = planCell(30, 0, 60, { depth: 1 })
    const due = new Date(NOVEMBER_01.getTime() - DAY)
    const index = buildCoverIndex([parent, child], [
      record(30, 0, due), record(-60, 0, due),
    ], [])
    const plan = selectCover(index, { ...pass, ceiling: 10, robust: false })
    expect(plan.picks.map((p) => p.cell.id)).toEqual([parent.id])
  })

  it('stops at the ceiling', () => {
    const due = new Date(NOVEMBER_01.getTime() - DAY)
    const cells = [0, 1, 2, 3].map((k) => planCell(k * 1000, 0, 60))
    const index = buildCoverIndex(cells, cells.map((_, k) => record(k * 1000, 0, due)), [])
    expect(selectCover(index, { ...pass, ceiling: 2, robust: false }).picks).toHaveLength(2)
  })
})

describe('robust, or known records (D36 rule 2)', () => {
  // ─────────────────────────────────────────────────────────────
  // The robust cover also contains every geocoded SIRENE point: that is
  // where restaurants open before Google has a page. When it costs the
  // freshness D38 aims for, the cover of known records replaces it.
  // ─────────────────────────────────────────────────────────────
  const sireneGround = planCell(0, 0, 60, { queriedAt: new Date('2026-09-01T09:00:00Z') })
  const restaurantGround = planCell(1000, 0, 60)
  const index = () => buildCoverIndex(
    [sireneGround, restaurantGround],
    [record(1000, 0, new Date(NOVEMBER_01.getTime() - DAY))],
    [point(0, 0), point(10, 0), point(-10, 0), point(0, 10), point(0, -10)],
  )

  it('lets the robust cover spend on SIRENE-only ground', () => {
    const plan = selectCover(index(), { ...pass, ceiling: 1, robust: true })
    expect(plan.picks.map((p) => p.cell.id)).toEqual([sireneGround.id])
    expect(plan.forecast).toBe(0)
  })

  it('falls back on the known records when the robust cover misses the target', () => {
    const plan = planPass(index(), { ...pass, ceiling: 1 })
    expect(plan.chosen).toBe(plan.known)
    expect(plan.chosen.picks.map((p) => p.cell.id)).toEqual([restaurantGround.id])
    expect(plan.chosen.forecast).toBe(1)
  })

  it('keeps the robust cover when it holds the target', () => {
    const plan = planPass(index(), { ...pass, ceiling: 2 })
    expect(plan.chosen).toBe(plan.robust)
    expect(plan.chosen.forecast).toBeGreaterThanOrEqual(CYCLE.freshnessTarget)
  })

  it('costs each cover whole, whatever this pass can spend', () => {
    const plan = planPass(index(), { ...pass, ceiling: 0 })
    expect(plan.robustCost).toBe(2)
    expect(plan.knownCost).toBe(1)
  })
})

describe('the freshness forecast (D39 rule 5)', () => {
  it('counts as refreshed what a picked cell reaches, and no further', () => {
    const truncated = planCell(0, 0, 150, { status: 'truncated', googleCount: 20, lastResultDistance: 50 })
    const index = buildCoverIndex([truncated], [
      record(0, 0, new Date(NOVEMBER_01.getTime() - DAY)),
      record(100, 0, new Date(NOVEMBER_01.getTime() - DAY)),
    ], [])
    expect(selectCover(index, { ...pass, ceiling: 1, robust: false }).forecast).toBe(0.5)
  })

  it('reads the worst hour at the next pass plus GitHub\'s worst delay', () => {
    const horizon = NOVEMBER_16.getTime() + CYCLE.maxScheduleDelayHours * 3_600_000
    const index = buildCoverIndex([], [
      record(0, 0, new Date(horizon + 60_000)),
      record(0, 0, new Date(horizon - 60_000)),
    ], [])
    expect(selectCover(index, { ...pass, ceiling: 0, robust: false }).forecast).toBe(0.5)
  })

  it('reads stored expiries against a horizon, ignoring records with no hours', () => {
    const horizon = new Date('2026-11-16T16:00:00Z')
    expect(freshShare([new Date('2026-12-01'), new Date('2026-11-10'), null], horizon)).toBe(0.5)
    expect(freshShare([], horizon)).toBe(1)
  })
})

describe('the converged tree (D37)', () => {
  it('grows the plan in place to about 3,100 cells at the measured re-truncation rates', () => {
    const tree = convergedTree(653, RETRUNCATION_RATE_BY_DEPTH, SWEEP.maxDepth)
    expect(tree.byDepth[0]).toBe(653)
    expect(tree.total).toBeGreaterThan(3_000)
    expect(tree.total).toBeLessThan(3_200)
  })
})

describe('a truncation left unresolved', () => {
  // ─────────────────────────────────────────────────────────────
  // Nothing ever moves a cell OUT of `truncated`: resolution is read
  // from its children, or the count could only ever grow.
  // ─────────────────────────────────────────────────────────────
  const cell = (id: string, status: Status, parentId: string | null = null) =>
    ({ id, parentId, status })

  it('leaves a truncated cell unresolved while it has no children', () => {
    const cells = [cell('a', 'truncated')]
    expect(buildResolution(cells)(cells[0])).toBe(false)
  })

  it('resolves a truncated cell once every child is resolved', () => {
    const cells = [
      cell('a', 'truncated'),
      cell('a1', 'done', 'a'), cell('a2', 'done', 'a'), cell('a3', 'irreducible', 'a'),
    ]
    expect(buildResolution(cells)(cells[0])).toBe(true)
  })

  it('leaves it unresolved while one child is still pending', () => {
    const cells = [
      cell('a', 'truncated'),
      cell('a1', 'done', 'a'), cell('a2', 'pending', 'a'),
    ]
    expect(buildResolution(cells)(cells[0])).toBe(false)
  })
})
