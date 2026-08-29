/**
 * When a sweep plan is finished.
 *
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
  status: 'pending' | 'done' | 'truncated' | 'irreducible' | 'failed'
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
