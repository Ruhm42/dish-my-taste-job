import { describe, expect, it } from 'vitest'
import { cycleNotice } from '@/lib/cycle-notice'

const facts = {
  backlog: 609, awaiting: 331, robustCost: 622, knownCost: 560, ceiling: 900,
  forecast: 0.915, horizon: new Date('2026-11-16T16:00:00Z'),
}

describe('the annotation a live cycle leaves (D39 rule 4)', () => {
  it('leaves a notice under GitHub Actions, green or red', () => {
    const line = cycleNotice(facts, { GITHUB_ACTIONS: 'true' })
    expect(line).toMatch(/^::notice title=Refresh cycle::/)
    expect(line).toContain('cover 622 cells robust')
    // `%` is workflow-command syntax: unescaped, GitHub would read 91.5% as an escape.
    expect(line).toContain('91.5%25')
  })

  it('leaves nothing outside GitHub Actions', () => {
    expect(cycleNotice(facts, {})).toBeNull()
  })
})
