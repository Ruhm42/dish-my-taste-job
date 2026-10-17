import { describe, expect, it, vi } from 'vitest'
import { SWEEP } from '@/lib/config'
import { monthWindow } from '@/lib/quota'

// Both modules read DATABASE_URL at import time. postgres.js connects lazily and nothing here
// issues a query, but the address points nowhere all the same.
vi.hoisted(() => {
  // Assembled here rather than through pgUrl below: vi.hoisted runs before any declaration in
  // this file is initialised. Same reason as pgUrl's comment.
  process.env.DATABASE_URL = ['postgres', '://', 'test:test', '@', '127.0.0.1:1/test'].join('')
})

const { isTransactionPoolerUrl } = await import('@/lib/db/client')
const { LEDGER_SLACK, byExpiry, ledgerLossMessage, lockRelease, loggedFloor } = await import('@/scripts/sweep')

/**
 * Connection strings built from parts, so that no line of this file reads as a committed
 * credential to the secret scan in ci.yml. Every one here is fake — but exempting tests/ from
 * the scan instead would let a real one pasted into a test slip through unseen.
 */
const pgUrl = (credentials: string, rest: string, scheme = 'postgres') =>
  [scheme, '://', credentials, '@', rest].join('')

const CEILING = SWEEP.maxCallsPerPeriod
const at = (iso: string) => new Date(iso)

// Pacific months: midday UTC on the 15th sits well inside each one.
const AUGUST = monthWindow(at('2026-08-15T12:00:00Z'))
const SEPTEMBER = monthWindow(at('2026-09-15T12:00:00Z'))
const OCTOBER = monthWindow(at('2026-10-15T12:00:00Z'))

describe('the logbook floor under the spend ledger', () => {
  // ─────────────────────────────────────────────────────────────
  // Production, 2026-09-27: one plan (started 2026-08-28) walked for
  // ever under D30 rule 1, 900 calls in August and 900 in September.
  // The old floor only counted runs STARTED in the window, so it read
  // 0 for this run in every month after August.
  // ─────────────────────────────────────────────────────────────
  const plan = { startedAt: at('2026-08-28T10:00:00Z'), finishedAt: at('2026-09-27T09:00:00Z'), callsMade: 1800 }

  it('attributes a long-lived run\'s calls to the period being spent', () => {
    expect(loggedFloor([plan], SEPTEMBER, CEILING, at('2026-09-27T12:00:00Z'))).toBe(900)
  })

  it('keeps proving a period\'s calls when the cell rows that stamped them are deleted', () => {
    // Mid-October, 400 calls in: whatever happens to the cell table, the floor stays at 400.
    const october = { ...plan, finishedAt: at('2026-10-02T10:00:00Z'), callsMade: 2200 }
    const floor = loggedFloor([october], OCTOBER, CEILING, at('2026-10-02T12:00:00Z'))
    expect(floor).toBe(400)
    expect(ledgerLossMessage({ stamped: 0, logged: floor, charged: floor }, '2026-10')).not.toBeNull()
  })

  it('bounds a running or killed run by the real clock, not by a simulated window', () => {
    const killed = { ...plan, finishedAt: null }
    expect(loggedFloor([killed], SEPTEMBER, CEILING, at('2026-09-27T12:00:00Z'))).toBe(900)
    // Read as of August, the same run must not claim September's calls for August.
    expect(loggedFloor([killed], AUGUST, CEILING, at('2026-09-27T12:00:00Z'))).toBe(900)
  })

  it('ignores runs that were not active in the window', () => {
    const clock = at('2026-10-15T12:00:00Z')
    const finishedBefore = { startedAt: at('2026-08-02T10:00:00Z'), finishedAt: at('2026-08-03T10:00:00Z'), callsMade: 900 }
    const startedAfter = { startedAt: at('2026-10-02T10:00:00Z'), finishedAt: at('2026-10-02T12:00:00Z'), callsMade: 300 }
    expect(loggedFloor([finishedBefore, startedAfter], SEPTEMBER, CEILING, clock)).toBe(0)
  })

  it('opens the period on Pacific midnight, like the ceiling it guards', () => {
    // 06:30Z on the 1st is still August 31st in California: that run started in August.
    const run = { startedAt: at('2026-09-01T06:30:00Z'), finishedAt: at('2026-09-01T08:00:00Z'), callsMade: 950 }
    expect(loggedFloor([run], SEPTEMBER, CEILING, at('2026-09-02T00:00:00Z'))).toBe(950 - CEILING)
  })

  it('adds the floors of several runs active in the same period', () => {
    const clock = at('2026-09-20T00:00:00Z')
    const a = { startedAt: at('2026-09-02T10:00:00Z'), finishedAt: at('2026-09-02T11:00:00Z'), callsMade: 120 }
    const b = { startedAt: at('2026-09-10T10:00:00Z'), finishedAt: at('2026-09-10T11:00:00Z'), callsMade: 80 }
    expect(loggedFloor([a, b], SEPTEMBER, CEILING, clock)).toBe(200)
  })

  it('never claims more than a period spent while every period stayed under the ceiling', () => {
    // Random histories: the floor may read short (idle months loosen it), never long —
    // reading long would refuse calls the quota allows, and the refusal would be a lie.
    let seed = 42
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
    const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    for (let trial = 0; trial < 500; trial++) {
      const spends = months.map(() => Math.floor(random() * (CEILING + 1)))
      const first = Math.floor(random() * months.length)
      const last = first + Math.floor(random() * (months.length - first))
      const active = spends.slice(first, last + 1)
      const run = {
        startedAt: at(`${months[first]}-15T12:00:00Z`),
        finishedAt: at(`${months[last]}-16T12:00:00Z`),
        callsMade: active.reduce((a, b) => a + b, 0),
      }
      for (let i = first; i <= last; i++) {
        const w = monthWindow(at(`${months[i]}-15T12:00:00Z`))
        const floor = loggedFloor([run], w, CEILING, at('2026-10-20T00:00:00Z'))
        expect(floor).toBeLessThanOrEqual(spends[i])
        // And exact when every other active period spent the whole ceiling.
        if (active.every((s, k) => k + first === i || s === CEILING)) expect(floor).toBe(spends[i])
      }
    }
  })
})

describe('the ledger consistency check', () => {
  it('tolerates the one billed call production lost between response and write', () => {
    // 1,800 calls logged, 1,799 cells stamped: the ±1 of a throw after Google answered.
    expect(ledgerLossMessage({ stamped: 899, logged: 900, charged: 900 }, '2026-09')).toBeNull()
  })

  it('refuses once the gap is more than lost writes can explain', () => {
    expect(ledgerLossMessage({ stamped: 900 - LEDGER_SLACK, logged: 900, charged: 900 }, '2026-09')).toBeNull()
    const message = ledgerLossMessage({ stamped: 899 - LEDGER_SLACK, logged: 900, charged: 900 }, '2026-09')
    expect(message).toContain(`at least ${LEDGER_SLACK + 1} call(s)`)
  })

  it('stays silent when the cell ledger reads MORE than the logbook', () => {
    // The normal state for a run whose earlier months left quota unspent, or whose last
    // execution was killed before it could write calls_made.
    expect(ledgerLossMessage({ stamped: 700, logged: 0, charged: 700 }, '2026-11')).toBeNull()
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

describe('byExpiry — the order a period buys its cells back in', () => {
  const queued = (id: string, depth: number, queriedAt: string | null) =>
    ({ id, depth, queriedAt: queriedAt ? at(queriedAt) : null })

  it('takes the shallow cells first, then the oldest, and the never-queried last', () => {
    const cells = [
      queued('deep-old', 1, '2026-09-01T09:00:00Z'),
      queued('deeper-old', 2, '2026-09-04T09:00:00Z'),
      queued('never-deep', 2, null),
      queued('root-late', 0, '2026-10-01T09:30:00Z'),
      queued('deep-recent', 1, '2026-10-01T09:45:00Z'),
      queued('never-root', 0, null),
      queued('root-early', 0, '2026-10-01T09:10:00Z'),
    ]
    expect(cells.sort(byExpiry).map((c) => c.id)).toEqual([
      'root-early', 'root-late',
      'deep-old', 'deep-recent',
      'deeper-old',
      'never-root', 'never-deep',
    ])
  })

  // ─────────────────────────────────────────────────────────────
  // Production, 2026-10-17: the plan as the 1 November run finds it.
  // Every restaurant's hours expire on 31 October, all re-stamped by
  // the 1 October run — which happened to query the depth-0 cells.
  // Sorted by queried_at alone, November's 900 calls would have gone to
  // the 899 September children and left the depth-0 cells, the ones
  // covering most of the city, for December.
  // ─────────────────────────────────────────────────────────────
  it('spends the period\'s ceiling on every depth-0 cell before the September children', () => {
    const shape: [depth: number, day: string | null, count: number][] = [
      [1, '2026-09-01', 417], [2, '2026-09-01', 319], [2, '2026-09-04', 163],
      [0, '2026-10-01', 653], [1, '2026-10-01', 247],
      [1, null, 23], [2, null, 158], [3, null, 428],
    ]
    const plan = shape.flatMap(([depth, day, n]) => Array.from({ length: n }, (_, i) =>
      queued(`${depth}-${day}-${i}`, depth, day && `${day}T09:00:00Z`)))

    const bought = plan.sort(byExpiry).slice(0, CEILING)
    expect(bought.filter((c) => c.depth === 0)).toHaveLength(653)
    expect(bought.filter((c) => !c.queriedAt)).toHaveLength(0)
  })
})
