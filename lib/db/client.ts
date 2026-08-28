import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is missing — copy .env.example to .env.local')

// A single connection reused in dev, so it survives Next's hot reload.
const global_ = globalThis as unknown as { _sql?: ReturnType<typeof postgres> }
const sql = global_._sql ?? postgres(url, { max: 5 })
if (process.env.NODE_ENV !== 'production') global_._sql = sql

export const db = drizzle(sql, { schema })
export { schema }
