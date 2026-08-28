/**
 * Google <-> SIRENE matching (pipeline step 5).
 *
 * Google gives the opening hours, SIRENE gives the headcount bracket. Without the latter,
 * split-shift inference loses its pivot: an establishment open at lunch AND at dinner is
 * flagged as a split shift whatever the size of the team (D4).
 *
 * Two combined criteria — proximity under 75 m AND name similarity after normalization.
 * Below the threshold we leave the headcount EMPTY: a headcount pinned on the wrong
 * establishment produces a false split-shift verdict the user cannot detect. Missing
 * information, on the other hand, shows up as missing.
 *
 * Free and replayable: no network call, no quota spent.
 *
 *   node --env-file=.env.local --import tsx scripts/match-sirene.ts [--dry-run] [--threshold=0.45]
 */
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { restaurant, sweepRun } from '../lib/db/schema'
import { COMMUNE_NAMES } from '../lib/config'
import { computeProfile, parseOpeningHours, teamSize } from '../lib/hours'
import type { Category, GoogleOpeningHours } from '../lib/hours'
import { profileColumns } from '../lib/profile-columns'

/** Matching radius, in meters. Beyond it, two establishments are neighbours, not the same. */
const MAX_DISTANCE = 75

/**
 * Trigram similarity threshold. Tunable — it is the one number in this script that will
 * need calibrating against real data, hence `--threshold`.
 * Too low and we pin wrong headcounts; too high and we lose legitimate matches, dropping
 * the split-shift filter back to its degraded mode.
 */
const DEFAULT_THRESHOLD = 0.45

/** Domain stop words: present everywhere, therefore discriminating nowhere. */
const STOP_WORDS = [
  'restaurant', 'le', 'la', 'les', 'chez', 'aux', 'du', 'de', 'brasserie', 'bar', 'cafe',
]

/**
 * A name that normalization shrinks below 3 characters discriminates nothing any more
 * ("Le Bar" becomes empty): we would rather not match at all.
 */
const MIN_NAME_LENGTH = 3

const METERS_PER_DEGREE_LAT = 110574
const METERS_PER_DEGREE_LNG = 111320

/** Past this multiple of the global rate, a commune is no longer statistical noise. */
const CONCENTRATION_FACTOR = 1.5
const SIGNIFICANT_UNMATCHED = 20

const BATCH_SIZE = 500

/**
 * Name normalization, written in SQL so that `similarity()` compares two strings prepared
 * the same way. Written once and applied to BOTH sides: a divergence between the two
 * normalizations would sink the match rate without a single message.
 *
 * `unaccent` is not installed (only `pg_trgm` is), hence the explicit `translate`.
 * Ligatures come first, because they unfold into two letters.
 */
function normalizedName(column: string): string {
  return `btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(replace(replace(lower(${column}), 'œ', 'oe'), 'æ', 'ae'),
                  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                  'aaaaaaceeeeiiiinooooouuuuyy'),
        '[^a-z0-9]+', ' ', 'g'),
      '\\y(${STOP_WORDS.join('|')})\\y', ' ', 'g'),
    '\\s+', ' ', 'g'))`
}

interface Candidate {
  restaurant_id: string
  google_place_id: string
  siret: string
  headcount_code: string | null
  naf: string | null
  score: number
  distance: number
}

/**
 * `similarity()` comes from `pg_trgm`, which has to be enabled by hand on Supabase
 * (spec 08). Without this check, the failure shows up as a "function similarity(text,
 * text) does not exist" in the middle of a 40-line query — true, but unreadable.
 */
async function checkPgTrgm(): Promise<void> {
  const [present] = (await db.execute(
    sql`SELECT count(*) > 0 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`,
  )) as unknown as { ok: boolean }[]

  if (!present?.ok) {
    throw new Error(
      'the pg_trgm extension is not installed on this database — name matching depends on it.\n'
      + '  Enable it with: CREATE EXTENSION IF NOT EXISTS pg_trgm;\n'
      + '  See .specs/technique/08-infrastructure.md',
    )
  }
}

/**
 * Every plausible pair, in one query.
 *
 * Preselection by bounding box on lat/lng before any distance computation: there is no
 * PostGIS (D12) and the `sirene_position` index does the work. The box is slightly wider
 * than the 75 m disc; the final filter on the real distance trims the corners.
 */
async function findCandidates(threshold: number): Promise<Candidate[]> {
  const deltaLat = MAX_DISTANCE / METERS_PER_DEGREE_LAT

  const rows = await db.execute(sql`
    WITH google AS (
      SELECT r.id, r.google_place_id, r.lat, r.lng,
             ${sql.raw(normalizedName('r.name'))} AS normalized_name
      FROM restaurant r
    ), registry AS (
      SELECT s.siret, s.headcount_code, s.naf, s.lat, s.lng,
             ${sql.raw(normalizedName('s.name'))} AS normalized_name
      FROM sirene_establishment s
      WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
    ), candidates AS (
      SELECT g.id AS restaurant_id,
             g.google_place_id,
             s.siret,
             s.headcount_code,
             s.naf,
             similarity(g.normalized_name, s.normalized_name) AS score,
             sqrt(
               power((s.lat - g.lat) * ${METERS_PER_DEGREE_LAT}, 2) +
               power((s.lng - g.lng) * ${METERS_PER_DEGREE_LNG} * cos(radians(g.lat)), 2)
             ) AS distance
      FROM google g
      JOIN registry s
        ON s.lat BETWEEN g.lat - ${deltaLat} AND g.lat + ${deltaLat}
       AND s.lng BETWEEN g.lng - (${MAX_DISTANCE} / (${METERS_PER_DEGREE_LNG} * cos(radians(g.lat))))
                     AND g.lng + (${MAX_DISTANCE} / (${METERS_PER_DEGREE_LNG} * cos(radians(g.lat))))
      WHERE length(g.normalized_name) >= ${MIN_NAME_LENGTH}
        AND length(s.normalized_name) >= ${MIN_NAME_LENGTH}
        AND similarity(g.normalized_name, s.normalized_name) >= ${threshold}
    )
    SELECT restaurant_id::text AS restaurant_id,
           google_place_id, siret, headcount_code, naf, score, distance
    FROM candidates
    WHERE distance <= ${MAX_DISTANCE}
    ORDER BY score DESC, distance ASC
  `)

  return rows as unknown as Candidate[]
}

/**
 * Greedy assignment, best score first: a Google establishment and a SIRENE record are
 * each used only once. Without that exclusivity, a single SIRENE record would be consumed
 * by several Google entries and the unmatched count — the canary — would be skewed in the
 * reassuring direction.
 *
 * Score outranks distance: under 75 m, it is the name that discriminates.
 */
function assign(candidates: Candidate[]): Map<string, Candidate> {
  const kept = new Map<string, Candidate>()
  const takenSirets = new Set<string>()

  for (const c of candidates) {
    if (kept.has(c.restaurant_id) || takenSirets.has(c.siret)) continue
    kept.set(c.restaurant_id, c)
    takenSirets.add(c.siret)
  }

  return kept
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/**
 * Writes the matching, after erasing the previous one.
 *
 * The reset is deliberate: the result must depend on the current state of the two tables
 * alone, never on a past run. A struck-off SIRENE record or a tightened threshold must
 * undo a match, not leave it lying around.
 */
async function apply(kept: Map<string, Candidate>): Promise<void> {
  const pairs = [...kept.entries()]

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE restaurant
      SET siret = NULL, naf_code = NULL, headcount_code = NULL, match_score = NULL
    `)
    await tx.execute(sql`
      UPDATE sirene_establishment SET google_place_id = NULL WHERE google_place_id IS NOT NULL
    `)

    for (const batch of chunk(pairs, BATCH_SIZE)) {
      // Every value is cast: inside a VALUES, an untyped NULL leaves Postgres unable to
      // guess the column.
      const values = batch.map(([id, c]) => sql`(
        ${id}::uuid, ${c.siret}::text, ${c.naf}::text, ${c.headcount_code}::text, ${c.score}::real
      )`)
      await tx.execute(sql`
        UPDATE restaurant AS r
        SET siret = v.siret, naf_code = v.naf, headcount_code = v.headcount, match_score = v.score
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, siret, naf, headcount, score)
        WHERE r.id = v.id
      `)

      const links = batch.map(([, c]) => sql`(${c.siret}::text, ${c.google_place_id}::text)`)
      await tx.execute(sql`
        UPDATE sirene_establishment AS s
        SET google_place_id = v.place_id
        FROM (VALUES ${sql.join(links, sql`, `)}) AS v(siret, place_id)
        WHERE s.siret = v.siret
      `)
    }
  })
}

interface RestaurantRow {
  id: string
  headcountCode: string | null
  category: Category
  rawOpeningHours: unknown
}

/**
 * Recomputes the profiles of only those establishments whose headcount just changed.
 * The split-shift verdict crosses opening hours WITH headcount: a headcount that moves
 * invalidates the profile computed before it.
 */
async function recomputeProfiles(
  rows: RestaurantRow[],
  headcounts: Map<string, string | null>,
): Promise<void> {
  const now = new Date()

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const windows = parseOpeningHours(r.rawOpeningHours as GoogleOpeningHours | null)
      const profile = computeProfile({
        windows,
        headcountCode: headcounts.get(r.id) ?? null,
        category: r.category,
      })

      await tx.update(restaurant)
        .set({ ...profileColumns(windows, profile), profileComputedAt: now })
        .where(eq(restaurant.id, r.id))
    }
  })
}

const pct = (n: number, total: number): string =>
  total === 0 ? '-' : `${((n / total) * 100).toFixed(1)}%`

/** A headcount is only usable if it maps to a team size: `NN` says nothing. */
const hasUsableHeadcount = (code: string | null): boolean => teamSize(code) !== 'unknown'

interface SireneRow {
  siret: string
  commune_code: string
  geocoded: boolean
}

/**
 * The sweep's canary. Unmatched records normally spread out diffusely; a commune that
 * breaks away signals an area the Google sweep missed — the one defect invisible in the
 * UI, since a missing establishment displays nothing at all.
 *
 * We reason in RATES, not in volumes: a raw count would only rank communes by size.
 */
function printCanary(registry: SireneRow[], matchedSirets: Set<string>): number {
  const geocoded = registry.filter((s) => s.geocoded)
  const withoutPosition = registry.length - geocoded.length
  const unmatched = geocoded.filter((s) => !matchedSirets.has(s.siret))
  const globalRate = geocoded.length === 0 ? 0 : unmatched.length / geocoded.length

  console.log('')
  console.log(`unmatched SIRENE records: ${unmatched.length} out of ${geocoded.length} geocoded `
    + `(${pct(unmatched.length, geocoded.length)})`)
  if (withoutPosition > 0) {
    console.log(`  + ${withoutPosition} without coordinates, out of reach of any match `
      + `— rerun ingest:geocode if that figure is a surprise`)
  }

  const byCommune = new Map<string, { total: number; missing: number }>()
  for (const s of geocoded) {
    const e = byCommune.get(s.commune_code) ?? { total: 0, missing: 0 }
    e.total += 1
    if (!matchedSirets.has(s.siret)) e.missing += 1
    byCommune.set(s.commune_code, e)
  }

  const ranked = [...byCommune.entries()]
    .map(([code, e]) => ({
      label: COMMUNE_NAMES[code] ?? code,
      ...e,
      rate: e.total === 0 ? 0 : e.missing / e.total,
    }))
    .sort((a, b) => b.rate - a.rate)

  console.log('  breakdown by commune (unmatched rate):')
  for (const r of ranked) {
    const suspect = r.missing >= SIGNIFICANT_UNMATCHED
      && r.rate > globalRate * CONCENTRATION_FACTOR
    console.log(
      `    ${r.label.padEnd(14)} ${String(r.missing).padStart(5)} / ${String(r.total).padStart(5)}`
      + `  ${pct(r.missing, r.total).padStart(7)}`
      + (suspect ? '   <-- concentration, area probably missed by the sweep' : ''),
    )
  }

  return unmatched.length
}

/**
 * The canary gets read back later, next to the sweep that produced it: the
 * `sirene_unmatched` column exists for that and nobody was writing it. Without it,
 * comparing two successive sweeps means digging up the console output of the right night.
 */
async function recordCanary(unmatched: number): Promise<void> {
  const [last] = await db.select({ id: sweepRun.id }).from(sweepRun)
    .orderBy(desc(sweepRun.startedAt)).limit(1)
  if (!last) return
  await db.update(sweepRun).set({ sireneUnmatched: unmatched }).where(eq(sweepRun.id, last.id))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const threshold = parseThreshold(args)

  const restaurants = await db.select({
    id: restaurant.id,
    headcountCode: restaurant.headcountCode,
    category: restaurant.category,
    rawOpeningHours: restaurant.rawOpeningHours,
  }).from(restaurant)

  const registry = (await db.execute(sql`
    SELECT siret, commune_code, (lat IS NOT NULL AND lng IS NOT NULL) AS geocoded
    FROM sirene_establishment
  `)) as unknown as SireneRow[]

  console.log(`Google establishments: ${restaurants.length}`)
  console.log(`SIRENE records: ${registry.length}`
    + ` (${registry.filter((s) => s.geocoded).length} of them geocoded)`)

  // Empty database: nothing to match, and above all nothing to erase. We leave without writing.
  if (restaurants.length === 0 || registry.length === 0) {
    const missing = restaurants.length === 0
      ? 'the restaurant table is empty — run sweep:google first'
      : 'the sirene_establishment table is empty — run ingest:sirene then ingest:geocode first'
    console.log(`nothing to match: ${missing}`)
    return
  }

  if (!registry.some((s) => s.geocoded)) {
    console.log('nothing to match: no geocoded SIRENE record — run ingest:geocode first')
    return
  }

  console.log(`similarity threshold: ${threshold}${dryRun ? '  (--dry-run: nothing written)' : ''}`)

  await checkPgTrgm()
  const candidates = await findCandidates(threshold)
  const kept = assign(candidates)
  const matchedSirets = new Set([...kept.values()].map((c) => c.siret))

  const headcountsBefore = new Map(restaurants.map((r) => [r.id, r.headcountCode]))
  const headcountsAfter = new Map(
    restaurants.map((r) => [r.id, kept.get(r.id)?.headcount_code ?? null]),
  )
  const changed = restaurants.filter((r) => headcountsBefore.get(r.id) !== headcountsAfter.get(r.id))

  if (!dryRun) await apply(kept)

  console.log('')
  console.log(`candidate pairs examined: ${candidates.length}`)
  console.log(`matched: ${kept.size} Google establishments out of ${restaurants.length}`
    + `  (match rate ${pct(kept.size, restaurants.length)})`)

  const unmatched = printCanary(registry, matchedSirets)
  if (!dryRun) await recordCanary(unmatched)

  const usableBefore = restaurants.filter((r) => hasUsableHeadcount(headcountsBefore.get(r.id) ?? null))
  const usableAfter = restaurants.filter((r) => hasUsableHeadcount(headcountsAfter.get(r.id) ?? null))
  const gained = restaurants.filter((r) =>
    hasUsableHeadcount(headcountsAfter.get(r.id) ?? null)
    && !hasUsableHeadcount(headcountsBefore.get(r.id) ?? null))
  const matchedWithoutHeadcount = kept.size - usableAfter.length

  console.log('')
  console.log(`usable headcount: ${usableAfter.length} establishments`
    + `  (${pct(usableAfter.length, restaurants.length)} of the database)`)
  console.log(`  ${gained.length} of them gained by this matching`
    + ` (${usableBefore.length} already had one)`)
  console.log(`  ${matchedWithoutHeadcount} matched but with no bracket on the SIRENE side:`
    + ` they fall back on the amplitude heuristic`)

  if (dryRun) {
    console.log('')
    console.log(`--dry-run: ${changed.length} profiles would have been recomputed, nothing was written`)
    return
  }

  console.log('')
  if (changed.length === 0) {
    console.log('no headcount changed: profiles left untouched')
  } else {
    await recomputeProfiles(changed, headcountsAfter)
    console.log(`profiles recomputed: ${changed.length} establishments whose headcount changed`)
  }
}

function parseThreshold(args: string[]): number {
  const prefix = '--threshold='
  const arg = args.find((a) => a.startsWith(prefix))
  if (!arg) return DEFAULT_THRESHOLD

  const value = Number(arg.slice(prefix.length))
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`--threshold expects a number strictly between 0 and 1, received "${arg}"`)
  }
  return value
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
