/**
 * Geocodes the SIRENE addresses through the Base Adresse Nationale.
 *
 * SIRENE gives addresses, never coordinates. Yet position is what drives the sweep grid,
 * hence the project's only costly item. The BAN is free and keyless: no reason to spend
 * Google on it.
 *
 * Resumable: only rows without a `lat` are sent. An interrupted run replays without
 * asking again for what is already known.
 */
import { and, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { sireneEstablishment } from '../lib/db/schema'
import { BAN_CSV, GRID } from '../lib/config'

/** The BAN accepts large files, but it is a public service: stay reasonable. */
const BATCH_SIZE = 2000
const PAUSE_MS = 1000
const MAX_ATTEMPTS = 3

interface AddressRow {
  siret: string
  address: string
  postalCode: string | null
}

interface GeocodeResult {
  siret: string
  lat: number
  lng: number
  score: number
}

/**
 * SIRENE replaces the fields of non-disclosable establishments with '[ND]'. That is not
 * an incomplete address: there is nothing to look up, and sending those to the BAN on
 * every run would only inflate the not-found count.
 */
const HAS_SEARCHABLE_ADDRESS = sql`coalesce(${sireneEstablishment.address}, '') <> '' and ${sireneEstablishment.address} not like '%[ND]%'`
const HAS_NO_SEARCHABLE_ADDRESS = sql`coalesce(${sireneEstablishment.address}, '') = '' or ${sireneEstablishment.address} like '%[ND]%'`

function csvField(value: string | null): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

/** A '[ND]' sent as-is would make the BAN search for that string. An empty field is better. */
function stripNotDisclosed(value: string | null): string | null {
  return value?.includes('[ND]') ? null : value
}

function toCsv(rows: AddressRow[]): string {
  const body = rows.map((r) =>
    [csvField(r.siret), csvField(stripNotDisclosed(r.address)), csvField(stripNotDisclosed(r.postalCode))].join(','),
  )
  return ['siret,address,postal_code', ...body].join('\n')
}

/** Minimal CSV parser, but one that handles quotes: business names contain them. */
function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = false
    } else if (c === '"') inQuotes = true
    else if (c === separator) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

async function callBan(batch: AddressRow[]): Promise<string> {
  const file = new Blob([toCsv(batch)], { type: 'text/csv' })

  for (let attempt = 1; ; attempt++) {
    const form = new FormData()
    form.append('data', file, 'addresses.csv')
    form.append('columns', 'address')
    form.append('postcode', 'postal_code')

    try {
      const response = await fetch(BAN_CSV, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(180_000),
      })
      if (response.ok) return await response.text()

      const detail = (await response.text()).slice(0, 500)
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`BAN answered ${response.status} after ${attempt} attempts: ${detail}`)
      }
      console.warn(`  BAN ${response.status}, retrying (${attempt}/${MAX_ATTEMPTS})`)
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS) throw e
      console.warn(`  network failure (${(e as Error).message}), retrying (${attempt}/${MAX_ATTEMPTS})`)
    }
    await sleep(PAUSE_MS * 5 * attempt)
  }
}

function extractResults(csv: string): GeocodeResult[] {
  const separator = (csv.split('\n', 1)[0].match(/;/g)?.length ?? 0) >
    (csv.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = parseCsv(csv, separator)
  if (rows.length === 0) throw new Error('BAN returned an empty file')

  const header = rows[0]
  const col = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`column "${name}" missing from the BAN response — header: ${header.join('|')}`)
    return i
  }
  const iSiret = col('siret')
  const iLat = col('latitude')
  const iLng = col('longitude')
  const iScore = col('result_score')

  const results: GeocodeResult[] = []
  for (const row of rows.slice(1)) {
    if (row.length <= iScore) continue // truncated row: nothing usable in it
    const lat = Number(row[iLat])
    const lng = Number(row[iLng])
    // Address not found: empty latitude. Not an error, the row will come back next run.
    if (!row[iLat] || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    results.push({ siret: row[iSiret], lat, lng, score: Number(row[iScore]) || 0 })
  }
  return results
}

/** A single round trip per batch: 2,000 individual UPDATEs would not be justified. */
async function writeResults(results: GeocodeResult[]): Promise<void> {
  if (results.length === 0) return
  const values = results.map((r) =>
    sql`(${r.siret}::text, ${r.lat}::double precision, ${r.lng}::double precision, ${r.score}::real)`,
  )
  await db.execute(sql`
    update ${sireneEstablishment} as s
       set lat = v.lat, lng = v.lng, geocode_score = v.score
      from (values ${sql.join(values, sql`, `)}) as v(siret, lat, lng, score)
     where s.siret = v.siret
  `)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  // An empty registry is not "nothing to do": it is the previous script that is missing.
  if (await db.$count(sireneEstablishment) === 0) {
    throw new Error('sirene_establishment table is empty — run ingest:sirene before geocoding')
  }

  const withoutAddress = await db.$count(
    sireneEstablishment,
    and(isNull(sireneEstablishment.lat), HAS_NO_SEARCHABLE_ADDRESS),
  )

  const pending = await db
    .select({
      siret: sireneEstablishment.siret,
      address: sireneEstablishment.address,
      postalCode: sireneEstablishment.postalCode,
    })
    .from(sireneEstablishment)
    .where(and(isNull(sireneEstablishment.lat), HAS_SEARCHABLE_ADDRESS))

  if (withoutAddress > 0) {
    console.log(`${withoutAddress} establishments without a usable address (non-disclosable):`)
    console.log('  ungeocodable by nature, they will not feed the grid')
  }
  if (pending.length === 0) {
    console.log('nothing to geocode — every SIRENE row with an address already has a point')
    return
  }

  const batchCount = Math.ceil(pending.length / BATCH_SIZE)
  console.log(`${pending.length} addresses to geocode, ${batchCount} batch(es) of ${BATCH_SIZE}`)

  let geocoded = 0
  let reliable = 0

  for (let i = 0; i < batchCount; i++) {
    const batch = pending.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE) as AddressRow[]
    const results = extractResults(await callBan(batch))
    await writeResults(results)

    geocoded += results.length
    reliable += results.filter((r) => r.score >= GRID.minGeocodeScore).length
    console.log(`  batch ${i + 1}/${batchCount}: ${results.length}/${batch.length} located`)

    if (i < batchCount - 1) await sleep(PAUSE_MS)
  }

  const pct = (n: number) => `${((n / pending.length) * 100).toFixed(1)}%`
  console.log(`\naddresses processed  : ${pending.length}`)
  console.log(`geocoded             : ${geocoded} (${pct(geocoded)})`)
  console.log(`score >= ${GRID.minGeocodeScore}         : ${reliable} (${pct(reliable)}) — only these will feed the grid`)

  const lowScore = geocoded - reliable
  if (lowScore > 0) {
    console.log(`low score            : ${lowScore} — points kept, excluded from the grid`)
  }
  if (geocoded < pending.length) {
    console.log(`not found            : ${pending.length - geocoded} — rerunning the script will retry them`)
  }

  // After a resume, the figures above only cover the leftovers. It is this total that
  // compares against the ~90% expected.
  const total = await db.$count(sireneEstablishment)
  const usable = await db.$count(sireneEstablishment, gte(sireneEstablishment.geocodeScore, GRID.minGeocodeScore))
  console.log(`\nwhole registry       : ${usable}/${total} usable for the grid ` +
    `(${((usable / total) * 100).toFixed(1)}%)`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
