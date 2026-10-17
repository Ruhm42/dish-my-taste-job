import { describe, expect, it } from 'vitest'
import { assign } from '@/lib/sirene-match'
import type { Candidate } from '@/lib/sirene-match'

const ECHO = { restaurant_id: 'r-echo', google_place_id: 'place-echo' }

const pair = (over: Partial<Candidate>): Candidate => ({
  ...ECHO,
  siret: '00000000000000',
  headcount_code: null,
  naf: '56.10A',
  score: 1,
  distance: 21.5,
  ...over,
})

const siretOf = (kept: Map<string, Candidate>, restaurantId: string) => kept.get(restaurantId)?.siret

describe('a tie between duplicate SIRENE records', () => {
  // ─────────────────────────────────────────────────────────────
  // Production, 2026-10-17: three records named L'ECHO DES GALETS
  // share one geocoded point, so they tie on score AND distance.
  // Left to the query plan, the tie went to a different record on
  // each run — the one with bracket 01 or one with none.
  // ─────────────────────────────────────────────────────────────
  const duplicates = [
    pair({ siret: '49955378200016', headcount_code: '01' }),
    pair({ siret: '49916137000014' }),
    pair({ siret: '49916136200011' }),
  ]

  it('goes to the same record whatever order the pairs arrive in', () => {
    const winners = new Set([
      siretOf(assign(duplicates), ECHO.restaurant_id),
      siretOf(assign([...duplicates].reverse()), ECHO.restaurant_id),
      siretOf(assign([duplicates[1], duplicates[0], duplicates[2]]), ECHO.restaurant_id),
    ])
    expect(winners.size).toBe(1)
  })

  it('settles two places tied for one record the same way in either order', () => {
    // Google lists "Shiyo Bar" and "Shiyo - Grand Hôtel-Dieu" at one point, for one record.
    const bar = pair({ restaurant_id: 'r-bar', google_place_id: 'place-bar', siret: '93009802500024' })
    const hall = pair({ restaurant_id: 'r-hall', google_place_id: 'place-hall', siret: '93009802500024' })

    const forward = assign([bar, hall])
    const backward = assign([hall, bar])
    expect([...forward.keys()]).toEqual([...backward.keys()])
    expect(forward.size).toBe(1)
  })
})

describe('what the tie-break must not override', () => {
  it('still takes the better name before the closer record', () => {
    const closer = pair({ siret: '11111111111111', score: 0.6, distance: 3 })
    const better = pair({ siret: '99999999999999', score: 0.9, distance: 60 })
    expect(siretOf(assign([closer, better]), ECHO.restaurant_id)).toBe(better.siret)
  })

  it('still takes the closer record when the names score the same', () => {
    const farther = pair({ siret: '11111111111111', distance: 60 })
    const closer = pair({ siret: '99999999999999', distance: 3 })
    expect(siretOf(assign([farther, closer]), ECHO.restaurant_id)).toBe(closer.siret)
  })

  it('still hands a record to one place only', () => {
    const first = pair({ siret: '49955378200016', score: 1 })
    const second = pair({ restaurant_id: 'r-other', google_place_id: 'place-other', siret: '49955378200016', score: 0.8 })
    const kept = assign([second, first])
    expect(siretOf(kept, ECHO.restaurant_id)).toBe('49955378200016')
    expect(kept.has('r-other')).toBe(false)
  })
})
