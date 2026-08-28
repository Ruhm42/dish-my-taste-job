import type { DayOfWeek, GoogleOpeningHours, GooglePeriod, ServiceWindow } from './types'

const MINUTES_PER_DAY = 1440

/** Google: 0 = Sunday. Us: 1 = Monday, 7 = Sunday. */
function toDayOfWeek(googleDay: number): DayOfWeek {
  return (googleDay === 0 ? 7 : googleDay) as DayOfWeek
}

/**
 * A place open around the clock returns an open point with NO matching close.
 * That is the only case where `close` is absent.
 */
function isAlwaysOpen(periods: GooglePeriod[]): boolean {
  return periods.some((p) => p.open && !p.close)
}

function allDayWindows(): ServiceWindow[] {
  return ([1, 2, 3, 4, 5, 6, 7] as DayOfWeek[]).map((day) => ({
    day,
    opensAt: 0,
    closesAt: MINUTES_PER_DAY,
  }))
}

/**
 * Converts Google opening hours into normalized service windows.
 *
 * Three pitfalls are handled here, and nowhere else:
 *  - `day` 0 means Sunday, not Monday
 *  - a past-midnight close carries the NEXT day: we fold it back onto the opening
 *    day by letting the value exceed 1440
 *  - an open point without a close means 24/7
 *
 * A closed day is simply absent from the periods: it is not an empty range.
 */
export function parseOpeningHours(hours: GoogleOpeningHours | null | undefined): ServiceWindow[] {
  const periods = hours?.periods
  if (!periods || periods.length === 0) return []

  if (isAlwaysOpen(periods)) return allDayWindows()

  const windows: ServiceWindow[] = []

  for (const period of periods) {
    if (!period.open || !period.close) continue

    const day = toDayOfWeek(period.open.day)
    const opensAt = period.open.hour * 60 + period.open.minute
    const rawCloseMin = period.close.hour * 60 + period.close.minute

    // Day gap between open and close, accounting for the Saturday -> Sunday wrap.
    // Equals 0 (same day) or 1 (past midnight).
    const dayGap = (period.close.day - period.open.day + 7) % 7
    let closesAt = dayGap * MINUTES_PER_DAY + rawCloseMin

    // Safety net: a close earlier than the open on the same day is a mislabelled
    // past-midnight close.
    if (closesAt <= opensAt) closesAt += MINUTES_PER_DAY

    windows.push({ day, opensAt, closesAt })
  }

  return sortWindows(windows)
}

export function sortWindows(windows: ServiceWindow[]): ServiceWindow[] {
  return [...windows].sort((a, b) => a.day - b.day || a.opensAt - b.opensAt)
}

export function windowsForDay(windows: ServiceWindow[], day: DayOfWeek): ServiceWindow[] {
  return windows.filter((w) => w.day === day).sort((a, b) => a.opensAt - b.opensAt)
}

/** French display format, it ends up in user-facing text: 750 -> "12h30", 720 -> "12h", 1530 -> "1h30" (next day). */
export function formatTime(minutes: number): string {
  const m = minutes % MINUTES_PER_DAY
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`
}
