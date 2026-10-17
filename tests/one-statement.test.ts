import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { restaurant } from '@/lib/db/schema'

// client.ts reads DATABASE_URL at import time. postgres.js connects lazily and nothing here
// reaches it: every statement goes to the stand-in below.
vi.hoisted(() => {
  process.env.DATABASE_URL = ['postgres', '://', 'test:test', '@', '127.0.0.1:1/test'].join('')
})

const { oneStatementAtATime } = await import('@/lib/db/client')

/**
 * A stand-in for postgres.js that counts the statements on the wire at once. Each settles on
 * a later macrotask, so callers that do not wait for each other genuinely overlap.
 */
function wire({ failFirst = false } = {}) {
  let inFlight = 0
  let peak = 0
  let sent = 0
  const statement = () => {
    const n = sent++
    inFlight++
    peak = Math.max(peak, inFlight)
    return new Promise<unknown[]>((resolve, reject) => setTimeout(() => {
      inFlight--
      if (failFirst && n === 0) reject(new Error('57014 canceling statement due to statement timeout'))
      else resolve([])
    }, 5))
  }
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: () => ({
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => statement().then(ok, ko),
      values: statement,
    }),
    // A transaction's statements use the connection it reserved, not the queue.
    begin: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(client)),
  }
  return { client: client as never, peak: () => peak }
}

const select = (db: ReturnType<typeof drizzle>) => db.select({ id: restaurant.id }).from(restaurant)

describe('oneStatementAtATime (D46)', () => {
  it('overlaps without it: the stand-in can tell', async () => {
    const w = wire()
    const db = drizzle(w.client)
    await Promise.all([select(db), select(db), select(db)])
    expect(w.peak()).toBe(3)
  })

  it('puts concurrent requests on the wire one statement at a time', async () => {
    const w = wire()
    const db = drizzle(oneStatementAtATime(w.client))
    await Promise.all([select(db), select(db), select(db)])
    expect(w.peak()).toBe(1)
  })

  it('lets a transaction keep its turn until it ends', async () => {
    const w = wire()
    const db = drizzle(oneStatementAtATime(w.client))
    await Promise.all([
      select(db),
      db.transaction(async (tx) => {
        await tx.select({ id: restaurant.id }).from(restaurant)
        await tx.select({ id: restaurant.id }).from(restaurant)
      }),
      select(db),
    ])
    expect(w.peak()).toBe(1)
  })

  it('releases the turn when a statement fails', async () => {
    const w = wire({ failFirst: true })
    const db = drizzle(oneStatementAtATime(w.client))
    const [first, second] = await Promise.allSettled([select(db), select(db)])
    expect(first.status).toBe('rejected')
    expect(second.status).toBe('fulfilled')
  })
})
