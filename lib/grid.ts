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
