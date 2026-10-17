import { describe, expect, it } from 'vitest'
import { computeProfile, maxConsecutiveDaysOff, parseOpeningHours } from '@/lib/hours'
import type { GoogleOpeningHours, GooglePeriod } from '@/lib/hours'

/** Google numbers 0 = Sunday, 1 = Monday … 6 = Saturday. */
const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6

const p = (openDay: number, openH: number, openM: number, closeDay: number, closeH: number, closeM: number) => ({
  open: { day: openDay, hour: openH, minute: openM },
  close: { day: closeDay, hour: closeH, minute: closeM },
})

const hours = (...periods: GooglePeriod[]): GoogleOpeningHours => ({ periods })

const profileOf = (h: GoogleOpeningHours | null, headcountCode?: string | null) =>
  computeProfile({ windows: parseOpeningHours(h), headcountCode })

// ─────────────────────────────────────────────────────────────
// The three Google pitfalls. These break silently, so they run first.
// ─────────────────────────────────────────────────────────────
describe('Google conversion pitfalls', () => {
  it('numbers Sunday 0 on the Google side and 7 on the application side', () => {
    const w = parseOpeningHours(hours(p(SUN, 12, 0, SUN, 15, 0)))
    expect(w).toHaveLength(1)
    expect(w[0].day).toBe(7)
  })

  it('folds a past-midnight close back onto the opening day, beyond 1440', () => {
    // Saturday 7 p.m. -> Sunday 1:30 a.m. Google dates the close to Sunday.
    const w = parseOpeningHours(hours(p(SAT, 19, 0, SUN, 1, 30)))
    expect(w).toHaveLength(1)
    expect(w[0].day).toBe(6)          // stays attached to Saturday
    expect(w[0].opensAt).toBe(19 * 60) // 1140
    expect(w[0].closesAt).toBe(1530)   // 1440 + 90, not 90
  })

  it('treats an open point without a close as round-the-clock opening', () => {
    const w = parseOpeningHours({ periods: [{ open: { day: SUN, hour: 0, minute: 0 } }] })
    expect(w).toHaveLength(7)
    expect(w.every((x) => x.opensAt === 0 && x.closesAt === 1440)).toBe(true)

    const profile = computeProfile({ windows: w })
    expect(profile.openDaysCount).toBe(7)
    expect(profile.splitShiftRisk).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────
// Periods longer than a day. Google merges consecutive "Open 24 hours" days into ONE
// period, so the days in the middle never appear on their own.
// ─────────────────────────────────────────────────────────────
describe('periods spanning several days', () => {
  it('spreads Friday 15:00 -> Sunday 00:00 over Friday and all of Saturday', () => {
    // Google displays it "Friday: 3:00 PM – 12:00 AM / Saturday: Open 24 hours".
    expect(parseOpeningHours(hours(p(FRI, 15, 0, SUN, 0, 0)))).toEqual([
      { day: 5, opensAt: 900, closesAt: 1440 },
      { day: 6, opensAt: 0, closesAt: 1440 },
    ])
  })

  it('does not hand a free weekend to a bar open all of Saturday', () => {
    const profile = profileOf(hours(
      p(MON, 15, 0, TUE, 1, 0), p(TUE, 15, 0, WED, 1, 0), p(WED, 15, 0, THU, 1, 0),
      p(THU, 15, 0, FRI, 1, 0), p(FRI, 15, 0, SUN, 0, 0),
    ))
    expect(profile.closedDays).toEqual([7])
    expect(profile.closedSaturday).toBe(false)
    expect(profile.closedWeekend).toBe(false)
    expect(profile.maxConsecutiveDaysOff).toBe(1)
  })

  it('reads a café open around the clock Monday to Saturday as closed on Sunday only', () => {
    // A single period, displayed "Monday … Saturday: Open 24 hours / Sunday: Closed".
    const profile = profileOf(hours(p(MON, 0, 0, SUN, 0, 0)))
    expect(profile.openDaysCount).toBe(6)
    expect(profile.closedDays).toEqual([7])
    expect(profile.maxConsecutiveDaysOff).toBe(1)
  })

  it('opens Sunday when Saturday evening runs through to Monday, across the week wrap', () => {
    // "Saturday: 6:00 PM – 12:00 AM / Sunday: Open 24 hours".
    const profile = profileOf(hours(
      p(MON, 18, 0, TUE, 0, 0), p(TUE, 18, 0, WED, 0, 0), p(WED, 18, 0, THU, 0, 0),
      p(THU, 18, 0, FRI, 0, 0), p(FRI, 18, 0, SAT, 2, 0), p(SAT, 18, 0, MON, 0, 0),
    ))
    expect(profile.closedDays).toEqual([])
    expect(profile.closedSunday).toBe(false)
  })

  it('keeps the final past-midnight close on the last full day, and the weekly total intact', () => {
    // Monday 11:00 -> Wednesday 1:00: Monday, all of Tuesday, then Tuesday night until 1 a.m.
    const w = parseOpeningHours(hours(p(MON, 11, 0, WED, 1, 0)))
    expect(w).toEqual([
      { day: 1, opensAt: 660, closesAt: 1440 },
      { day: 2, opensAt: 0, closesAt: 1500 },
    ])
    expect(computeProfile({ windows: w }).weeklyOpenMinutes).toBe(38 * 60)
  })

  it('still files a one-night period under its opening day, even when it closes after dawn', () => {
    // "Saturday: 11:00 PM – 7:00 AM / Sunday: Closed": the night is Saturday's.
    const profile = profileOf(hours(
      p(WED, 23, 0, THU, 5, 0), p(THU, 23, 0, FRI, 7, 0),
      p(FRI, 23, 0, SAT, 7, 0), p(SAT, 23, 0, SUN, 7, 0),
    ))
    expect(profile.closedDays).toEqual([1, 2, 7])
  })
})

// ─────────────────────────────────────────────────────────────
// The tail of the night before. Google sometimes files the end of an evening service
// under the next day: "Monday: 12:00 – 3:00 AM, 11:00 AM – 11:59 PM".
// ─────────────────────────────────────────────────────────────
describe('the tail of the night before', () => {
  const EVERY_DAY = [SUN, MON, TUE, WED, THU, FRI, SAT]

  it('is not a split shift: midnight to 3 a.m., then 11 a.m. to midnight', () => {
    const profile = profileOf(hours(
      ...EVERY_DAY.flatMap((d) => [p(d, 0, 0, d, 3, 0), p(d, 11, 0, d, 23, 59)]),
    ))
    expect(profile.splitDaysCount).toBe(0)
    expect(profile.splitShiftRisk).toBe('none')
    expect(profile.servicePattern).toBe('continuous')
    expect(profile.explanation).toBe('Sans coupure — service continu (11h-23h59)')
  })

  it('does not turn a bar open every evening into a split shift on the one day it appears', () => {
    // 17:00 -> 1:00 every day but Sunday, plus a lone midnight-to-1 a.m. hour on Monday.
    const profile = profileOf(hours(
      p(MON, 0, 0, MON, 1, 0),
      p(MON, 17, 0, TUE, 1, 0), p(TUE, 17, 0, WED, 1, 0), p(WED, 17, 0, THU, 1, 0),
      p(THU, 17, 0, FRI, 1, 0), p(FRI, 17, 0, SAT, 1, 0), p(SAT, 17, 0, SUN, 1, 0),
    ), '11')
    expect(profile.splitDaysCount).toBe(0)
    expect(profile.splitShiftRisk).toBe('none')
    expect(profile.servicePattern).toBe('dinner_only')
    // Ignored as a service, not as opening hours: the days off do not move.
    expect(profile.closedDays).toEqual([7])
  })

  it('leaves a real split shift alone, and keeps the tail out of its explanation', () => {
    const profile = profileOf(hours(
      p(TUE, 0, 0, TUE, 1, 0), p(TUE, 11, 0, TUE, 14, 0), p(TUE, 18, 0, TUE, 23, 30),
    ), null)
    expect(profile.splitDaysCount).toBe(1)
    expect(profile.explanation).toBe('Coupure probable — ouvert 11h-14h puis 18h-23h30, effectif inconnu')
  })

  it('counts a window opening at midnight as a service when it runs past dawn', () => {
    const profile = profileOf(hours(p(FRI, 0, 0, FRI, 14, 0), p(FRI, 18, 0, FRI, 23, 0)), '02')
    expect(profile.splitDaysCount).toBe(1)
  })

  it('keeps a midnight window as the service of a day that has nothing else', () => {
    // A club whose hours were entered from midnight: "Friday: 12:00 – 5:00 AM".
    const profile = profileOf(hours(p(FRI, 0, 0, FRI, 5, 0), p(SAT, 0, 0, SAT, 5, 0)))
    expect(profile.closedDays).toEqual([1, 2, 3, 4, 7])
    expect(profile.explanation).toContain('(0h-5h)')
  })
})

// ─────────────────────────────────────────────────────────────
// Ordinary cases
// ─────────────────────────────────────────────────────────────
describe('ordinary cases', () => {
  it('treats a day missing from the periods as closed, without erroring', () => {
    const profile = profileOf(hours(p(TUE, 12, 0, TUE, 15, 0)))
    expect(profile.openDaysCount).toBe(1)
    expect(profile.closedDays).toEqual([1, 3, 4, 5, 6, 7])
  })

  it('accepts a total absence of opening hours without crashing', () => {
    for (const empty of [null, {}, { periods: [] }] as (GoogleOpeningHours | null)[]) {
      const profile = profileOf(empty)
      expect(profile.hasHours).toBe(false)
      expect(profile.splitShiftRisk).toBe('unknown')
      expect(profile.confidence).toBe('unverified')
    }
  })

  it('asserts NOTHING about the days off when there are no hours', () => {
    // The regression this locks down: an absence of hours used to read as "closed all
    // seven days", so a establishment nobody knows anything about satisfied both the
    // weekend filter and the two-days-off one. See D29.
    for (const empty of [null, {}, { periods: [] }] as (GoogleOpeningHours | null)[]) {
      const profile = profileOf(empty)
      expect(profile.closedDays).toEqual([])
      expect(profile.closedSaturday).toBe(false)
      expect(profile.closedSunday).toBe(false)
      expect(profile.closedWeekend).toBe(false)
      expect(profile.maxConsecutiveDaysOff).toBe(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// Split-shift detection
// ─────────────────────────────────────────────────────────────
describe('split-shift detection', () => {
  it('detects a classic 12h-14h30 / 19h-22h30 split shift', () => {
    const profile = profileOf(hours(
      p(TUE, 12, 0, TUE, 14, 30),
      p(TUE, 19, 0, TUE, 22, 30),
    ), '02')
    expect(profile.splitDaysCount).toBe(1)
    expect(profile.servicePattern).toBe('split')
  })

  it('does NOT count a short gap as a split shift', () => {
    // 14h30 -> 15h30: a lull in service, it frees nobody.
    const profile = profileOf(hours(
      p(TUE, 12, 0, TUE, 14, 30),
      p(TUE, 15, 30, TUE, 22, 0),
    ), '02')
    expect(profile.splitDaysCount).toBe(0)
    expect(profile.splitShiftRisk).toBe('none')
  })

  it('recognises a continuous service', () => {
    const profile = profileOf(hours(p(TUE, 11, 0, TUE, 23, 0)), '02')
    expect(profile.servicePattern).toBe('continuous')
    expect(profile.splitShiftRisk).toBe('none')
  })

  it('recognises a lunch-only service', () => {
    const profile = profileOf(hours(
      p(MON, 12, 0, MON, 15, 0),
      p(TUE, 12, 0, TUE, 15, 0),
    ), '02')
    expect(profile.servicePattern).toBe('lunch_only')
    expect(profile.splitShiftRisk).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────
// Days off — the walk has to be circular
// ─────────────────────────────────────────────────────────────
describe('days off', () => {
  it('counts Sunday + Monday as two consecutive days', () => {
    expect(maxConsecutiveDaysOff([7, 1])).toBe(2)
  })

  it('counts Saturday + Sunday as two consecutive days', () => {
    expect(maxConsecutiveDaysOff([6, 7])).toBe(2)
  })

  it('does not join two days off that are apart', () => {
    expect(maxConsecutiveDaysOff([1, 4])).toBe(1)
  })

  it('spots the Sunday + Monday closing on a real profile', () => {
    const profile = profileOf(hours(
      p(TUE, 12, 0, TUE, 15, 0), p(WED, 12, 0, WED, 15, 0),
      p(THU, 12, 0, THU, 15, 0), p(FRI, 12, 0, FRI, 15, 0),
      p(SAT, 12, 0, SAT, 15, 0),
    ))
    expect(profile.closedDays).toEqual([1, 7])
    expect(profile.maxConsecutiveDaysOff).toBe(2)
    expect(profile.closedSunday).toBe(true)
    expect(profile.closedWeekend).toBe(false) // Saturday is open
  })

  it('spots a fully free weekend', () => {
    const profile = profileOf(hours(
      p(MON, 12, 0, MON, 15, 0), p(TUE, 12, 0, TUE, 15, 0),
      p(WED, 12, 0, WED, 15, 0), p(THU, 12, 0, THU, 15, 0),
      p(FRI, 12, 0, FRI, 15, 0),
    ))
    expect(profile.closedWeekend).toBe(true)
    expect(profile.maxConsecutiveDaysOff).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────
// The heart of it: opening hours != working hours
// ─────────────────────────────────────────────────────────────
describe('inferring the risk borne by the employee', () => {
  const splitShift = hours(
    p(TUE, 12, 0, TUE, 14, 30),
    p(TUE, 19, 0, TUE, 22, 30),
  )

  it('small team: the split shift is mechanically certain', () => {
    const profile = profileOf(splitShift, '02') // 3 to 5 employees
    expect(profile.splitShiftRisk).toBe('high')
    expect(profile.confidence).toBe('confirmed')
  })

  it('large team: two brigades are likely', () => {
    const profile = profileOf(splitShift, '12') // 20 to 49 employees
    expect(profile.splitShiftRisk).toBe('low')
  })

  it('medium team: intermediate risk', () => {
    const profile = profileOf(splitShift, '11') // 10 to 19 employees
    expect(profile.splitShiftRisk).toBe('medium')
  })

  it('unknown headcount: degrades the confidence instead of asserting', () => {
    const profile = profileOf(splitShift, null)
    expect(profile.confidence).toBe('likely')
    expect(profile.splitShiftRisk).toBe('high') // cautious assumption
  })

  // D31: the 70 h threshold separated 39% of two-brigade teams from 38%. It used to soften
  // exactly this case to "Coupure possible — forte amplitude".
  it('unknown headcount: a wide weekly amplitude no longer softens the verdict', () => {
    const EVERY_DAY = [SUN, MON, TUE, WED, THU, FRI, SAT]
    const profile = profileOf(hours(
      ...EVERY_DAY.flatMap((d) => [p(d, 10, 0, d, 15, 0), p(d, 18, 0, d, 23, 30)]),
    ), null)
    expect(profile.weeklyOpenMinutes).toBeGreaterThan(70 * 60)
    expect(profile.splitShiftRisk).toBe('high')
    expect(profile.confidence).toBe('likely')
    expect(profile.explanation).toBe('Coupure probable — ouvert 10h-15h puis 18h-23h30, effectif inconnu')
  })

  it('contract catering short-circuits the headcount reasoning', () => {
    const profile = computeProfile({
      windows: parseOpeningHours(hours(p(TUE, 7, 0, TUE, 15, 0))),
      headcountCode: '02',
      category: 'canteen',
    })
    expect(profile.splitShiftRisk).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────
// Explainability: a verdict is never shown without its reason
// ─────────────────────────────────────────────────────────────
describe('explainability', () => {
  it('states the hours AND the headcount in the explanation', () => {
    const profile = profileOf(hours(
      p(TUE, 12, 0, TUE, 14, 30),
      p(TUE, 19, 0, TUE, 22, 30),
    ), '02')
    expect(profile.explanation).toBe(
      'Coupure très probable — ouvert 12h-14h30 puis 19h-22h30, 3 à 5 salariés',
    )
  })

  it('flags an unknown headcount explicitly', () => {
    const profile = profileOf(hours(
      p(TUE, 12, 0, TUE, 14, 30),
      p(TUE, 19, 0, TUE, 22, 30),
    ), null)
    expect(profile.explanation).toBe('Coupure probable — ouvert 12h-14h30 puis 19h-22h30, effectif inconnu')
  })

  it('never displays a numeric score', () => {
    const profile = profileOf(hours(p(TUE, 11, 0, TUE, 23, 0)), '02')
    expect(profile.explanation).not.toMatch(/\d+\s*%|0\.\d/)
  })
})
