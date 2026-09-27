import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is missing — copy .env.example to .env.local')

/**
 * Supabase exposes three ways in, and only the port tells them apart:
 *
 *  - direct (`db.<ref>.supabase.co:5432`) — IPv6 only on the free plan, so GitHub runners
 *    cannot reach it at all. Local use only.
 *  - session pooler (`…pooler.supabase.com:5432`) — long-lived connections, prepared
 *    statements work. This is what the batch scripts use.
 *  - transaction pooler (`…pooler.supabase.com:6543`) — what a serverless deployment
 *    must use: one Postgres backend per function instance would otherwise exhaust the
 *    free tier's connection limit under any concurrency.
 *
 * Transaction pooling hands a *different* backend to each statement, so a prepared
 * statement is never found where it was prepared — hence `prepare: false`. Skipping it
 * makes queries fail intermittently rather than outright, which is far harder to
 * diagnose. And `max: 1` because each serverless instance owns its pool: connections per
 * instance multiply by the number of instances.
 */
const TRANSACTION_POOLER_PORT = '6543'

/**
 * Read the port the way postgres.js does — the URL's, else `PGPORT` — so the two cannot
 * disagree about where the connection goes. A substring test on ':6543' could: it matched a
 * password or a database name containing it, and missed a URL with no port and `PGPORT`
 * set, which is the one that hangs the sweep.
 *
 * Throws without echoing the URL: it carries the database password.
 */
export function isTransactionPoolerUrl(databaseUrl: string, pgPort = process.env.PGPORT): boolean {
  let port: string
  try {
    port = new URL(databaseUrl).port
  } catch {
    throw new Error('DATABASE_URL is not a valid URL (its value is not printed: it holds the password)')
  }
  return (port || pgPort) === TRANSACTION_POOLER_PORT
}

export const isTransactionPooler = isTransactionPoolerUrl(url)

/**
 * Timeouts are not optional on serverless.
 *
 * Without `connect_timeout`, postgres.js waits indefinitely for a connection that may
 * never come — a failure then shows up as a 300-second function timeout instead of an
 * error, which is far harder to diagnose. `idle_timeout` releases a connection the
 * pooler would otherwise keep parked.
 */
const options: Parameters<typeof postgres>[1] = isTransactionPooler
  ? { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 20 }
  : { max: 5, connect_timeout: 15 }

// A single connection reused in dev, so it survives Next's hot reload.
const global_ = globalThis as unknown as { _sql?: ReturnType<typeof postgres> }
const sql = global_._sql ?? postgres(url, options)
if (process.env.NODE_ENV !== 'production') global_._sql = sql

export const db = drizzle(sql, { schema })
export { schema }

/**
 * The raw client, for the one thing Drizzle cannot express: a session-level advisory lock.
 *
 * Such a lock lives on the connection that took it, and the pool hands statements to
 * whichever connection is free — so the sweep reserves one for its whole run rather than
 * locking on a connection it may never see again. See `scripts/sweep.ts`.
 *
 * That reservation is why `isTransactionPooler` is exported. With `max: 1`, reserving the
 * connection takes the only one there is: every query issued afterwards waits for a
 * connection that never frees, with no error and no timeout. The symptom is an hour of
 * silence having spent nothing, which is why a batch script refuses the transaction pooler
 * at startup instead of hanging on it.
 */
export { sql }
