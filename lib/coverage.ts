/**
 * What a sweep plan still owes, on the two counts that decide whether a cycle is done:
 * a call for the current quota period, and a truncation nobody has resolved.
 *
 * Kept free of any database import, like `lib/quota`: these are the rules the sweep, the
 * monthly cycle and the tests all have to agree on, and they have to be unit-testable.
 */
import type { Window } from './quota'

type CellStatus = 'pending' | 'done' | 'truncated' | 'irreducible' | 'failed'

/**
 * A truncated cell has been paid for and hid an unknown number of results behind the
 * 20-result cap; it is only covered once the four cells that recover what it hid are
 * themselves covered. Counting every truncated cell as unfinished instead — which is what
 * the monthly cycle did — is a rule that can never come true: nothing in the pipeline ever
 * moves a cell OUT of `truncated`, so the count could only grow. The cycle would then skip
 * planning for ever, and fail every month once the last pending cell was queried.
 *
 * `irreducible` counts as covered. It means the sweep queried the cell, could not subdivide
 * further and said so loudly; there is no further call to make. It still fails the sweep on
 * its own line, so nothing is hidden by treating it as terminal here.
 */
export interface CoverableCell {
  id: string
  parentId: string | null
  status: CellStatus
}

export interface QueryableCell {
  status: CellStatus
  /** Set by every call, success or failure — so it dates the content the cell holds. */
  queriedAt: Date | null
}

export function buildCoverage<T extends CoverableCell>(cells: T[]): (c: T) => boolean {
  const children = new Map<string, T[]>()
  for (const c of cells) {
    if (!c.parentId) continue
    const list = children.get(c.parentId) ?? []
    list.push(c)
    children.set(c.parentId, list)
  }
  const isCovered = (c: T): boolean => {
    if (c.status === 'done' || c.status === 'irreducible') return true
    if (c.status !== 'truncated') return false
    const kids = children.get(c.id) ?? []
    return kids.length > 0 && kids.every(isCovered)
  }
  return isCovered
}

/** Cells that still owe a Google call: never queried, or hiding results behind a cap. */
export function countUnfinished<T extends CoverableCell>(cells: T[]): number {
  const isCovered = buildCoverage(cells)
  return cells.filter((c) => c.status === 'pending' || c.status === 'failed').length
    + cells.filter((c) => c.status === 'truncated' && !isCovered(c)).length
}

/**
 * Whether a cell still owes a Google call in the quota period being swept.
 *
 * `done` used to mean "done once and for all", and that is what deadlocked the freshness:
 * everything a cell collects expires 30 days later (D7), so a plan that is never replayed
 * grows stale wholesale while the sweep spends its quota discovering elsewhere. `done` now
 * means "done in THIS period" — D22's rule, never replay, holds inside a period and stops
 * holding across one, because every period has to buy the content again anyway (D30 rule 1).
 *
 * The window is closed at both ends, like the one the call counter is read against: a cell
 * queried in a LATER period was still owed by this one, and a simulated period that folded
 * later work into itself would make `--as-of` lie about the very thing it exists to show.
 *
 * A failed cell owes a call whenever it happened: it was billed and returned nothing.
 */
export function owesCall(c: QueryableCell, period: Window): boolean {
  if (c.status === 'pending' || c.status === 'failed') return true
  if (!c.queriedAt) return true
  return c.queriedAt < period.start || c.queriedAt >= period.end
}

/** Cells this period still has to pay for, refresh and discovery taken together. */
export function countOwed<T extends QueryableCell>(cells: T[], period: Window): number {
  return cells.filter((c) => owesCall(c, period)).length
}
