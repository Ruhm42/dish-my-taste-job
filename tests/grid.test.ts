import { describe, expect, it } from 'vitest'
import {
  distanceInMeters, hilbertIndex, planCells, planRecovery, pointsInCircle, subdivide,
} from '@/lib/grid'
import type { Cell, Circle, Point } from '@/lib/grid'
import { GRID } from '@/lib/config'

const OPTIONS = { target: 15, maxRadius: 200, minRadius: 40 }

/** Central Lyon: the tests must run at the latitude where the grid is actually used. */
const BASE: Point = { lat: 45.76, lng: 4.835 }
const METERS_PER_DEGREE_LAT = 111_100
const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos((BASE.lat * Math.PI) / 180)

/** Point (dx, dy) meters from an origin — more readable than degrees. */
function offset(origin: Point, dxMeters: number, dyMeters: number): Point {
  return {
    lat: origin.lat + dyMeters / METERS_PER_DEGREE_LAT,
    lng: origin.lng + dxMeters / METERS_PER_DEGREE_LNG,
  }
}

/** Deterministic pseudo-random: a failing test must fail again identically. */
function random(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

function cloud(n: number, side: number, seed: number, origin: Point = BASE): Point[] {
  const rnd = random(seed)
  return Array.from({ length: n }, () =>
    offset(origin, (rnd() - 0.5) * side, (rnd() - 0.5) * side),
  )
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]

/**
 * Cell a point belongs to: the nearest one among those covering it. The plan does
 * not return memberships — this is a reconstruction for the tests, not a truth of
 * the algorithm.
 */
function cellOf(point: Point, cells: Cell[]): number {
  let best = -1
  let bestDistance = Infinity
  cells.forEach((c, i) => {
    const d = distanceInMeters(c, point)
    if (d <= c.radius + 1e-6 && d < bestDistance) {
      bestDistance = d
      best = i
    }
  })
  return best
}

// ─────────────────────────────────────────────────────────────
// The curve itself. This is the piece that breaks silently:
// a wrong quadrant rotation yields a plausible but scattered ordering.
// ─────────────────────────────────────────────────────────────
describe('Hilbert curve', () => {
  it('numbers every square of a grid once and only once', () => {
    const n = 16
    const seen = new Set<number>()
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) seen.add(hilbertIndex(x, y, n))
    }
    expect(seen.size).toBe(n * n)
    expect(Math.min(...seen)).toBe(0)
    expect(Math.max(...seen)).toBe(n * n - 1)
  })

  it('places two consecutive indices on two adjacent squares', () => {
    const n = 16
    const byIndex: Point[] = []
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) byIndex[hilbertIndex(x, y, n)] = { lat: y, lng: x }
    }
    for (let d = 1; d < n * n; d++) {
      const step = Math.abs(byIndex[d].lng - byIndex[d - 1].lng) +
        Math.abs(byIndex[d].lat - byIndex[d - 1].lat)
      expect(step).toBe(1)
    }
  })

  it('spans the whole projection grid without losing precision', () => {
    // 2^32 - 1: beyond the 32-bit integers of JavaScript's bitwise operators.
    expect(hilbertIndex(0, 0)).toBe(0)
    expect(hilbertIndex(65_535, 0)).toBe(4_294_967_295)
    expect(Number.isSafeInteger(hilbertIndex(65_535, 0))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// The two constraints. Exceeding the radius means a silent Google truncation;
// exceeding the count means a lying truncation detector.
// ─────────────────────────────────────────────────────────────
describe('plan constraints', () => {
  const points = [
    ...cloud(400, 300, 1), // dense core: the point count closes the cells
    ...cloud(150, 3000, 2), // sparse outskirts: the radius closes the cells
  ]
  const cells = planCells(points, OPTIONS)

  it('never exceeds the target number of points per cell', () => {
    expect(cells.every((c) => c.sireneCount <= OPTIONS.target)).toBe(true)
  })

  it('never exceeds the maximum radius', () => {
    expect(cells.every((c) => c.radius <= OPTIONS.maxRadius)).toBe(true)
  })

  it('never emits a circle smaller than the radius floor', () => {
    expect(cells.every((c) => c.radius >= OPTIONS.minRadius)).toBe(true)
  })

  it('never emits an empty cell', () => {
    expect(cells.every((c) => c.sireneCount >= 1)).toBe(true)
  })

  it('neither loses nor duplicates any point', () => {
    const total = cells.reduce((s, c) => s + c.sireneCount, 0)
    expect(total).toBe(points.length)
  })

  it('actually covers every point with at least one circle', () => {
    // The project's real risk: an establishment outside every circle is never
    // queried, and its absence shows up nowhere.
    expect(points.every((p) => cellOf(p, cells) !== -1)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// Compactness: this is the whole point of Hilbert over a quadtree.
// ─────────────────────────────────────────────────────────────
describe('compactness', () => {
  it('does not mix clusters that are far apart', () => {
    // 12 clusters of 10 points 1.2 km apart, each sitting comfortably under both
    // constraints: the plan must stay close to 12 cells.
    const clusters = Array.from({ length: 12 }, (_, i) =>
      offset(BASE, (i % 4) * 1200, Math.floor(i / 4) * 1200),
    )
    const points = clusters.flatMap((center) => cloud(10, 60, 7 + center.lat * 1e6, center))
    const cells = planCells(points, OPTIONS)

    // No cell can hold two clusters: its radius would then be hundreds of meters.
    // That is the direct proof they were not merged.
    expect(cells.every((c) => c.radius < 100)).toBe(true)
    // A cluster straddling a quadrant boundary of the curve ends up cut into two
    // cells — a known and accepted limit: it costs one call, where a quadtree
    // spent more than twice as many.
    expect(cells.length).toBeGreaterThanOrEqual(12)
    expect(cells.length).toBeLessThanOrEqual(16)
  })

  it('puts two neighbouring points in the same cell, in the vast majority of cases', () => {
    const points = cloud(500, 800, 11)
    const cells = planCells(points, OPTIONS)
    const membership = points.map((p) => cellOf(p, cells))

    let together = 0
    points.forEach((p, i) => {
      let neighbour = -1
      let best = Infinity
      points.forEach((q, j) => {
        if (i === j) return
        const d = distanceInMeters(p, q)
        if (d < best) {
          best = d
          neighbour = j
        }
      })
      if (membership[i] === membership[neighbour]) together++
    })

    // Measured around 0.86 across several seeds; a random assignment would give
    // 1/34. The threshold targets the locality property, not the exact value this
    // implementation happens to return.
    expect(together / points.length).toBeGreaterThan(0.75)
  })
})

// ─────────────────────────────────────────────────────────────
// What measurement established: it is the radius that closes the cells.
// ─────────────────────────────────────────────────────────────
describe('constraint hierarchy', () => {
  it('lets the radius close the cells in a sparse area', () => {
    // 300 points over 2 km × 2 km: 15 of them span far more than 200 m, so cells
    // close below the target, not on it.
    const cells = planCells(cloud(300, 2000, 23), OPTIONS)
    expect(median(cells.map((c) => c.sireneCount))).toBeLessThan(OPTIONS.target)
    expect(Math.max(...cells.map((c) => c.radius))).toBeLessThanOrEqual(OPTIONS.maxRadius)
  })

  it('lets the point count close the cells in a dense area', () => {
    // 400 points over 200 m × 200 m: the radius is never reached.
    const cells = planCells(cloud(400, 200, 29), OPTIONS)
    expect(median(cells.map((c) => c.sireneCount))).toBe(OPTIONS.target)
  })
})

// ─────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────
describe('edge cases', () => {
  it('plans no call at all on an empty cloud', () => {
    expect(planCells([], OPTIONS)).toEqual([])
  })

  it('applies the radius floor to an isolated point', () => {
    const cells = planCells([BASE], OPTIONS)
    expect(cells).toHaveLength(1)
    expect(cells[0].radius).toBe(OPTIONS.minRadius)
    expect(cells[0].lat).toBeCloseTo(BASE.lat, 9)
    expect(cells[0].lng).toBeCloseTo(BASE.lng, 9)
  })

  it('splits a pile of strictly superimposed points by point count', () => {
    const cells = planCells(Array(40).fill(BASE), OPTIONS)
    expect(cells.map((c) => c.sireneCount)).toEqual([15, 15, 10])
    expect(cells.every((c) => c.radius === OPTIONS.minRadius)).toBe(true)
  })

  it('handles a fully collinear cloud without dividing by zero', () => {
    const points = Array.from({ length: 30 }, (_, i) => offset(BASE, i * 50, 0))
    const cells = planCells(points, OPTIONS)
    expect(cells.reduce((s, c) => s + c.sireneCount, 0)).toBe(30)
    expect(cells.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(true)
  })

  it('rejects an ungeocoded point loudly rather than missing the area', () => {
    expect(() => planCells([BASE, { lat: NaN, lng: 4.8 }], OPTIONS)).toThrow(/geocod/)
  })

  it('rejects an inconsistent grid configuration', () => {
    expect(() => planCells([BASE], { ...OPTIONS, target: 0 })).toThrow(/target/)
    expect(() => planCells([BASE], { ...OPTIONS, maxRadius: 0 })).toThrow(/maxRadius/)
    expect(() => planCells([BASE], { ...OPTIONS, minRadius: 500 })).toThrow(/minRadius/)
  })

  it('accepts the project configuration as it stands', () => {
    const cells = planCells(cloud(100, 500, 31), GRID)
    expect(cells.every((c) => c.sireneCount <= GRID.target)).toBe(true)
    expect(cells.every((c) => c.radius <= GRID.maxRadius)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// Resolving a truncation — D30 rule 2
//
// The parent queried its WHOLE disk and was cut off at 20, so
// its children must cover the whole disk: a density plan laid
// only around SIRENE clusters left 17.4% of it unqueried on the
// real truncations, and the sweep reported nothing unresolved.
//
// Covered, the density plan is almost never cheaper than the
// quarters — the saving rule 2 measured was the uncovered ground.
// It is kept only where it covers the disk in fewer calls.
//
// The ceiling is read on the planner's ASSIGNMENT, the scale the
// 1.57 ratio was measured against. What a circle CONTAINS is a
// different, much larger number: BAN geocodes co-located
// establishments onto one coordinate, and no radius separates
// points that share it.
// ─────────────────────────────────────────────────────────────
describe('resolving a truncation', () => {
  const RECOVERY = { target: GRID.target, minRadius: GRID.minRadius }

  /**
   * Points of the parent's disk that no child covers. Sampled independently of the planner's
   * own lattice — an odd step, plus the boundary — so the test does not share its blind spots.
   * The centimetre of tolerance is the equirectangular approximation: the quarters touch the
   * parent's edge at four points, and `distanceInMeters` projects each pair at its own mean
   * latitude, which moves those contacts by a millimetre.
   */
  function uncovered(parent: Circle, cells: Circle[]): Point[] {
    const missed: Point[] = []
    const probe = (dx: number, dy: number) => {
      const p = offset(parent, dx, dy)
      if (!cells.some((c) => distanceInMeters(c, p) <= c.radius + 0.01)) missed.push(p)
    }
    const steps = 53
    for (let i = -steps; i <= steps; i++) {
      for (let j = -steps; j <= steps; j++) {
        if (i * i + j * j <= steps * steps) probe((i * parent.radius) / steps, (j * parent.radius) / steps)
      }
    }
    for (let k = 0; k < 720; k++) {
      const a = (k * Math.PI) / 360
      probe(parent.radius * Math.cos(a), parent.radius * Math.sin(a))
    }
    return missed
  }

  function duplicatePairs(cells: Circle[]): number {
    let pairs = 0
    cells.forEach((a, i) => cells.slice(0, i).forEach((b) => {
      if (Math.abs(a.radius - b.radius) <= 1 && distanceInMeters(a, b) <= 1) pairs++
    }))
    return pairs
  }

  /** A truncated cell: 30 establishments around a 260 m square, ~22 of them inside it. */
  const dense = cloud(30, 260, 41)
  const parent: Circle = { lat: BASE.lat, lng: BASE.lng, radius: 150 }
  const inside = pointsInCircle(dense, parent.lat, parent.lng, parent.radius)

  /** Tight clump of `n` establishments around one point, the way a street corner geocodes. */
  const clump = (n: number, center: Point, seed: number) => cloud(n, 6, seed, center)

  /**
   * A parent already at the radius floor, which is where the density survives on real data:
   * two clusters of 12 low in the disk, and nothing in its upper part.
   */
  const floorParent: Circle = { ...BASE, radius: GRID.minRadius }
  const twoClusters = [
    ...clump(12, offset(BASE, -20, -10), 51),
    ...clump(12, offset(BASE, 20, -10), 52),
  ]

  it('covers the whole disk when every point sits in one quadrant', () => {
    const quadrant = cloud(30, 60, 45, offset(BASE, 75, 75))
    const { cells } = planRecovery(parent, quadrant, RECOVERY)
    expect(uncovered(parent, cells)).toEqual([])
  })

  it('covers the whole disk under a stack of establishments on one coordinate', () => {
    const stack: Point[] = Array(35).fill(offset(BASE, 30, 20))
    const { cells } = planRecovery(parent, stack, RECOVERY)
    expect(uncovered(parent, cells)).toEqual([])
    expect(duplicatePairs(cells)).toBe(0)
  })

  it('covers the whole disk of a cell the registry knows nothing about', () => {
    const { cells, fromDensity } = planRecovery(parent, [], RECOVERY)
    expect(fromDensity).toBe(false)
    expect(cells).toHaveLength(4)
    expect(uncovered(parent, cells)).toEqual([])
  })

  it('covers the whole disk when it keeps the density plan, filling the ground it leaves bare', () => {
    const { cells, fromDensity } = planRecovery(floorParent, twoClusters, RECOVERY)
    expect(fromDensity).toBe(true)
    // Two cells around the clusters, one over the empty top: the clusters alone leave it bare.
    expect(cells).toHaveLength(3)
    expect(uncovered(floorParent, cells.slice(0, 2)).length).toBeGreaterThan(0)
    expect(uncovered(floorParent, cells)).toEqual([])
  })

  it('pays for a co-located stack once, not once per batch of the planner', () => {
    // 36 on one coordinate: the planner returns the same circle three times.
    const stacked = [...Array(36).fill(offset(BASE, -20, -10)), ...clump(12, offset(BASE, 20, -10), 53)]
    const { cells, fromDensity } = planRecovery(floorParent, stacked, RECOVERY)
    expect(fromDensity).toBe(true)
    expect(duplicatePairs(cells)).toBe(0)
    expect(uncovered(floorParent, cells)).toEqual([])
  })

  it('never lays down the parent again', () => {
    // Everything on the parent's own centre, at the floor: the density plan is the parent.
    const { cells } = planRecovery(floorParent, Array(30).fill(BASE), RECOVERY)
    expect(cells.some((c) => distanceInMeters(c, floorParent) <= 1 && c.radius === floorParent.radius))
      .toBe(false)
  })

  it('keeps the density plan only where it covers the disk in fewer calls than the quarters', () => {
    const { cells } = planRecovery(floorParent, twoClusters, RECOVERY)
    expect(cells.length).toBeLessThan(subdivide(floorParent, GRID.minRadius).length)
  })

  it('takes the quarters when covering the disk from the density would cost more', () => {
    // Circles drawn around clusters cover a disk badly: this cell's density plan leaves
    // ground bare, and filling it takes more calls than the four quarters.
    const { cells, fromDensity } = planRecovery(parent, dense, RECOVERY)
    expect(fromDensity).toBe(false)
    expect(cells).toEqual(subdivide(parent, GRID.minRadius))
  })

  it('holds its invariants on any cloud: whole disk, no duplicate, never dearer than the quarters', () => {
    const rnd = random(61)
    for (let k = 0; k < 40; k++) {
      const p: Circle = { ...offset(BASE, (rnd() - 0.5) * 400, (rnd() - 0.5) * 400), radius: 40 + rnd() * 160 }
      const points = [
        ...cloud(Math.floor(rnd() * 60), 2 * p.radius, 100 + k, p),
        ...clump(Math.floor(rnd() * 40), offset(p, (rnd() - 0.5) * p.radius, (rnd() - 0.5) * p.radius), 200 + k),
      ]
      const { cells } = planRecovery(p, points, RECOVERY)
      expect(uncovered(p, cells)).toEqual([])
      expect(duplicatePairs(cells)).toBe(0)
      expect(cells.length).toBeLessThanOrEqual(4)
      expect(cells.every((c) => c.radius <= p.radius)).toBe(true)
    }
  })

  it('splits the cell into at least as many cells as the ceiling requires', () => {
    // Under the ceiling by construction: the planner assigns at most `target` per cell.
    const { cells } = planRecovery(parent, dense, RECOVERY)
    expect(cells.length).toBeGreaterThanOrEqual(Math.ceil(inside.length / GRID.target))
  })

  it('never lays down a cell wider than the one that truncated', () => {
    // A wider child would query the very places that truncated its parent.
    for (const [p, points] of [[parent, dense], [floorParent, twoClusters]] as const) {
      const { cells } = planRecovery(p, points, RECOVERY)
      expect(cells.every((c) => c.radius <= p.radius)).toBe(true)
    }
  })

  it('loses no point of the cell it replans', () => {
    const { cells } = planRecovery(parent, dense, RECOVERY)
    for (const p of inside) {
      expect(cells.some((c) => distanceInMeters(c, p) <= c.radius)).toBe(true)
    }
  })

  it('falls back on the quarters when the density has nothing to split', () => {
    // Four establishments in the registry, and Google truncated anyway: it sees more here
    // than SIRENE knows about, and the radius is the only handle left.
    const { cells, fromDensity } = planRecovery(parent, cloud(4, 80, 43), RECOVERY)
    expect(fromDensity).toBe(false)
    expect(cells).toHaveLength(4)
    expect(cells.every((c) => c.radius < parent.radius)).toBe(true)
  })

  it('keeps the quarters covering their parent with no gap', () => {
    // The reason they survive at all: a tighter split would leave four areas never queried.
    for (const q of subdivide(parent, GRID.minRadius)) {
      expect(distanceInMeters(parent, q) + q.radius).toBeGreaterThanOrEqual(parent.radius)
    }
    expect(uncovered(parent, subdivide(parent, GRID.minRadius))).toEqual([])
  })
})
