/**
 * What the current quota period still allows.
 *
 * The ceiling used to be counted per sweep, which deadlocked the moment a sweep outlasted
 * the quota that pays for it: the run's total can only rise, so a resume could never spend
 * again (D28). It now counts the calendar month, the period Google actually bills.
 *
 * Kept free of any database import on purpose: lib/db/client throws at import time without
 * DATABASE_URL, and this is the part that has to be unit-testable.
 *
 * See .specs/technique/10-reprise-du-balayage.md
 */

/**
 * The month is Google's, not ours.
 *
 * Cloud Billing rolls its cycle over at midnight Pacific. Counting UTC months would open an
 * eight-hour window at the start of every month during which our counter has reset and
 * Google's has not — and the monthly cycle fires inside it. A sweep that spent the whole
 * ceiling in the previous period could spend it again, in the same billed month, straight
 * onto the card.
 *
 * `Intl` rather than an offset constant: Pacific is -8 or -7 depending on the date, and a
 * fixed offset would be wrong for half the year.
 */
const QUOTA_TIME_ZONE = 'America/Los_Angeles'

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
})

/** A half-open window, `[start, end)`. Both bounds, so a period can be counted exactly. */
export interface Window {
  start: Date
  end: Date
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsIn(date: Date): Parts {
  const p = Object.fromEntries(PARTS.formatToParts(date).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  }
}

/** Offset of the quota zone at `date`, in milliseconds, positive east of UTC. */
function offsetMs(date: Date): number {
  const p = partsIn(date)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

/**
 * The UTC instant of local midnight on a given local date.
 *
 * Two passes: the first offset is read at the wrong instant whenever the boundary itself
 * falls near a daylight-saving change, and the second reads it at the corrected one.
 */
function localMidnightUtc(year: number, monthIndex: number, day: number): Date {
  const naive = Date.UTC(year, monthIndex, day)
  const once = naive - offsetMs(new Date(naive))
  return new Date(naive - offsetMs(new Date(once)))
}

/**
 * The calendar month containing `now`, closed at both ends.
 *
 * Closed rather than open-ended: counting "everything since the 1st" is the same thing only
 * while the clock is the real one. Under a simulated one it folds later periods into the
 * current count, which would make the very tool built to check this behaviour lie.
 */
export function monthWindow(now: Date): Window {
  const { year, month } = partsIn(now)
  return {
    start: localMidnightUtc(year, month - 1, 1),
    // Month index 12 rolls into January of the next year on its own.
    end: localMidnightUtc(year, month, 1),
  }
}

/** '2026-08' — comparable and printable, which is what the rollover check needs. */
export function monthKey(now: Date): string {
  const { year, month } = partsIn(now)
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * Calls the period still allows.
 *
 * Nothing carries over from one period to the next, in either direction: the leftovers of a
 * period are not credited to the following one, and an overspent period reads 0 rather than
 * charging its excess to the next.
 */
export function callsLeft(spent: number, ceiling: number): number {
  return Math.max(0, ceiling - spent)
}
