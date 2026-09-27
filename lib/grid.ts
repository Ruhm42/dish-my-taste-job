/**
 * Sweep grid: cut a cloud of known points (geocoded SIRENE) into circular cells,
 * each queryable on its own with one `Nearby Search` call.
 *
 * Why a Hilbert curve and not a quadtree — a quadtree splits SPACE uniformly: one
 * dense area forces its sparse neighbours to subdivide too. Measured on the chosen
 * perimeter: 1,316 cells for a theoretical minimum of 564. The Hilbert curve
 * preserves geographic proximity while allowing a split by NUMBER of points, which
 * spends cells where the restaurants are and nowhere else. Measured: 692 cells.
 * See DECISIONS.md D17.
 *
 * Two constraints close a cell, and it is the RADIUS that dominates — measurement,
 * not intuition: Google truncates to 20 results from ~265 m of radius, and at 168 m
 * a cell already returns 18. The resulting median radius is 134 m, well below what
 * the point-count constraint alone would have produced.
 *
 * Pure module: no I/O, no dependency on the database.
 */

export interface Point {
  lat: number
  lng: number
}

/** A cell's footprint: what one `Nearby Search` call covers. */
export interface Circle extends Point {
  radius: number
}

export interface GridOptions {
  /** Maximum number of points per cell. */
  target: number
  /** Maximum radius in meters — the dominant constraint. */
  maxRadius: number
  /** Radius floor: a circle with a zero radius searches nothing. */
  minRadius: number
}

export interface Cell {
  lat: number
  lng: number
  radius: number
  /** SIRENE points contained. This is the sweep's truncation detector. */
  sireneCount: number
}

/** Exported so the sweep bounds its rectangles with the SAME approximation. */
export const METERS_PER_DEGREE_LAT = 111_100

/** Side of the projection grid. 2^16: ~20 cm of resolution over 13 km. */
const GRID_SIDE = 65_536

/**
 * Distance in meters, local equirectangular approximation.
 * On 200 m cells at Lyon's latitude, the gap with an exact geodesic computation
 * is under a decimeter: no need to pay for a haversine.
 */
export function distanceInMeters(a: Point, b: Point): number {
  const meanLat = (((a.lat + b.lat) / 2) * Math.PI) / 180
  const dy = (b.lat - a.lat) * METERS_PER_DEGREE_LAT
  const dx = (b.lng - a.lng) * METERS_PER_DEGREE_LAT * Math.cos(meanLat)
  return Math.hypot(dx, dy)
}

/**
 * Hilbert index of cell (x, y) in an n × n grid, n a power of two.
 *
 * Classic xy -> d conversion: we read the position bits from the most significant
 * to the least; at each level the quadrant gives its rank along the curve
 * (`(3·rx) ^ ry`), then we ROTATE the frame so the next level's pattern joins up
 * with this one. That rotation is what makes the curve continuous, and therefore
 * what preserves proximity.
 *
 * Precondition: x and y are integers in [0, n-1].
 */
export function hilbertIndex(x: number, y: number, n: number = GRID_SIDE): number {
  let cx = x
  let cy = y
  let d = 0
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (cx & s) > 0 ? 1 : 0
    const ry = (cy & s) > 0 ? 1 : 0
    // Sum and product in floating-point arithmetic: d climbs to 2^32 - 1, outside
    // the signed 32 bits of JavaScript's bitwise operators.
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        cx = n - 1 - cx
        cy = n - 1 - cy
      }
      const t = cx
      cx = cy
      cy = t
    }
  }
  return d
}

/** Centroid of the group. At this scale, an arithmetic mean is enough. */
function centroid(points: Point[]): Point {
  let lat = 0
  let lng = 0
  for (const p of points) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

function enclosingRadius(points: Point[], center: Point): number {
  let radius = 0
  for (const p of points) {
    const d = distanceInMeters(center, p)
    if (d > radius) radius = d
  }
  return radius
}

/** Sorts the points along the curve without copying them more than once. */
function sortByHilbert(points: Point[]): Point[] {
  let latMin = Infinity
  let latMax = -Infinity
  let lngMin = Infinity
  let lngMax = -Infinity
  for (const p of points) {
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
  }
  // Degenerate cloud (all collinear, or a single point): the zero span must not
  // produce a division by zero, the axis then collapses onto column 0.
  const latSpan = latMax - latMin || 1
  const lngSpan = lngMax - lngMin || 1

  const indexed = points.map((p) => {
    const x = Math.floor(((p.lng - lngMin) / lngSpan) * (GRID_SIDE - 1))
    const y = Math.floor(((p.lat - latMin) / latSpan) * (GRID_SIDE - 1))
    return { p, d: hilbertIndex(x, y) }
  })
  indexed.sort((a, b) => a.d - b.d)
  return indexed.map((i) => i.p)
}

function closeCell(points: Point[], minRadius: number): Cell {
  const center = centroid(points)
  return {
    lat: center.lat,
    lng: center.lng,
    radius: Math.max(enclosingRadius(points, center), minRadius),
    sireneCount: points.length,
  }
}

/**
 * Sweep plan: one cell per upcoming Google call.
 *
 * Points are walked in Hilbert-curve order and accumulated into the current cell,
 * which is closed as soon as adding the next point would break either constraint.
 * A lone point never breaks anything: no cell can be empty, and no point can be lost.
 */
export function planCells(points: Point[], options: GridOptions): Cell[] {
  const { target, maxRadius, minRadius } = options

  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`grid: invalid target (${target}) — at least 1 point per cell is required`)
  }
  if (!(maxRadius > 0)) {
    throw new Error(`grid: invalid maxRadius (${maxRadius}) — a circle without a radius searches nothing`)
  }
  if (!(minRadius >= 0) || minRadius > maxRadius) {
    throw new Error(`grid: minRadius (${minRadius}) must sit between 0 and maxRadius (${maxRadius})`)
  }
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      throw new Error(
        `grid: point without usable coordinates (lat=${p.lat}, lng=${p.lng}) — ` +
          'discard ungeocoded rows BEFORE planning, otherwise the area is silently missed',
      )
    }
  }
  if (points.length === 0) return []

  const cells: Cell[] = []
  let current: Point[] = []

  for (const point of sortByHilbert(points)) {
    if (current.length === 0) {
      current.push(point)
      continue
    }
    current.push(point)
    const exceeds =
      current.length > target || enclosingRadius(current, centroid(current)) > maxRadius
    if (exceeds) {
      current.pop()
      cells.push(closeCell(current, minRadius))
      current = [point]
    }
  }
  cells.push(closeCell(current, minRadius))

  return cells
}

// --- Resolving a truncation -----------------------------------------------------------

const RAD = Math.PI / 180

/**
 * The points inside a circle. Bounding box first, exact distance after — there is no
 * PostGIS (D12), and the box discards most candidates for the price of four comparisons.
 */
export function pointsInCircle<T extends Point>(
  points: T[], lat: number, lng: number, radius: number,
): T[] {
  const dLat = radius / METERS_PER_DEGREE_LAT
  const dLng = dLat / Math.max(0.01, Math.cos(lat * RAD))
  return points.filter(
    (p) =>
      Math.abs(p.lat - lat) <= dLat &&
      Math.abs(p.lng - lng) <= dLng &&
      distanceInMeters({ lat, lng }, p) <= radius,
  )
}

/**
 * Four circles covering the parent circle WITH NO GAP — the fallback, no longer the rule.
 *
 * We cover the square circumscribing the parent: each of its four quadrants, of side R, fits
 * inside a circle of radius R·√2/2 centred on that quadrant. A tighter split (four circles of
 * radius R/2) would leave four areas that are never queried — exactly the kind of defect that
 * never shows up in the UI.
 *
 * What it does not reduce is the DENSITY, which is what causes a truncation: measured over
 * 212 truncations and their 848 children, four circles of 0.72 R laid over a disc of radius R
 * total 2.07 times its area, the dense core falls inside all four, and a cell of 17.3 SIRENE
 * became four of 15.3 — straight back into the band that truncates 55% of the time. Four
 * calls to remove 12% of the density; resolving a cell of 30 that way takes four levels, 256
 * calls, a quarter of a month's quota for one cell (D30 rule 2).
 *
 * So it survives only for the case `planRecovery` cannot resolve: a cell the registry sees as
 * sparse and Google does not, where reducing the radius is the one handle left.
 */
export function subdivide(parent: Circle, minRadius: number): Circle[] {
  const radius = Math.max(minRadius, parent.radius * Math.SQRT1_2)
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

export interface Recovery {
  cells: Circle[]
  /** False when the density could not split the cell and the quarters took over. */
  fromDensity: boolean
}

/**
 * The cells that recover what a truncated cell hid, planned from the density inside it.
 *
 * A truncation is a density problem, so it is resolved on density: the parent's footprint is
 * replanned from the points it contains, in as many cells as it takes for each to sit under
 * the ceiling. A cell of 30 becomes three cells of 10, not four cells of 26. That is the
 * principle that makes this sweep cheap at depth 0 (D6) and had stopped being applied below
 * it — never four cells by principle (D30 rule 2).
 *
 * It covers the parent's POINTS rather than its AREA. The same promise the depth-0 plan
 * makes, and no weaker: a Google place with no SIRENE point near it is already outside the
 * plan, at every level.
 *
 * No child is wider than its parent, or it would query the very places that truncated it.
 * And when the density yields a single cell — the parent again — the quarters take over,
 * because the registry has nothing left to say about a place where Google holds more than it
 * knows, and the radius is then the only handle.
 *
 * The ceiling is read on the planner's ASSIGNMENT, which is the scale the ratio was measured
 * against: `plan:cells` writes assignments, and 12 x 1.57 = 18.8 < 20 is a statement about
 * one. What a circle CONTAINS is a different and much larger number — mean 16.4 for an
 * assignment of 12, up to 82 — because BAN geocodes co-located establishments onto the same
 * coordinate and no radius separates points that share one. Requiring the contained count to
 * sit under the ceiling is therefore unsatisfiable in central Lyon, and asking for it drove
 * the split to 7.5 cells per truncation for nothing.
 */
export function planRecovery(
  parent: Circle, points: Point[], options: { target: number; minRadius: number },
): Recovery {
  const inside = pointsInCircle(points, parent.lat, parent.lng, parent.radius)
  const byDensity = planCells(inside, {
    target: options.target,
    maxRadius: parent.radius,
    minRadius: Math.min(options.minRadius, parent.radius),
  })
  if (byDensity.length > 1) {
    return {
      cells: byDensity.map((c) => ({ lat: c.lat, lng: c.lng, radius: c.radius })),
      fromDensity: true,
    }
  }
  return { cells: subdivide(parent, options.minRadius), fromDensity: false }
}
