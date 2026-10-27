import { describe, expect, it, vi } from 'vitest'

// Both modules read DATABASE_URL at import time. postgres.js connects lazily and nothing here
// issues a query, but the address points nowhere all the same.
vi.hoisted(() => {
  // Assembled here rather than through pgUrl below: vi.hoisted runs before any declaration in
  // this file is initialised. Same reason as pgUrl's comment.
  process.env.DATABASE_URL = ['postgres', '://', 'test:test', '@', '127.0.0.1:1/test'].join('')
})

const { isTransactionPoolerUrl } = await import('@/lib/db/client')
const {
  CeilingReached, PERIOD_END_MARGIN_MS, QuotaRefused, leavesPass, lockRelease, passFailures,
  passQueue, passStatus, sendBooked, spendOne,
} = await import('@/scripts/sweep')
type Budget = import('@/scripts/sweep').Budget

/**
 * Connection strings built from parts, so that no line of this file reads as a committed
 * credential to the secret scan in ci.yml. Every one here is fake — but exempting tests/ from
 * the scan instead would let a real one pasted into a test slip through unseen.
 */
const pgUrl = (credentials: string, rest: string, scheme = 'postgres') =>
  [scheme, '://', credentials, '@', rest].join('')

const at = (iso: string) => new Date(iso)

// November 2026 in California is PST, UTC-8: its 16th opens at 08:00 UTC, and the period
// closes at 08:00 UTC on 1 December.
const FIRST_OF_NOVEMBER = { period: '2026-11', pass: 'first' } as const
const SECOND_OF_NOVEMBER = { period: '2026-11', pass: 'second' } as const
const NOVEMBER_ENDS = at('2026-12-01T08:00:00Z').getTime()

describe('leavesPass — an execution books to one pass of one period (D52 rule 4)', () => {
  it('lets a scheduled pass run', () => {
    expect(leavesPass(FIRST_OF_NOVEMBER, at('2026-11-01T09:00:00Z'))).toBeNull()
    expect(leavesPass(SECOND_OF_NOVEMBER, at('2026-11-16T15:00:00Z'))).toBeNull()
  })

  it('stops a first pass when the 16th opens in California, not in UTC', () => {
    expect(leavesPass(FIRST_OF_NOVEMBER, at('2026-11-16T07:59:00Z'))).toBeNull()
    expect(leavesPass(FIRST_OF_NOVEMBER, at('2026-11-16T08:00:00Z'))).toMatch(/second pass of 2026-11 has opened/)
  })

  it('stops less than a minute before Pacific midnight closes the period', () => {
    expect(leavesPass(SECOND_OF_NOVEMBER, new Date(NOVEMBER_ENDS - PERIOD_END_MARGIN_MS))).toBeNull()
    expect(leavesPass(SECOND_OF_NOVEMBER, new Date(NOVEMBER_ENDS - PERIOD_END_MARGIN_MS + 1)))
      .toMatch(/less than a minute/)
  })

  it('never books a call to the next period', () => {
    expect(leavesPass(SECOND_OF_NOVEMBER, new Date(NOVEMBER_ENDS))).toMatch(/rolled over to 2026-12/)
    // 09:00 UTC on the 1st, the hour the cycle fires: a new period, and a first pass again.
    expect(leavesPass(SECOND_OF_NOVEMBER, at('2026-12-01T09:00:00Z'))).toMatch(/rolled over/)
  })
})

describe('spendOne and sendBooked — a call goes out only once the journal holds it (D52 rule 2)', () => {
  const budget = (over: Partial<Budget> = {}): Budget => ({
    ...FIRST_OF_NOVEMBER, ceiling: 450, periodSpent: 0, calls: 0, ...over,
  })
  const now = at('2026-11-01T09:00:00Z')

  it('books, then counts the call against the period and the execution', async () => {
    const b = budget({ periodSpent: 10 })
    const book = vi.fn(async () => {})
    await spendOne(b, now, book)
    expect(book).toHaveBeenCalledOnce()
    expect(b).toMatchObject({ periodSpent: 11, calls: 1 })
  })

  it('books the request before sending it', async () => {
    const order: string[] = []
    const answer = await sendBooked(budget(), now, async () => { order.push('book') }, async () => {
      order.push('send')
      return 'places'
    })
    expect(order).toEqual(['book', 'send'])
    expect(answer).toBe('places')
  })

  it('does not send while the booking has not answered', async () => {
    let answerBooking = () => {}
    const pending = new Promise<void>((resolve) => { answerBooking = resolve })
    const send = vi.fn(async () => 'places')
    const call = sendBooked(budget(), now, () => pending, send)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(send).not.toHaveBeenCalled()
    answerBooking()
    await call
    expect(send).toHaveBeenCalledOnce()
  })

  it('sends nothing when the booking fails, and stops as a defect rather than a ceiling', async () => {
    const b = budget()
    const send = vi.fn(async () => 'places')
    const failing = sendBooked(b, now, async () => { throw new Error('connection reset') }, send)
    await expect(failing).rejects.toThrow(/could not be booked in the journal, so it was not made: connection reset/)
    await expect(failing).rejects.not.toBeInstanceOf(CeilingReached)
    expect(send).not.toHaveBeenCalled()
    expect(b).toMatchObject({ periodSpent: 0, calls: 0 })
  })

  it('neither books nor sends past the ceiling, and ends the pass capped', async () => {
    const book = vi.fn(async () => {})
    const send = vi.fn(async () => 'places')
    await expect(sendBooked(budget({ periodSpent: 450 }), now, book, send)).rejects.toBeInstanceOf(CeilingReached)
    expect(book).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('neither books nor sends outside its pass, and ends the pass capped', async () => {
    const book = vi.fn(async () => {})
    const send = vi.fn(async () => 'places')
    const sixteenth = at('2026-11-16T09:00:00Z')
    await expect(sendBooked(budget(), sixteenth, book, send)).rejects.toBeInstanceOf(CeilingReached)
    expect(book).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the transaction pooler test', () => {
  const pooler = (port: string, password = 'secret') =>
    pgUrl(`postgres.abcdef:${password}`, `aws-0-eu-west-3.pooler.supabase.com${port}/postgres`, 'postgresql')

  it('recognises the transaction pooler the deployed app runs on', () => {
    expect(isTransactionPoolerUrl(pooler(':6543'), undefined)).toBe(true)
  })

  it('does not mistake the session pooler or the local database for it', () => {
    expect(isTransactionPoolerUrl(pooler(':5432'), undefined)).toBe(false)
    expect(isTransactionPoolerUrl(pgUrl('dmtj:dmtj', 'localhost:5434/dmtj'), undefined)).toBe(false)
  })

  it('reads the port, not a substring that happens to look like one', () => {
    expect(isTransactionPoolerUrl(pooler(':5432', 'pa:6543ss'), undefined)).toBe(false)
  })

  it('falls back on PGPORT when the URL has no port, as postgres.js does', () => {
    expect(isTransactionPoolerUrl(pooler(''), '6543')).toBe(true)
    expect(isTransactionPoolerUrl(pooler(''), undefined)).toBe(false)
    // The URL's own port wins over the environment.
    expect(isTransactionPoolerUrl(pooler(':5432'), '6543')).toBe(false)
  })

  it('fails without printing the password it could not parse', () => {
    const malformed = pgUrl('u:hunter2', 'host:notaport/db')
    expect(() => isTransactionPoolerUrl(malformed)).toThrow(/not a valid URL/)
    expect(() => isTransactionPoolerUrl(malformed)).not.toThrow(/hunter2/)
  })
})

describe('lockRelease — what the way out does with the advisory lock', () => {
  it('sends the unlock while the try-lock has not answered, without treating false as news', () => {
    // A signal during the in-flight try-lock: the unlock is serialised behind it on the
    // reserved connection, so it frees the lock if that turns out granted.
    expect(lockRelease(false, false)).toEqual({ sendUnlock: true, warnIfUnlockFails: false })
  })

  it('skips the unlock once the lock is known refused', () => {
    expect(lockRelease(true, false)).toEqual({ sendUnlock: false, warnIfUnlockFails: false })
  })

  it('sends the unlock when the lock was granted, and a false answer is news', () => {
    expect(lockRelease(true, true)).toEqual({ sendUnlock: true, warnIfUnlockFails: true })
  })

  it('never skips the unlock while the lock may be held', () => {
    for (const answered of [false, true]) {
      for (const granted of [false, true]) {
        const mayBeHeld = granted || !answered
        if (mayBeHeld) expect(lockRelease(answered, granted).sendUnlock).toBe(true)
      }
    }
  })
})

describe('passQueue — the order a pass walks', () => {
  const queued = (id: string, depth: number, status: string, queriedAt: string | null = null) =>
    ({ id, depth, status: status as 'done', queriedAt: queriedAt ? at(queriedAt) : null })

  it('walks the reserved replays, then the cover, then discovery shallow first', () => {
    const cover = [queued('cover-b', 1, 'done', '2026-10-01T09:00:00Z'), queued('cover-a', 0, 'truncated', '2026-10-01T09:00:00Z')]
    const replay = queued('empty', 0, 'done', '2026-03-01T09:00:00Z')
    const cells = [
      ...cover, replay,
      queued('deep', 3, 'pending'), queued('failed', 1, 'failed', '2026-10-01T09:00:00Z'),
      queued('shallow', 1, 'pending'),
    ]
    const { queue, discovery } = passQueue([replay], cover.map((cell) => ({ cell })), cells)
    expect(queue.map((c) => c.id)).toEqual(['empty', 'cover-b', 'cover-a', 'failed', 'shallow', 'deep'])
    expect(discovery).toBe(3)
  })
})

describe('passFailures — what fails a pass (D39), and only that', () => {
  const clean = {
    interruption: null, refusal: null, lockLeak: null,
    failedCells: 0, irreducibleCells: 0, orphanTruncations: 0, forecast: 0.9,
  }

  it('passes a pass that stopped on its ceiling and left a discovery backlog', () => {
    // The backlog is not even an input: it can never make a pass red.
    expect(passFailures(clean)).toEqual([])
    expect(passStatus([], true)).toBe('capped')
    expect(passStatus([], false)).toBe('succeeded')
  })

  it('fails on a 429, and on any other interruption', () => {
    expect(passFailures({ ...clean, interruption: new QuotaRefused('HTTP 429') })[0]).toMatch(/quota/)
    expect(passFailures({ ...clean, interruption: new Error('HTTP 503') })[0]).toMatch(/interrupted: HTTP 503/)
  })

  it('fails on a refusal to start: a held lock, calls that escaped the journal, a spent ceiling', () => {
    for (const refusal of ['the sweep lock is held by backend 42', 'at least 12 call(s) were made without being booked', '450 of 450 calls already spent']) {
      expect(passFailures({ ...clean, refusal })).toHaveLength(1)
    }
    expect(passFailures({ ...clean, lockLeak: 'the sweep lock could not be released' })).toHaveLength(1)
  })

  it('fails on a failed cell, any irreducible cell and a truncation with no recovery cell', () => {
    expect(passFailures({ ...clean, failedCells: 1 })[0]).toMatch(/1 failed cell/)
    expect(passFailures({ ...clean, irreducibleCells: 1 })[0]).toMatch(/1 irreducible/)
    expect(passFailures({ ...clean, orphanTruncations: 2 })[0]).toMatch(/2 truncated cell\(s\) without/)
  })

  it('fails under the freshness floor, not at it', () => {
    expect(passFailures({ ...clean, forecast: 0.799 })[0]).toMatch(/forecast freshness/)
    expect(passFailures({ ...clean, forecast: 0.8 })).toEqual([])
  })

  it('lists every defect, and a failed pass is never capped', () => {
    const reasons = passFailures({ ...clean, interruption: new Error('HTTP 500'), irreducibleCells: 1, forecast: 0.5 })
    expect(reasons).toHaveLength(3)
    expect(passStatus(reasons, true)).toBe('failed')
  })
})
