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
    expect(profile.explanation).toContain('effectif inconnu')
  })

  it('never displays a numeric score', () => {
    const profile = profileOf(hours(p(TUE, 11, 0, TUE, 23, 0)), '02')
    expect(profile.explanation).not.toMatch(/\d+\s*%|0\.\d/)
  })
})
