import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'

/**
 * Copies the production database into the local one, so the app can be exercised against
 * real data instead of the 37 demo rows.
 *
 * Three properties matter more than convenience here:
 *
 * 1. The direction is one-way and guarded. The script refuses to run unless DATABASE_URL
 *    resolves to a loopback address. Inverting source and target would overwrite the only
 *    copy of a sweep that costs a month of Google quota to rebuild.
 * 2. Only the `public` schema travels. Supabase's `auth` schema — real accounts and their
 *    password hashes — is never read. Local sign-in keeps going to the real project.
 * 3. `--schema=public` rather than a hand-written table list: a table added later would
 *    otherwise be skipped in silence, and a silently incomplete database is this project's
 *    stated worst failure mode.
 *
 * Local data is destroyed, schema included. That is what makes the result reproducible:
 * the local schema is rebuilt from lib/db/schema.ts, so a stale enum cannot survive the
 * copy and corrupt the restore halfway through.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const DUMP = 'data/prod-dump.sql'

interface Target {
  PGHOST: string
  PGPORT: string
  PGUSER: string
  PGPASSWORD: string
  PGDATABASE: string
}

/**
 * Connection settings as libpq environment variables rather than a command-line argument,
 * so the password never lands in the process list.
 */
function parse(raw: string, label: string): Target & { host: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} is not a valid connection URL`)
  }
  return {
    host: url.hostname,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
  }
}

function run(argv: string[], env: Target, opts: { stdout?: number | 'inherit' | 'ignore', stdin?: number } = {}) {
  const r = spawnSync(argv[0]!, argv.slice(1), {
    env: { ...process.env, ...env },
    stdio: [opts.stdin ?? 'ignore', opts.stdout ?? 'inherit', 'inherit'],
  })
  if (r.status !== 0) throw new Error(`${argv[0]} exited with ${r.status ?? r.signal}`)
}

/** Runs psql in a throwaway container and returns stdout, unformatted. */
function psql(image: string, env: Target, sql: string, docker: string[] = []): string {
  const r = spawnSync('docker', [
    'run', '--rm', ...dockerEnv(), ...docker, image,
    'psql', '-v', 'ON_ERROR_STOP=1', '-tAc', sql,
  ], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) throw new Error(`psql exited with ${r.status ?? r.signal}`)
  return r.stdout.trim()
}

const PG_VARS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'] as const
/** `-e NAME` with no value forwards it from our own environment, keeping it out of argv. */
const dockerEnv = () => PG_VARS.flatMap((k) => ['-e', k])

async function main() {
  const localUrl = process.env.DATABASE_URL
  const prodUrl = process.env.PROD_DATABASE_URL
  if (!localUrl) throw new Error('DATABASE_URL is not set')
  if (!prodUrl) throw new Error('PROD_DATABASE_URL is not set')

  const local = parse(localUrl, 'DATABASE_URL')
  const prod = parse(prodUrl, 'PROD_DATABASE_URL')

  // The guard that makes this script safe to run without reading it first.
  if (!LOOPBACK.has(local.host)) {
    throw new Error(
      `refusing to write to ${local.host}: DATABASE_URL must point at localhost.\n` +
      'This script overwrites its target completely.',
    )
  }
  if (prod.PGHOST === local.PGHOST && prod.PGPORT === local.PGPORT) {
    throw new Error('PROD_DATABASE_URL and DATABASE_URL are the same database')
  }

  // pg_dump refuses to talk to a server newer than itself, and Supabase upgrades Postgres
  // on its own schedule. Read the version and pick a matching image rather than pinning a
  // tag that silently rots.
  //
  // Port 6543 is Supabase's TRANSACTION pooler, which does not implement enough of the
  // protocol for pg_dump. Port 5432 on the same host is the session pooler, which does.
  const source: Target = { ...prod, PGPORT: prod.PGPORT === '6543' ? '5432' : prod.PGPORT }
  const probe = 'postgres:17-alpine'
  const major = psql(probe, source, 'SHOW server_version').split('.')[0]
  const image = `postgres:${major}-alpine`
  console.log(`source  ${source.PGHOST}:${source.PGPORT}/${source.PGDATABASE} — Postgres ${major}`)
  console.log(`target  ${local.PGHOST}:${local.PGPORT}/${local.PGDATABASE}`)

  // Reaching the host's Postgres from inside a container. --add-host makes the name resolve
  // on Linux too, where it is not built in as it is on Docker Desktop.
  const inner: Target = { ...local, PGHOST: 'host.docker.internal' }
  const bridge = ['--add-host=host.docker.internal:host-gateway']

  // schemaname filter is not cosmetic: without it this reads Supabase's `auth` tables too.
  const before = psql(image, source, `SELECT string_agg(t, ' ') FROM (
    SELECT relname || '=' || n_live_tup AS t FROM pg_stat_user_tables
    WHERE schemaname = 'public' ORDER BY relname) s`)
  console.log(`\nprod    ${before}`)

  mkdirSync('data', { recursive: true })
  const fd = openSync(DUMP, 'w')
  try {
    console.log('\ndumping public schema…')
    run(['docker', 'run', '--rm', ...dockerEnv(), image,
      'pg_dump', '--data-only', '--schema=public',
      // FK order within a data-only dump is not guaranteed; disabling triggers sidesteps it
      // instead of relying on pg_dump's sort.
      '--disable-triggers', '--no-owner', '--no-privileges',
    ], source, { stdout: fd })
  } finally {
    closeSync(fd)
  }

  console.log('rebuilding the local schema…')
  // pg_trgm lives in `public`, so dropping the schema takes it with it. `match:sirene`
  // depends on similarity() and would fail on the next local run without this.
  psql(image, inner, 'SET client_min_messages = warning;'
    + ' DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
    + ' CREATE EXTENSION IF NOT EXISTS pg_trgm;', bridge)
  run(['npm', 'run', 'db:push'], local)

  console.log('\nrestoring…')
  const dump = openSync(DUMP, 'r')
  try {
    run(['docker', 'run', '--rm', '-i', ...dockerEnv(), ...bridge, image,
      'psql', '-v', 'ON_ERROR_STOP=1', '-q'], inner, { stdin: dump, stdout: 'ignore' })
  } finally {
    closeSync(dump)
  }

  // Compare both ends rather than trusting a zero exit code: a COPY that lands short is
  // exactly the kind of failure that would go unnoticed until a query returned too few rows.
  const tables = psql(image, source,
    `SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'`)
  const tally = (env: Target, docker: string[] = []) =>
    Object.fromEntries(tables.split(',').map(
      (t) => [t, Number(psql(image, env, `SELECT count(*) FROM public."${t}"`, docker))],
    )) as Record<string, number>

  const src = tally(source)
  const dst = tally(inner, bridge)
  const drift = Object.keys(src).filter((t) => src[t] !== dst[t])

  console.log(`\nlocal   ${Object.entries(dst).map(([t, n]) => `${t}=${n}`).join(' ')}`)
  if (drift.length) {
    throw new Error(`row counts differ: ${drift.map((t) => `${t} ${src[t]}→${dst[t]}`).join(', ')}`)
  }

  rmSync(DUMP, { force: true })
  console.log('\nlocal database matches production.')
}

main().catch((e) => {
  console.error(`\npull-prod failed: ${e.message}`)
  if (existsSync(DUMP)) console.error(`the dump is kept at ${DUMP} for inspection`)
  process.exit(1)
})
