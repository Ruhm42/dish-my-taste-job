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
 * Four circles covering the parent circle WITH NO GAP.
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
 * It is nonetheless what `planRecovery` returns for almost every truncation: a density plan
 * made to cover the whole disk comes out dearer than these four — see `planRecovery`.
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
  /**
   * False when the quarters took over: the density could not split the cell, or covering the
   * whole disk from it would have cost as many calls as the quarters.
   */
  fromDensity: boolean
}

/** Closer than this in centre and in radius, two circles are the same Google call. */
const SAME_CIRCLE_METERS = 1

function sameCircle(a: Circle, b: Circle): boolean {
  return Math.abs(a.radius - b.radius) <= SAME_CIRCLE_METERS &&
    distanceInMeters(a, b) <= SAME_CIRCLE_METERS
}

/** Lattice points per parent radius, for the coverage check. */
const LATTICE_STEPS = 20

/**
 * The cells to add so that `circles` cover the whole of `parent`'s disk, each of `fillRadius`.
 *
 * Checked on a square lattice, and the check is a proof rather than an estimate: every point
 * of the disk lies within half a lattice diagonal of a lattice point, so a lattice point
 * counts as covered only when it sits that far INSIDE a circle. What passes is covered
 * everywhere, not only at the samples — a sliver between two of them cannot slip through.
 *
 * Gaps are filled greedily, each new cell centred on the uncovered sample from which it
 * covers the most others. A cell always covers its own centre, so the loop ends.
 */
function fillGaps(parent: Circle, circles: Circle[], fillRadius: number): Circle[] {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(parent.lat * RAD))
  const step = parent.radius / LATTICE_STEPS
  // The centimetre absorbs the gap between this flat frame and `distanceInMeters`, which
  // projects each pair at its own mean latitude.
  const slack = step * Math.SQRT1_2 + 0.01
  const reach = parent.radius + step * Math.SQRT1_2
  const n = Math.ceil(reach / step)

  type Disk = { x: number; y: number; r: number }
  const covers = (d: Disk, x: number, y: number) => Math.hypot(x - d.x, y - d.y) <= d.r - slack

  const disks: Disk[] = circles.map((c) => ({
    x: (c.lng - parent.lng) * metersPerDegreeLng,
    y: (c.lat - parent.lat) * METERS_PER_DEGREE_LAT,
    r: c.radius,
  }))
  let uncovered: { x: number; y: number }[] = []
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * step
      const y = j * step
      if (Math.hypot(x, y) <= reach && !disks.some((d) => covers(d, x, y))) uncovered.push({ x, y })
    }
  }

  const added: Circle[] = []
  while (uncovered.length > 0) {
    let best: Disk = { ...uncovered[0], r: fillRadius }
    let bestCount = 0
    for (const s of uncovered) {
      const candidate = { ...s, r: fillRadius }
      let count = 0
      for (const t of uncovered) if (covers(candidate, t.x, t.y)) count++
      if (count > bestCount) {
        best = candidate
        bestCount = count
      }
    }
    uncovered = uncovered.filter((s) => !covers(best, s.x, s.y))
    added.push({
      lat: parent.lat + best.y / METERS_PER_DEGREE_LAT,
      lng: parent.lng + best.x / metersPerDegreeLng,
      radius: fillRadius,
    })
  }
  return added
}

/**
 * The cells that recover what a truncated cell hid: the parent's WHOLE disk, in the fewest
 * calls. Planned from the SIRENE density inside it when that is cheaper than the quarters,
 * and the quarters otherwise — which, measured, is almost always.
 *
 * The guarantee is the disk, not the points. The parent queried every square metre of it and
 * was cut off at 20, so the places Google dropped can sit anywhere in it. A density plan lays
 * circles around SIRENE clusters and nowhere else: replayed over the 432 real truncations, the
 * circles it returned left 17.4% of the parent's disk out of every child on average and up to
 * 77%, and 470 known restaurants inside a truncated parent sat in none of its children — while
 * the sweep reported nothing unresolved. So the density plan is completed with cells over the
 * ground it leaves bare, none wider than a quarter, until the whole disk is covered.
 *
 * And then it stops being cheap. Covered, the density plan costs 7.3 cells per truncation
 * against the quarters' 4: it takes at least three circles to cover a disk when none may be
 * wider than it nor be it, and circles drawn around clusters cover it badly. What rule 2 of D30 had measured as
 * a saving — 3.2 cells instead of 4 on the same replay — was the uncovered ground. So the
 * density plan is kept only when it covers the disk in FEWER cells than the quarters, which
 * cover it by construction; on the replay that is 2 truncations out of 432, both parents
 * already at the radius floor.
 *
 * No child is wider than its parent, or it would query the very places that truncated it.
 * Two children that are the same circle are one call paid twice — BAN geocodes co-located
 * establishments onto one coordinate, and the planner returns the same circle for every batch
 * of the stack — so they are merged, and a child that is the parent again is dropped: it
 * would only truncate again. When fewer than two distinct cells are left, the registry has
 * nothing to say about a place where Google holds more than it knows, and the radius is the
 * only handle left.
 *
 * The ceiling is read on the planner's ASSIGNMENT, which is the scale the ratio was measured
 * against: `plan:cells` writes assignments, and 12 x 1.57 = 18.8 < 20 is a statement about
 * one. What a circle CONTAINS is a different and much larger number — mean 16.4 for an
 * assignment of 12, up to 82 — because of those co-located stacks, and no radius separates
 * points that share a coordinate. Requiring the contained count to sit under the ceiling is
 * therefore unsatisfiable in central Lyon, and asking for it drove the split to 7.5 cells per
 * truncation for nothing.
 */
export function planRecovery(
  parent: Circle, points: Point[], options: { target: number; minRadius: number },
): Recovery {
  const quarters = { cells: subdivide(parent, options.minRadius), fromDensity: false }
  const inside = pointsInCircle(points, parent.lat, parent.lng, parent.radius)
  const floor = Math.min(options.minRadius, parent.radius)
  const planned = planCells(inside, { target: options.target, maxRadius: parent.radius, minRadius: floor })

  const byDensity: Circle[] = []
  for (const c of planned) {
    const circle = { lat: c.lat, lng: c.lng, radius: c.radius }
    if (sameCircle(circle, parent) || byDensity.some((kept) => sameCircle(kept, circle))) continue
    byDensity.push(circle)
  }
  if (byDensity.length < 2 || byDensity.length >= quarters.cells.length) return quarters

  const fillRadius = Math.max(floor, parent.radius * Math.SQRT1_2)
  const cells = [...byDensity, ...fillGaps(parent, byDensity, fillRadius)]
  return cells.length < quarters.cells.length ? { cells, fromDensity: true } : quarters
}
