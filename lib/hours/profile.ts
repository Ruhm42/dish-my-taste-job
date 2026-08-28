import { formatTime, sortWindows, windowsForDay } from './parse'
import type {
  Category, Confidence, DayOfWeek, RhythmProfile, ServicePattern,
  ServiceWindow, SplitShiftRisk, TeamSize,
} from './types'

/**
 * Minimum gap, in minutes, past which two services count as a split shift.
 * 14h30 -> 19h is 270 min: the employee goes home, that is a real split shift.
 * 14h30 -> 15h30 is 60 min: that is a lull in service, it frees nobody.
 * Tunable — it is an assumption to confront with the field, not a truth.
 */
export const SPLIT_GAP_MIN = 120

/** Lunch / dinner boundary, used to tell a single service from a continuous one. */
const DINNER_BOUNDARY_MIN = 17 * 60

const ALL_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7]

const TEAM_SIZE_BY_HEADCOUNT_CODE: Record<string, TeamSize> = {
  '00': 'small', '01': 'small', '02': 'small',
  '03': 'medium', '11': 'medium',
  '12': 'large', '21': 'large', '22': 'large', '31': 'large',
  '32': 'large', '41': 'large', '42': 'large', '51': 'large',
  '52': 'large', '53': 'large',
}

/** French labels: they are spliced verbatim into the explanation shown to the user. */
const HEADCOUNT_LABELS: Record<string, string> = {
  '00': 'aucun salarié', '01': '1 à 2 salariés', '02': '3 à 5 salariés',
  '03': '6 à 9 salariés', '11': '10 à 19 salariés', '12': '20 à 49 salariés',
  '21': '50 à 99 salariés', '22': '100 à 199 salariés',
}

export function teamSize(headcountCode: string | null | undefined): TeamSize {
  if (!headcountCode) return 'unknown'
  return TEAM_SIZE_BY_HEADCOUNT_CODE[headcountCode] ?? 'unknown'
}

function headcountLabel(code: string | null | undefined): string | null {
  return code ? (HEADCOUNT_LABELS[code] ?? null) : null
}

/** A day carries a split shift when two of its services are at least SPLIT_GAP_MIN apart. */
export function dayHasSplitShift(windows: ServiceWindow[]): boolean {
  for (let i = 1; i < windows.length; i++) {
    if (windows[i].opensAt - windows[i - 1].closesAt >= SPLIT_GAP_MIN) return true
  }
  return false
}

/**
 * Longest run of closed days, walked CIRCULARLY: Sunday followed by Monday counts
 * as two consecutive days. A linear walk would miss the Sunday + Monday pattern,
 * which happens to be one of the most sought after.
 */
export function maxConsecutiveDaysOff(closedDays: DayOfWeek[]): number {
  if (closedDays.length === 0) return 0
  if (closedDays.length === 7) return 7

  const closed = ALL_DAYS.map((d) => closedDays.includes(d))
  let max = 0
  let current = 0
  // Two laps, to cover the Sunday -> Monday wrap.
  for (let i = 0; i < 14; i++) {
    current = closed[i % 7] ? current + 1 : 0
    if (current > max) max = current
  }
  return Math.min(max, 7)
}

function inferServicePattern(
  windows: ServiceWindow[],
  openDays: DayOfWeek[],
  splitDays: number,
): ServicePattern {
  if (openDays.length === 0) return 'mixed'
  if (splitDays > 0) return 'split'

  const perDay = openDays.map((d) => windowsForDay(windows, d))
  const singleService = perDay.every((w) => w.length === 1)
  if (!singleService) return 'mixed'

  if (perDay.every((w) => w[0].closesAt <= DINNER_BOUNDARY_MIN)) return 'lunch_only'
  if (perDay.every((w) => w[0].opensAt >= DINNER_BOUNDARY_MIN)) return 'dinner_only'
  if (perDay.every((w) => w[0].opensAt < DINNER_BOUNDARY_MIN && w[0].closesAt > DINNER_BOUNDARY_MIN)) {
    return 'continuous'
  }
  return 'mixed'
}

/** The most telling day to illustrate the verdict: the one that carries the split shift. */
function representativeDay(windows: ServiceWindow[], openDays: DayOfWeek[]): ServiceWindow[] {
  for (const d of openDays) {
    const w = windowsForDay(windows, d)
    if (dayHasSplitShift(w)) return w
  }
  return openDays.length ? windowsForDay(windows, openDays[0]) : []
}

/** French fragment: "12h-14h30 puis 19h-22h30". */
function describeServices(windows: ServiceWindow[]): string {
  if (windows.length === 0) return ''
  return windows.map((w) => `${formatTime(w.opensAt)}-${formatTime(w.closesAt)}`).join(' puis ')
}

export interface ProfileInput {
  windows: ServiceWindow[]
  headcountCode?: string | null
  category?: Category
}

/**
 * Translates OPENING hours into a split-shift risk for the EMPLOYEE.
 *
 * A restaurant open at lunch and at dinner only imposes a split shift when it has a
 * single brigade: at 25 employees two teams take turns, at 4 it is mechanically
 * impossible. Hence the cross-check against headcount.
 * See .specs/technique/05-inference-des-horaires.md
 */
export function computeProfile({ windows: raw, headcountCode, category }: ProfileInput): RhythmProfile {
  const windows = sortWindows(raw)
  const openDays = ALL_DAYS.filter((d) => windowsForDay(windows, d).length > 0)
  const closedDays = ALL_DAYS.filter((d) => !openDays.includes(d))

  const hasHours = windows.length > 0
  const splitDaysCount = openDays.filter((d) => dayHasSplitShift(windowsForDay(windows, d))).length
  const weeklyOpenMinutes = windows.reduce((total, w) => total + (w.closesAt - w.opensAt), 0)
  const size = teamSize(headcountCode)

  const base = {
    hasHours,
    openDaysCount: openDays.length,
    closedDays,
    closedSaturday: closedDays.includes(6),
    closedSunday: closedDays.includes(7),
    closedWeekend: closedDays.includes(6) && closedDays.includes(7),
    maxConsecutiveDaysOff: maxConsecutiveDaysOff(closedDays),
    splitDaysCount,
    servicePattern: inferServicePattern(windows, openDays, splitDaysCount),
    earliestOpenMin: hasHours ? Math.min(...windows.map((w) => w.opensAt)) : null,
    latestCloseMin: hasHours ? Math.max(...windows.map((w) => w.closesAt)) : null,
    weeklyOpenMinutes,
  }

  const { splitShiftRisk, confidence, explanation } = inferSplitShift({
    hasHours, category, splitDaysCount, size, headcountCode, weeklyOpenMinutes,
    pattern: base.servicePattern,
    services: describeServices(representativeDay(windows, openDays)),
  })

  return { ...base, splitShiftRisk, confidence, explanation }
}

function inferSplitShift(ctx: {
  hasHours: boolean
  category?: Category
  splitDaysCount: number
  size: TeamSize
  headcountCode?: string | null
  weeklyOpenMinutes: number
  pattern: ServicePattern
  services: string
}): { splitShiftRisk: SplitShiftRisk; confidence: Confidence; explanation: string } {
  const {
    hasHours, category, splitDaysCount, size, headcountCode, weeklyOpenMinutes, pattern, services,
  } = ctx

  // 1. Nothing to infer from.
  if (!hasHours) {
    return {
      splitShiftRisk: 'unknown',
      confidence: 'unverified',
      explanation: 'Horaires inconnus — à vérifier sur Google',
    }
  }

  // 2 and 3. Structural certainties: they short-circuit the headcount reasoning.
  if (category === 'canteen') {
    return {
      splitShiftRisk: 'none',
      confidence: 'confirmed',
      explanation: `Sans coupure — restauration collective, horaires de journée (${services})`,
    }
  }

  if (splitDaysCount === 0) {
    const reason =
      pattern === 'lunch_only' ? 'service du midi uniquement'
      : pattern === 'dinner_only' ? 'service du soir uniquement'
      : pattern === 'mixed' ? 'services rapprochés'
      : 'service continu'
    return {
      splitShiftRisk: 'none',
      confidence: 'confirmed',
      explanation: `Sans coupure — ${reason} (${services})`,
    }
  }

  // 4. The opening hours do carry a split: it all hangs on how many brigades are possible.
  const headcount = headcountLabel(headcountCode)

  if (size !== 'unknown' && headcount) {
    const risk: SplitShiftRisk = size === 'small' ? 'high' : size === 'medium' ? 'medium' : 'low'
    const likelihood = size === 'small' ? 'très probable' : size === 'medium' ? 'possible' : 'peu probable'
    return {
      splitShiftRisk: risk,
      confidence: 'confirmed',
      explanation: `Coupure ${likelihood} — ouvert ${services}, ${headcount}`,
    }
  }

  // Fallback: headcount is unknown, which is common among small businesses — precisely
  // where the information matters most. We infer from the weekly amplitude, and degrade
  // the confidence visibly rather than asserting.
  const wideAmplitude = weeklyOpenMinutes > 70 * 60
  return {
    splitShiftRisk: wideAmplitude ? 'medium' : 'high',
    confidence: 'likely',
    explanation: wideAmplitude
      ? `Coupure possible — ouvert ${services}, forte amplitude, effectif inconnu`
      : `Coupure probable — ouvert ${services}, effectif inconnu`,
  }
}
