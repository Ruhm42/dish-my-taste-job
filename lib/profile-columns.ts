import type { RhythmProfile, ServiceWindow } from './hours'

/**
 * Maps a `RhythmProfile` onto the columns of the `restaurant` table.
 *
 * Four scripts write these columns — `seed`, `sweep:google`, `match:sirene` and
 * `compute:profiles`. Copied in four places, they end up diverging: a script that
 * forgets `weeklyOpenMinutes` leaves one stale value beside fifteen fresh ones, and
 * nothing signals it since the row exists and looks complete.
 *
 * `category` and `profileComputedAt` are left to the caller: the first is not derived
 * from the profile, the second dates the run rather than the computation.
 */
export function profileColumns(windows: ServiceWindow[], profile: RhythmProfile) {
  return {
    schedule: windows,
    hasHours: profile.hasHours,
    openDaysCount: profile.openDaysCount,
    closedDays: profile.closedDays,
    closedSaturday: profile.closedSaturday,
    closedSunday: profile.closedSunday,
    closedWeekend: profile.closedWeekend,
    maxConsecutiveDaysOff: profile.maxConsecutiveDaysOff,
    splitDaysCount: profile.splitDaysCount,
    splitShiftRisk: profile.splitShiftRisk,
    confidence: profile.confidence,
    servicePattern: profile.servicePattern,
    earliestOpenMin: profile.earliestOpenMin,
    latestCloseMin: profile.latestCloseMin,
    weeklyOpenMinutes: profile.weeklyOpenMinutes,
    explanation: profile.explanation,
  }
}
