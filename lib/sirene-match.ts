/**
 * Which SIRENE record each Google establishment keeps, once the candidate pairs are known.
 *
 * Kept apart from scripts/match-sirene.ts, which connects at import time, so the tests can
 * call it.
 */

export interface Candidate {
  restaurant_id: string
  google_place_id: string
  siret: string
  headcount_code: string | null
  naf: string | null
  score: number
  distance: number
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Score outranks distance: under 75 m, it is the name that discriminates.
 *
 * The last two keys prefer nothing, they only make the order total. Duplicate SIRENE
 * records — same name, same geocoded point — tie on score AND distance, and a tie left to
 * the query plan was settled differently on each run: two dry-runs of unchanged code on
 * 2026-10-17 moved 15-20 headcounts between duplicates, so every monthly refresh could flip
 * verdicts with no change in the data.
 */
function byPreference(a: Candidate, b: Candidate): number {
  return b.score - a.score
    || a.distance - b.distance
    || compareText(a.siret, b.siret)
    || compareText(a.google_place_id, b.google_place_id)
}

/**
 * Greedy assignment, best pair first: a Google establishment and a SIRENE record are each
 * used only once. Without that exclusivity, a single SIRENE record would be consumed by
 * several Google entries and the unmatched count — the canary — would be skewed in the
 * reassuring direction.
 *
 * The candidates are sorted here rather than trusted in the order they arrive: the result
 * must depend on the pairs alone.
 */
export function assign(candidates: Candidate[]): Map<string, Candidate> {
  const kept = new Map<string, Candidate>()
  const takenSirets = new Set<string>()

  for (const c of [...candidates].sort(byPreference)) {
    if (kept.has(c.restaurant_id) || takenSirets.has(c.siret)) continue
    kept.set(c.restaurant_id, c)
    takenSirets.add(c.siret)
  }

  return kept
}
