/**
 * Pipeline step 1: load the SIRENE registry into the `sirene_establishment` table.
 *
 * The stock file weighs 2.2 GB and we only keep ~6,000 rows. DuckDB reads the Parquet
 * remotely, pulling down only the columns and blocks it needs: no full download, and the
 * extraction takes a few seconds.
 *
 * Free, no account and no key (D13). Replayable as many times as needed.
 */
import { DuckDBInstance } from '@duckdb/node-api'
import { sql } from 'drizzle-orm'
import { COMMUNE_CODES, COMMUNE_NAMES, NAF_CODES, SIRENE_PARQUET } from '../lib/config'
import { db } from '../lib/db/client'
import { sireneEstablishment } from '../lib/db/schema'

/**
 * Below this volume, either the filter or the stock file URL has changed: the
 * 2026-08-28 measurement gives 6,129 establishments over the perimeter (D16). Loading
 * 200 rows without flinching would build a truncated grid that nothing would report.
 */
const MINIMUM_EXPECTED_ROWS = 3000

/**
 * Postgres caps bound parameters at 65,535 per statement, i.e. 9 columns × 7,281 rows
 * here. 1,000 leaves the headroom needed to add a column one day.
 */
const BATCH_SIZE = 1000

interface SireneRow {
  siret: string
  siren: string | null
  name: string | null
  naf: string | null
  headcountCode: string | null
  communeCode: string
  commune: string | null
  address: string | null
  postalCode: string | null
}

/**
 * '[ND]' is the SIRENE marker for non-disclosable establishments — 282 rows in the
 * perimeter, whose address is literally '[ND] [ND] [ND]'. Keeping it would send that
 * string to the geocoder and hand it to the matcher as a name: empty beats wrong.
 */
function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' || trimmed === '[ND]' ? null : trimmed
}

async function extractFromSirene(): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    // httpfs gives DuckDB HTTP range reads: without it, no remote Parquet.
    await connection.run('INSTALL httpfs')
    await connection.run('LOAD httpfs')

    const query = `
      SELECT siret, siren, codeCommuneEtablissement, libelleCommuneEtablissement,
             activitePrincipaleEtablissement, trancheEffectifsEtablissement,
             enseigne1Etablissement, denominationUsuelleEtablissement,
             numeroVoieEtablissement, typeVoieEtablissement, libelleVoieEtablissement,
             codePostalEtablissement
      FROM read_parquet('${SIRENE_PARQUET}')
      WHERE codeCommuneEtablissement IN (${COMMUNE_CODES.map(() => '?').join(', ')})
        AND etatAdministratifEtablissement = 'A'
        AND activitePrincipaleEtablissement IN (${NAF_CODES.map(() => '?').join(', ')})
    `
    const result = await connection.runAndReadAll(query, [...COMMUNE_CODES, ...NAF_CODES])
    return result.getRowObjectsJS()
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

function toRow(raw: Record<string, unknown>): SireneRow {
  const siret = cleanText(raw.siret)
  const communeCode = cleanText(raw.codeCommuneEtablissement)
  if (!siret || !communeCode) {
    throw new Error(`SIRENE row without a siret or a commune code: ${JSON.stringify(raw)}`)
  }

  const headcount = cleanText(raw.trancheEffectifsEtablissement)

  return {
    siret,
    siren: cleanText(raw.siren),
    // The trade name is the operating name, the one on the shopfront and therefore the
    // one Google knows. The legal name is only a fallback.
    name: cleanText(raw.enseigne1Etablissement) ?? cleanText(raw.denominationUsuelleEtablissement),
    naf: cleanText(raw.activitePrincipaleEtablissement),
    // 'NN' is the SIRENE code for "not provided" — 65.2% of the rows. We fold it to NULL
    // so consumers never have to know about that sentinel.
    headcountCode: headcount === 'NN' ? null : headcount,
    communeCode,
    // The SIRENE label for districts ('LYON 1') differs from the one the app displays
    // ('Lyon 1er'): we align on the latter.
    commune: COMMUNE_NAMES[communeCode] ?? cleanText(raw.libelleCommuneEtablissement),
    address: cleanText([
      raw.numeroVoieEtablissement,
      raw.typeVoieEtablissement,
      raw.libelleVoieEtablissement,
    ].map(cleanText).filter(Boolean).join(' ')),
    postalCode: cleanText(raw.codePostalEtablissement),
  }
}

async function main() {
  console.log(`SIRENE extraction: ${COMMUNE_CODES.length} communes, ${NAF_CODES.length} activity codes`)
  const startedAt = Date.now()

  const rawRows = await extractFromSirene()
  console.log(`${rawRows.length} rows extracted in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)

  if (rawRows.length < MINIMUM_EXPECTED_ROWS) {
    throw new Error(
      `Implausible volume: ${rawRows.length} rows, ${MINIMUM_EXPECTED_ROWS} expected at least. ` +
      'The filter or the stock file URL has changed — check SIRENE_PARQUET, COMMUNE_CODES ' +
      'and NAF_CODES in lib/config.ts before replaying. Nothing was written to the database.',
    )
  }

  const rows = rawRows.map(toRow)

  // The SIRETs already present tell inserts from updates, which the upsert does not
  // report back.
  const alreadyStored = new Set(
    (await db.select({ siret: sireneEstablishment.siret }).from(sireneEstablishment)).map((r) => r.siret),
  )

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db.insert(sireneEstablishment).values(rows.slice(i, i + BATCH_SIZE)).onConflictDoUpdate({
      target: sireneEstablishment.siret,
      // lat, lng and geocodeScore are deliberately absent: BAN geocoding is a separate,
      // slow step and we do not sacrifice it to a re-import. googlePlaceId is absent for
      // the same reason, on the matching side.
      set: {
        siren: sql`excluded.siren`,
        name: sql`excluded.name`,
        naf: sql`excluded.naf`,
        headcountCode: sql`excluded.headcount_code`,
        communeCode: sql`excluded.commune_code`,
        commune: sql`excluded.commune`,
        address: sql`excluded.address`,
        postalCode: sql`excluded.postal_code`,
        importedAt: sql`now()`,
      },
    })
  }

  const inserted = rows.filter((r) => !alreadyStored.has(r.siret)).length
  console.log(`${inserted} inserted, ${rows.length - inserted} updated`)

  const byCommune = new Map<string, number>()
  for (const r of rows) byCommune.set(r.communeCode, (byCommune.get(r.communeCode) ?? 0) + 1)
  console.log('\nBreakdown by commune:')
  for (const [code, n] of [...byCommune].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(COMMUNE_NAMES[code] ?? code).padEnd(14)} ${String(n).padStart(5)}`)
  }

  const withoutHeadcount = rows.filter((r) => !r.headcountCode).length
  const withoutName = rows.filter((r) => !r.name).length
  const withoutAddress = rows.filter((r) => !r.address).length
  console.log(
    `\nHeadcount not provided: ${withoutHeadcount} (${(100 * withoutHeadcount / rows.length).toFixed(1)}%)` +
    ` · without a name: ${withoutName} · without an address: ${withoutAddress}`,
  )

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
