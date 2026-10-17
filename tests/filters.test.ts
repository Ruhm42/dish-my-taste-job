import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildUserConditions, countActive, parseFilters } from '@/lib/filters'

// D31 rule 3: "Oui ou probablement" only added the eight "peu probable" rows to "Oui" —
// three choices for two answers. The filter is "Sans coupure" or "Peu importe".
describe('the split-shift filter', () => {
  it('keeps "Sans coupure" to the structural certainty, never "peu probable"', () => {
    const q = new PgDialect().sqlToQuery(buildUserConditions(parseFilters({ coupure: 'sans' })) as SQL)
    expect(q.params).toEqual(['none'])
  })

  it('reads a link saved before D31 as "Sans coupure"', () => {
    expect(parseFilters({ coupure: 'sans-ou-probable' }).splitShift).toBe('sans')
  })

  it('reads any other value as no criterion, and does not count it as one', () => {
    for (const coupure of ['', 'oui', 'none']) {
      const f = parseFilters({ coupure })
      expect(f.splitShift).toBe('')
      expect(countActive(f)).toBe(0)
    }
  })
})
