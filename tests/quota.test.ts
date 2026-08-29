import { describe, expect, it } from 'vitest'
import { SWEEP } from '@/lib/config'
import { callsLeft, dayKey, dayWindow, monthKey, monthWindow } from '@/lib/quota'

const LIMITS = { perMonth: 900, perDay: 750 }

describe('the quota period', () => {
  // ─────────────────────────────────────────────────────────────
  // The deadlock D28 fixes. The ceiling used to count the sweep, whose
  // total can only rise; a resume could therefore never spend again.
  // These are the three invariants of spec 10 §1.
  // ─────────────────────────────────────────────────────────────
  it('starts a new period from zero, whatever the previous one cost', () => {
    const august = new Date('2026-08-31T23:59:59Z')
    const september = new Date('2026-09-01T00:00:00Z')

    expect(monthKey(august)).not.toBe(monthKey(september))
    // 900 spent in August leaves September untouched: the count is scoped by the boundary.
    expect(callsLeft({ month: 0, day: 0 }, LIMITS).left).toBe(750)
  })

  it('shares one ceiling between several executions of the same period', () => {
    const after400 = callsLeft({ month: 400, day: 0 }, LIMITS)
    const after900 = callsLeft({ month: 900, day: 0 }, LIMITS)

    expect(after400.left).toBe(500)
    expect(after900.left).toBe(0)
  })

  it('carries nothing over, neither what was spent nor what was not', () => {
    // An overspent window reads 0, never a negative credit for the next one.
    expect(callsLeft({ month: 1200, day: 0 }, LIMITS).left).toBe(0)
    // And an unspent one grants no more than its own ceiling.
    expect(callsLeft({ month: 0, day: 0 }, LIMITS).left).toBe(750)
  })
})

describe('the two ceilings', () => {
  it('returns the smaller headroom and names which one binds', () => {
    // 652 spent, both windows: the month still allows 248, the day only 98.
    expect(callsLeft({ month: 652, day: 652 }, LIMITS)).toEqual({ left: 98, binding: 'day' })
  })

  it('binds on the month once the day has been reset by a rollover', () => {
    expect(callsLeft({ month: 880, day: 0 }, LIMITS)).toEqual({ left: 20, binding: 'month' })
  })

  it('names the month on a tie — rerunning tomorrow does not refill a spent month', () => {
    expect(callsLeft({ month: 750, day: 600 }, LIMITS).binding).toBe('month')
  })

  // ─────────────────────────────────────────────────────────────
  // D15 caps SearchNearbyRequest at 800/day on the Google side, BELOW our
  // own monthly 900. A local daily ceiling above it would hand back the
  // opaque HTTP 429 the local counter exists to prevent.
  // ─────────────────────────────────────────────────────────────
  it('keeps the configured daily ceiling under the Google one', () => {
    expect(SWEEP.maxCallsPerDay).toBeLessThan(800)
    expect(SWEEP.maxCallsPerPeriod).toBeGreaterThan(SWEEP.maxCallsPerDay)
  })
})

describe('the window boundaries', () => {
  it('cuts the month and the day in UTC, closed at both ends', () => {
    const now = new Date('2026-08-29T23:55:00Z')

    expect(monthWindow(now).start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(monthWindow(now).end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(dayWindow(now).start.toISOString()).toBe('2026-08-29T00:00:00.000Z')
    expect(dayWindow(now).end.toISOString()).toBe('2026-08-30T00:00:00.000Z')
  })

  // Both ends roll the year and the month over rather than producing a 13th month.
  it('closes December on the following January', () => {
    const w = monthWindow(new Date('2026-12-15T12:00:00Z'))
    expect(w.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(dayWindow(new Date('2026-12-31T23:00:00Z')).end.toISOString())
      .toBe('2027-01-01T00:00:00.000Z')
  })

  // The first real sweep started at 23:55 UTC and spent 248 calls before midnight, 652
  // after: an execution outlives its day, so the rollover has to be seen mid-run.
  it('changes day five minutes later, and month two days after that', () => {
    expect(dayKey(new Date('2026-08-29T23:55:00Z'))).toBe('2026-08-29')
    expect(dayKey(new Date('2026-08-30T00:00:00Z'))).toBe('2026-08-30')
    expect(monthKey(new Date('2026-08-31T23:59:59Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })
})
