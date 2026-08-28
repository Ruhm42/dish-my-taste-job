import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL manquant — copier .env.example vers .env.local')

// Une seule connexion réutilisée en dev, pour survivre au rechargement à chaud de Next.
const global_ = globalThis as unknown as { _sql?: ReturnType<typeof postgres> }
const sql = global_._sql ?? postgres(url, { max: 5 })
if (process.env.NODE_ENV !== 'production') global_._sql = sql

export const db = drizzle(sql, { schema })
export { schema }
