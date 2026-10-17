import { describe, expect, it } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm'
import { errorReason } from '@/lib/error-reason'

describe('errorReason', () => {
  it("reports the driver's error, not the query drizzle wraps it in", () => {
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:5434')
    const wrapped = new DrizzleQueryError('select "id" from "cell" where "sweep_run_id" = $1', ['r1'], refused)

    expect(wrapped.message).toMatch(/^Failed query:/)
    expect(errorReason(wrapped)).toBe('connect ECONNREFUSED 127.0.0.1:5434')
  })

  it('reads every attempt of a refused localhost, whose own message is empty', () => {
    const refused = new AggregateError([
      new Error('connect ECONNREFUSED ::1:5434'),
      new Error('connect ECONNREFUSED 127.0.0.1:5434'),
    ])
    const wrapped = new DrizzleQueryError('select 1', [], refused)

    expect(errorReason(wrapped)).toBe('connect ECONNREFUSED ::1:5434; connect ECONNREFUSED 127.0.0.1:5434')
  })

  it("keeps the error's own message when nothing caused it", () => {
    expect(errorReason(new Error('3 cell(s) still owed'))).toBe('3 cell(s) still owed')
  })

  it('prints a thrown value that is not an Error', () => {
    expect(errorReason('boom')).toBe('boom')
  })
})
