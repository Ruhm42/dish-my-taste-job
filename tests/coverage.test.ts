import { describe, expect, it } from 'vitest'
import { buildCoverage, countOwed, countUnfinished, owesCall } from '@/lib/coverage'
import { monthWindow } from '@/lib/quota'

/** September 2026, Pacific — the period the sweep counts against. */
const SEPTEMBER = monthWindow(new Date('2026-09-15T12:00:00Z'))

const AUGUST_29 = new Date('2026-08-29T10:00:00Z')
const SEPTEMBER_02 = new Date('2026-09-02T10:00:00Z')
const OCTOBER_02 = new Date('2026-10-02T10:00:00Z')

type Status = 'pending' | 'done' | 'truncated' | 'irreducible' | 'failed'
const at = (status: Status, queriedAt: Date | null) => ({ status, queriedAt })

describe('what a period still owes', () => {
  // ─────────────────────────────────────────────────────────────
  // D30 rule 1: `done` means "done in THIS period", not "done once
  // and for all". Everything a cell collects expires 30 days later,
  // so a plan that is never replayed goes stale wholesale.
  // ─────────────────────────────────────────────────────────────
  it('owes a call for a cell queried in an earlier period', () => {
    expect(owesCall(at('done', AUGUST_29), SEPTEMBER)).toBe(true)
    expect(owesCall(at('truncated', AUGUST_29), SEPTEMBER)).toBe(true)
    expect(owesCall(at('irreducible', AUGUST_29), SEPTEMBER)).toBe(true)
  })

  it('owes nothing for a cell already queried inside the period', () => {
    expect(owesCall(at('done', SEPTEMBER_02), SEPTEMBER)).toBe(false)
    // A truncated cell stored content too, and it expires on the same clock.
    expect(owesCall(at('truncated', SEPTEMBER_02), SEPTEMBER)).toBe(false)
  })

  it('owes a call for a cell queried in a LATER period', () => {
    // The window is closed at both ends. Folding October's work into September would make
    // `--as-of`, the tool built to rehearse a period, lie about that period.
    expect(owesCall(at('done', OCTOBER_02), SEPTEMBER)).toBe(true)
  })

  it('always owes a call for a cell never queried', () => {
    expect(owesCall(at('pending', null), SEPTEMBER)).toBe(true)
  })

  it('always owes a call for a failed cell, whenever it failed', () => {
    // It was billed and returned nothing: `queried_at` dates the failure, not content.
    expect(owesCall(at('failed', SEPTEMBER_02), SEPTEMBER)).toBe(true)
    expect(owesCall(at('failed', AUGUST_29), SEPTEMBER)).toBe(true)
  })

  it('counts refresh and discovery as one single plan', () => {
    // D30: there is no refresh budget and no discovery budget to split — one plan.
    const cells = [
      at('done', AUGUST_29), at('truncated', AUGUST_29), at('irreducible', AUGUST_29),
      at('done', SEPTEMBER_02),
      at('pending', null), at('pending', null),
    ]
    expect(countOwed(cells, SEPTEMBER)).toBe(5)
  })

  it('owes nothing once the whole plan has been swept inside the period', () => {
    const cells = [at('done', SEPTEMBER_02), at('truncated', SEPTEMBER_02)]
    expect(countOwed(cells, SEPTEMBER)).toBe(0)
  })
})

describe('a truncation left unresolved', () => {
  // ─────────────────────────────────────────────────────────────
  // Nothing ever moves a cell OUT of `truncated`: coverage is read
  // from its children, or the count could only ever grow.
  // ─────────────────────────────────────────────────────────────
  const cell = (id: string, status: Status, parentId: string | null = null) =>
    ({ id, parentId, status })

  it('leaves a truncated cell uncovered while it has no children', () => {
    const cells = [cell('a', 'truncated')]
    expect(buildCoverage(cells)(cells[0])).toBe(false)
    expect(countUnfinished(cells)).toBe(1)
  })

  it('covers a truncated cell once every child is covered', () => {
    const cells = [
      cell('a', 'truncated'),
      cell('a1', 'done', 'a'), cell('a2', 'done', 'a'), cell('a3', 'irreducible', 'a'),
    ]
    expect(buildCoverage(cells)(cells[0])).toBe(true)
    expect(countUnfinished(cells)).toBe(0)
  })

  it('leaves it uncovered while one child is still pending', () => {
    const cells = [
      cell('a', 'truncated'),
      cell('a1', 'done', 'a'), cell('a2', 'pending', 'a'),
    ]
    expect(countUnfinished(cells)).toBe(2)
  })
})
