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
 * Four pitfalls are handled here, and nowhere else:
 *  - `day` 0 means Sunday, not Monday
 *  - a past-midnight close carries the NEXT day: we fold it back onto the opening
 *    day by letting the value exceed 1440
 *  - an open point without a close means 24/7
 *  - consecutive "Open 24 hours" days come merged into ONE period, Friday 15:00 to
 *    Sunday 00:00: we spread it over every day it covers
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

    const opensAt = period.open.hour * 60 + period.open.minute
    const rawCloseMin = period.close.hour * 60 + period.close.minute

    // Calendar days from open to close, accounting for the Saturday -> Sunday wrap.
    let dayGap = (period.close.day - period.open.day + 7) % 7

    // Safety net: a close earlier than the open on the same day is a mislabelled
    // past-midnight close.
    if (dayGap === 0 && rawCloseMin <= opensAt) dayGap = 1

    // Every midnight the period crosses starts a new day, except the last one: the final
    // close stays on the day before, past 1440, exactly like an ordinary overnight close.
    // Filed whole under its opening day, Friday 15:00 to Sunday 00:00 left Saturday
    // reading as closed — a false "week-end libre" on a bar open all of Saturday.
    const days = Math.max(dayGap, 1)
    for (let k = 0; k < days; k++) {
      windows.push({
        day: toDayOfWeek((period.open.day + k) % 7),
        opensAt: k === 0 ? opensAt : 0,
        closesAt: k < days - 1 ? MINUTES_PER_DAY : (dayGap - k) * MINUTES_PER_DAY + rawCloseMin,
      })
    }
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
