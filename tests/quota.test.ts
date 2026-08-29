import { describe, expect, it } from 'vitest'
import { FREE_MONTHLY_QUOTA, SWEEP } from '@/lib/config'
import { callsLeft, monthKey, monthWindow } from '@/lib/quota'

const CEILING = SWEEP.maxCallsPerPeriod

describe('the quota period', () => {
  // ─────────────────────────────────────────────────────────────
  // The deadlock D28 fixes. The ceiling used to count the sweep, whose
  // total can only rise; a resume could therefore never spend again.
  // These are the three invariants of spec 10 §1.
  // ─────────────────────────────────────────────────────────────
  it('starts a new period from zero, whatever the previous one cost', () => {
    // 07:00Z is Pacific midnight in summer: the last instant of August, then the first of September.
    expect(monthKey(new Date('2026-09-01T06:59:59Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-09-01T07:00:00Z'))).toBe('2026-09')
    expect(callsLeft(0, CEILING)).toBe(CEILING)
  })

  it('shares one ceiling between several executions of the same period', () => {
    expect(callsLeft(400, CEILING)).toBe(CEILING - 400)
    expect(callsLeft(CEILING, CEILING)).toBe(0)
  })

  it('carries nothing over, neither what was spent nor what was not', () => {
    // An overspent period reads 0, never a negative credit charged to the next one.
    expect(callsLeft(CEILING + 300, CEILING)).toBe(0)
    // And an unspent one grants no more than its own ceiling.
    expect(callsLeft(0, CEILING)).toBe(CEILING)
  })
})

describe('the ceiling', () => {
  // ─────────────────────────────────────────────────────────────
  // The whole guarantee: a period can never on its own cause billing.
  // `.specs/technique/02-budget-google-et-garde-fous.md` records the
  // Google-side daily cap at 1,000 — equal to the free monthly quota —
  // so this single ordering is what the promise rests on.
  // ─────────────────────────────────────────────────────────────
  it('stays under the free monthly quota', () => {
    expect(CEILING).toBeLessThan(FREE_MONTHLY_QUOTA)
  })
})

describe('the period boundary', () => {
  // ─────────────────────────────────────────────────────────────
  // Pacific, not UTC: Cloud Billing rolls its cycle over at midnight
  // Pacific. Counting UTC months would leave an eight-hour window each
  // month in which our counter has reset and Google's has not — and the
  // monthly cycle fires inside it.
  // ─────────────────────────────────────────────────────────────
  it('cuts the month at Pacific midnight, closed at both ends', () => {
    const w = monthWindow(new Date('2026-08-29T11:00:00Z'))

    expect(w.start.toISOString()).toBe('2026-08-01T07:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-09-01T07:00:00.000Z')
  })

  it('follows daylight saving rather than a fixed offset', () => {
    // Summer is UTC-7, winter UTC-8. A constant offset would be wrong half the year.
    expect(monthWindow(new Date('2026-12-15T12:00:00Z')).start.toISOString())
      .toBe('2026-12-01T08:00:00.000Z')
  })

  it('rolls December into the following January', () => {
    expect(monthWindow(new Date('2026-12-15T12:00:00Z')).end.toISOString())
      .toBe('2027-01-01T08:00:00.000Z')
  })

  it('still counts the previous period at the hour the monthly cycle fires', () => {
    // 03:00 UTC on the 1st is 20:00 the day before, Pacific. This is the case that makes
    // the timezone load-bearing rather than pedantic.
    expect(monthKey(new Date('2026-09-01T03:00:00Z'))).toBe('2026-08')
  })
})
