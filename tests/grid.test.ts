import { describe, expect, it } from 'vitest'
import { distanceInMeters, hilbertIndex, planCells } from '@/lib/grid'
import type { Cell, Point } from '@/lib/grid'
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
