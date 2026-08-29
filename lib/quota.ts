/**
 * What the current quota period still allows.
 *
 * The ceiling used to be counted per sweep, which deadlocked the moment a sweep outlasted
 * the quota that pays for it: the run's total can only rise, so a resume could never spend
 * again (D28). It now counts the **calendar month**, because that is the period Google
 * actually bills.
 *
 * Kept free of any database import on purpose: lib/db/client throws at import time without
 * DATABASE_URL, and this is the part that has to be unit-testable.
 *
 * See .specs/technique/10-reprise-du-balayage.md
 */

/** Calls already spent, in each of the two windows a ceiling applies to. */
export interface Spent {
  month: number
  day: number
}

export interface Limits {
  perMonth: number
  perDay: number
}

export interface Headroom {
  /** Calls still allowed. Never negative: a window already overspent reads 0, not -12. */
  left: number
  /** Which of the two ceilings is the binding one — it decides what the operator does next. */
  binding: 'month' | 'day'
}

/** A half-open window, `[start, end)`. Both bounds, so a window can be counted exactly. */
export interface Window {
  start: Date
  end: Date
}

/**
 * Everything here is UTC.
 *
 * Google's per-day quotas actually reset at midnight Pacific, so a UTC day straddles two
 * of theirs. It stays harmless as long as the monthly ceiling caps the total below what a
 * single Pacific day could refuse — and if that ever stops holding, this is the one place
 * to change.
 *
 * Closed at both ends rather than open-ended: counting "everything since the 1st" is the
 * same thing only while the clock is the real one. Under a simulated one it silently folds
 * later periods into the current count, which would make the very tool built to check this
 * behaviour report the wrong number.
 */
export function monthWindow(now: Date): Window {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) }
}

export function dayWindow(now: Date): Window {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  return { start: new Date(Date.UTC(y, m, d)), end: new Date(Date.UTC(y, m, d + 1)) }
}

/** '2026-08' — comparable and printable, which is what the rollover check needs. */
export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/** '2026-08-29' */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Nothing carries over from one window to the next, in either direction: the leftovers of
 * a period are not credited to the following one, and neither is its overspending.
 *
 * Ties go to the month, because it is the stricter remedy: rerunning tomorrow does nothing
 * for a month that is also exhausted.
 */
export function callsLeft(spent: Spent, limits: Limits): Headroom {
  const month = Math.max(0, limits.perMonth - spent.month)
  const day = Math.max(0, limits.perDay - spent.day)
  return month <= day ? { left: month, binding: 'month' } : { left: day, binding: 'day' }
}
