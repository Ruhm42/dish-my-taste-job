import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { DEFAULT_THRESHOLD, googleNameColumns, nameScore, sireneNameColumns } from '@/lib/name-match'

// The normalization is SQL and the score is pg_trgm's: re-implementing either in TypeScript
// would test the copy, not the query. PGlite runs the very fragments match-sirene.ts sends,
// in-process, so CI needs no database.
let db: PGlite

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pg_trgm } })
  await db.exec('CREATE EXTENSION pg_trgm')
})

afterAll(async () => {
  await db.close()
})

/** The score match-sirene.ts would give this pair, composed the same way as its query. */
async function score(googleName: string, sireneName: string): Promise<number> {
  const { rows } = await db.query<{ score: number }>(`
    WITH google AS (SELECT ${googleNameColumns('$1::text')}),
         sirene AS (SELECT ${sireneNameColumns('$2::text')})
    SELECT ${nameScore('google', 'sirene')} AS score FROM google, sirene
  `, [googleName, sireneName])
  return rows[0].score
}

describe('Google names carrying a marketing suffix or a place name', () => {
  // ─────────────────────────────────────────────────────────────
  // Production, 2026-10-17: 290 of the 3,031 unmatched places had a
  // named SIRENE record within 75 m scoring 0.30-0.45. The registry
  // holds the bare sign; Google appends a cuisine, a slogan or the
  // neighbourhood, and every extra trigram dilutes the score.
  // ─────────────────────────────────────────────────────────────
  it.each([
    ['Bombay Palace - Restaurant Indien - Buffet à volonté - Lyon 5', 'BOMBAY PALACE'],
    ['Gaku Gaku - Fluffy pancakes, Coffee & Tea Shop', 'GAKU GAKU'],
    ['Sushi Life | Villeurbanne | Lyon', 'SUSHI LIFE'],
    ['Le Plan B - Lyon Brotteaux', 'LE PLAN B'],
    ['INADA Confluence', 'INADA'],
    ['Barabaar Croix-Rousse - Bar Croix Rousse', 'BARABAAR'],
  ])('matches "%s" to %s', async (google, sirene) => {
    expect(await score(google, sirene)).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
  })

  it('cuts at a bullet, a colon, a parenthesis or a comma as well', async () => {
    expect(await score('Kotori • Ramen', 'KOTORI')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
    expect(await score('Kotori : cuisine japonaise', 'KOTORI')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
    expect(await score('Kotori (Lyon 7)', 'KOTORI')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
    expect(await score('Kotori, cuisine japonaise', 'KOTORI')).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD)
  })
})

describe('what the stripping must not do', () => {
  it('keeps a kebab apart from the brasserie named after its neighbourhood', async () => {
    // 16 m apart, and "vaise" is all they share: a place, not a sign.
    expect(await score('Marmara kebab vaise', 'BRASSERIE DE VAISE')).toBeLessThan(DEFAULT_THRESHOLD)
  })

  it('still matches an establishment whose name IS its neighbourhood', async () => {
    // The stripped name is a second chance, never a replacement for the full one.
    expect(await score('Brasserie des Brotteaux', 'BRASSERIE DES BROTTEAUX')).toBe(1)
  })

  it('leaves alone a word that only starts like a place', async () => {
    expect(await score('Bouchon Lyonnais - Chez Paul', 'LE BOUCHON LYONNAIS')).toBe(1)
  })

  it('refuses to decide on a remainder too short to discriminate', async () => {
    // "AB" alone would score 0.6 against "AB X": two letters are not a name.
    expect(await score('AB - Lyon', 'AB X')).toBeLessThan(DEFAULT_THRESHOLD)
  })

  it('does not let a branch label outrank the chain\'s own name', async () => {
    // Production: "Sushi Shop Lyon Vitton" took "SUSHI VITTON" 18 m away from "SUSHI SHOP",
    // 4 m away, and left "SUSHI CORP VITTON" without its record.
    const chain = await score('Sushi Shop Lyon Vitton', 'SUSHI SHOP')
    expect(chain).toBeGreaterThan(await score('Sushi Shop Lyon Vitton', 'SUSHI VITTON'))
  })

  it('leaves the SIRENE side as it was', async () => {
    // A registry name carrying a place keeps it: only Google adds marketing to its names.
    expect(await score('Le Comptoir', 'LE COMPTOIR - LYON')).toBeLessThan(1)
  })
})
