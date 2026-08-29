/**
 * Recomputes the rhythm profile of EVERY establishment from the raw opening hours already
 * stored.
 *
 *   node --env-file=.env.local --import tsx scripts/compute-profiles.ts [--check]
 *
 * NO network call. This is the script we replay at will while tuning the inference rules,
 * without spending another cent of Google quota — hence the absence of a `--dry-run`:
 * there is nothing to protect here.
 *
 * `--check` writes nothing: it compares the recomputed profile with the stored one and
 * lists the divergences. That is what makes it possible to measure the effect of a rule
 * change BEFORE applying it to the database.
 *
 * See .specs/technique/05-inference-des-horaires.md and 06-pipeline-ingestion.md (step 6).
 */
import { eq } from 'drizzle-orm'
import { inferCategory, inferCuisine } from '../lib/category'
import { computeProfile, parseOpeningHours } from '../lib/hours'
import type {
  Category, Confidence, GoogleOpeningHours, RhythmProfile, ServiceWindow, SplitShiftRisk,
} from '../lib/hours'
import { profileColumns } from '../lib/profile-columns'
import { db } from '../lib/db/client'
import { restaurant } from '../lib/db/schema'

type Row = typeof restaurant.$inferSelect

const RISK_ORDER: SplitShiftRisk[] = ['none', 'low', 'medium', 'high', 'unknown']
const CONFIDENCE_ORDER: Confidence[] = ['confirmed', 'likely', 'unverified']

/** How many establishments the divergence report details before falling back to a total. */
const MAX_DETAILED = 40

/** Updates go out in batches: 6,000 UPDATEs in a row on one connection is slow. */
const BATCH_SIZE = 100

interface Recomputed {
  row: Row
  category: Category
  cuisine: string | null
  windows: ServiceWindow[]
  profile: RhythmProfile
}

/**
 * `other` carries two different meanings, and only one of them should overwrite.
 *
 * From an establishment that gave us no types at all, it means "no clue" — a silent
 * inference must not erase a category that is already there. From an establishment with
 * real types, it is a VERDICT: a supermarket is not an eating place, and saying so is the
 * point of the guard.
 */
function pickCategory(row: Row): Category {
  const inferred = inferCategory({
    types: row.googleTypes,
    naf: row.nafCode,
    name: row.name,
  })
  const hadSignal = (row.googleTypes?.length ?? 0) > 0
  return inferred === 'other' && !hadSignal ? row.category : inferred
}

function recompute(row: Row): Recomputed {
  const windows = parseOpeningHours(row.rawOpeningHours as GoogleOpeningHours | null)
  const category = pickCategory(row)
  const cuisine = inferCuisine(row.googleTypes)
  const profile = computeProfile({ windows, headcountCode: row.headcountCode, category })
  return { row, category, cuisine, windows, profile }
}

/**
 * The columns this script owns. The rest of the row is none of its business.
 * `category` joins the shared set: it is not derived from the profile, but it feeds it —
 * storing anything other than what went into the computation would show a verdict under a
 * label that contradicts it.
 */
function writtenColumns(r: Recomputed) {
  return { category: r.category, cuisine: r.cuisine, ...profileColumns(r.windows, r.profile) }
}

interface Divergence {
  column: string
  before: unknown
  after: unknown
}

/**
 * Canonical form for comparison. Sorting the keys is not cosmetic: Postgres reads a
 * `jsonb` back in ITS key order, not the one it was written in — `schedule` would come
 * back divergent on every run while nothing has moved.
 */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(o).sort().map((key) => [key, sort(o[key])]))
    }
    return v
  }
  return JSON.stringify(sort(value ?? null))
}

function divergences(r: Recomputed): Divergence[] {
  const stored = r.row as unknown as Record<string, unknown>
  const found: Divergence[] = []

  for (const [column, after] of Object.entries(writtenColumns(r))) {
    const before = stored[column]
    if (canonical(before) !== canonical(after)) found.push({ column, before, after })
  }
  return found
}

// ─────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────

function brief(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  const text = typeof value === 'string' ? value : canonical(value)
  return text.length > 70 ? `${text.slice(0, 67)}…` : text
}

function printDistribution(title: string, values: string[], order: string[]): void {
  const total = values.length
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)

  const keys = [...order.filter((k) => counts.has(k)), ...[...counts.keys()].filter((k) => !order.includes(k))]

  console.log(`\n${title}`)
  for (const key of keys) {
    const n = counts.get(key) ?? 0
    const share = total ? ((n / total) * 100).toFixed(1) : '0.0'
    console.log(`  ${key.padEnd(12)} ${String(n).padStart(5)}  (${share.padStart(5)}%)`)
  }
}

function printTransitions(title: string, transitions: Map<string, number>): void {
  if (transitions.size === 0) return
  console.log(`\n${title}`)
  for (const [transition, n] of [...transitions].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${transition.padEnd(26)} ${String(n).padStart(5)}`)
  }
}

/**
 * The quality control of the inference: these three figures are read after every run.
 * See "Contrôles après exécution" in 06-pipeline-ingestion.md.
 */
function printQualityCheck(recomputed: Recomputed[]): void {
  printDistribution(
    'split-shift risk distribution:',
    recomputed.map((r) => r.profile.splitShiftRisk),
    RISK_ORDER,
  )
  printDistribution(
    'confidence distribution:',
    recomputed.map((r) => r.profile.confidence),
    CONFIDENCE_ORDER,
  )

  const withoutHours = recomputed.filter((r) => !r.profile.hasHours).length
  const share = recomputed.length ? ((withoutHours / recomputed.length) * 100).toFixed(1) : '0.0'
  console.log(`\nestablishments without opening hours: ${withoutHours} out of ${recomputed.length} (${share}%)`)
}

// ─────────────────────────────────────────────────────────────
// Modes
// ─────────────────────────────────────────────────────────────

function check(recomputed: Recomputed[]): void {
  const perColumn = new Map<string, number>()
  const riskTransitions = new Map<string, number>()
  const confidenceTransitions = new Map<string, number>()
  const divergent: { r: Recomputed; d: Divergence[] }[] = []

  for (const r of recomputed) {
    const d = divergences(r)
    if (d.length === 0) continue
    divergent.push({ r, d })

    for (const { column, before, after } of d) {
      perColumn.set(column, (perColumn.get(column) ?? 0) + 1)
      const key = `${String(before)} -> ${String(after)}`
      if (column === 'splitShiftRisk') riskTransitions.set(key, (riskTransitions.get(key) ?? 0) + 1)
      if (column === 'confidence') confidenceTransitions.set(key, (confidenceTransitions.get(key) ?? 0) + 1)
    }
  }

  console.log(`\n--check: nothing written to the database.`)
  console.log(`${divergent.length} divergent establishment(s) out of ${recomputed.length}`)

  for (const { r, d } of divergent.slice(0, MAX_DETAILED)) {
    console.log(`\n  ${r.row.name} [${r.row.googlePlaceId}]`)
    for (const { column, before, after } of d) {
      console.log(`    ${column} : ${brief(before)}  ->  ${brief(after)}`)
    }
  }
  if (divergent.length > MAX_DETAILED) {
    console.log(`\n  … and ${divergent.length - MAX_DETAILED} other divergent establishment(s) not detailed`)
  }

  if (perColumn.size > 0) {
    console.log('\ndivergences per column:')
    for (const [column, n] of [...perColumn].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${column.padEnd(24)} ${String(n).padStart(5)}`)
    }
  }
  printTransitions('split-shift risk transitions:', riskTransitions)
  printTransitions('confidence transitions:', confidenceTransitions)
}

async function write(recomputed: Recomputed[]): Promise<void> {
  const modified = recomputed.filter((r) => divergences(r).length > 0).length
  const now = new Date()

  // We rewrite EVERY row, unchanged ones included: `profile_computed_at` must date the
  // last computation, not the last modification — otherwise we can no longer tell a row
  // that was put through the mill from one that was simply forgotten.
  for (let i = 0; i < recomputed.length; i += BATCH_SIZE) {
    const batch = recomputed.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map((r) =>
        db
          .update(restaurant)
          .set({ ...writtenColumns(r), profileComputedAt: now })
          .where(eq(restaurant.id, r.row.id)),
      ),
    )
  }

  console.log(`\n${recomputed.length} profile(s) written, ${modified} of them actually modified`)
}

// ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const checkMode = args.includes('--check')
  const unknown = args.filter((a) => a !== '--check')
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(', ')}`)
    console.error('Usage: node --env-file=.env.local --import tsx scripts/compute-profiles.ts [--check]')
    process.exit(1)
  }

  const rows = await db.select().from(restaurant)
  console.log(`${rows.length} establishment(s) read`)
  if (rows.length === 0) {
    console.error('Empty database — run `npm run seed` or the ingestion pipeline first.')
    process.exit(1)
  }

  // We compute EVERYTHING before writing anything: one malformed raw opening-hours payload
  // must fail the whole script, not leave the database half recomputed.
  const recomputed: Recomputed[] = []
  const failures: string[] = []
  for (const row of rows) {
    try {
      recomputed.push(recompute(row))
    } catch (e) {
      failures.push(`  ${row.name} [${row.googlePlaceId}]: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} establishment(s) impossible to process — nothing was written:`)
    console.error(failures.join('\n'))
    process.exit(1)
  }

  if (checkMode) check(recomputed)
  else await write(recomputed)

  printQualityCheck(recomputed)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
