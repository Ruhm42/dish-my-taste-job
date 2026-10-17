import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { COMMUNE_CODES, GRID } from '../config'
import type { KnownRecord, PlanCell } from '../coverage'
import type { Point } from '../grid'
import { db } from './client'
import { cell, restaurant, sireneEstablishment, sweepRun } from './schema'

/**
 * What a cover is drawn from, read-only: the plan the sweep walks, every record, and the
 * geocoded SIRENE points of the perimeter — the same filter plan:cells lays its grid on.
 *
 * The plan is the most recent run with cells, the one the sweep picks. Null when there is
 * none.
 */
export async function loadCoverInputs(): Promise<{
  cells: PlanCell[]
  records: (KnownRecord & { firstSeenAt: Date | null })[]
  sirene: Point[]
} | null> {
  const runs = await db.selectDistinct({ runId: cell.sweepRunId }).from(cell)
  if (runs.length === 0) return null
  const [latest] = await db.select({ id: sweepRun.id }).from(sweepRun)
    .where(inArray(sweepRun.id, runs.map((r) => r.runId)))
    .orderBy(desc(sweepRun.startedAt)).limit(1)
  const runId = latest?.id ?? runs[0].runId

  const cells = await db.select({
    id: cell.id, parentId: cell.parentId, depth: cell.depth, status: cell.status,
    lat: cell.lat, lng: cell.lng, radius: cell.radius,
    googleCount: cell.googleCount, lastResultDistance: cell.lastResultDistance,
    queriedAt: cell.queriedAt,
  }).from(cell).where(eq(cell.sweepRunId, runId))

  const records = await db.select({
    lat: restaurant.lat, lng: restaurant.lng,
    hoursExpiresAt: restaurant.hoursExpiresAt, firstSeenAt: restaurant.firstSeenAt,
  }).from(restaurant)

  const sirene = await db.select({ lat: sireneEstablishment.lat, lng: sireneEstablishment.lng })
    .from(sireneEstablishment)
    .where(and(
      inArray(sireneEstablishment.communeCode, [...COMMUNE_CODES]),
      isNotNull(sireneEstablishment.lat),
      isNotNull(sireneEstablishment.lng),
      gte(sireneEstablishment.geocodeScore, GRID.minGeocodeScore),
    )) as Point[]

  return { cells, records, sirene }
}
