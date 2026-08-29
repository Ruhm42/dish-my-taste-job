import { describe, expect, it } from 'vitest'
import { COMMUNE_CODES } from '@/lib/config'
import {
  HOTELLERIE_RESTAURATION_URL, TRADES, indeedUrl, laBonneBoiteUrl,
} from '@/lib/job-boards'

const params = (url: string) => new URL(url).searchParams

describe('La Bonne Boîte', () => {
  // ─────────────────────────────────────────────────────────────
  // The one defect this file exists to prevent. Lyon has two commune
  // codes and the two referentials disagree: SIRENE knows only the
  // districts, La Bonne Boîte knows only 69123. Getting it backwards
  // returns an empty page, never an error.
  // ─────────────────────────────────────────────────────────────
  it('searches on the global Lyon commune code, never a district code', () => {
    const citycode = params(laBonneBoiteUrl('G1803')).get('citycode')

    expect(citycode).toBe('69123')
    expect(COMMUNE_CODES).not.toContain(citycode)
  })

  it('carries the trade and a radius that covers the swept perimeter', () => {
    const search = params(laBonneBoiteUrl('G1803'))

    expect(search.get('rome')).toBe('G1803')
    expect(Number(search.get('distance'))).toBeGreaterThanOrEqual(10)
  })
})

describe('the trades', () => {
  it('are all ROME codes', () => {
    for (const trade of TRADES) expect(trade.rome).toMatch(/^G\d{4}$/)
  })

  it('lists each one once', () => {
    const romes = TRADES.map((t) => t.rome)
    expect(new Set(romes).size).toBe(romes.length)
  })

  // G1606 and G1607 are the contract-catering trades — close enough to "cuisinier" to be
  // picked by mistake, and wrong for someone looking for a restaurant kitchen.
  it('leaves out the contract-catering trades', () => {
    const romes = TRADES.map((t) => t.rome)
    expect(romes).not.toContain('G1606')
    expect(romes).not.toContain('G1607')
  })
})

describe('Indeed', () => {
  it('encodes the query and pins the area', () => {
    const search = params(indeedUrl('chef de partie'))

    expect(search.get('q')).toBe('chef de partie')
    expect(search.get('l')).toBe('Lyon')
    expect(indeedUrl('chef de partie')).not.toContain(' ')
  })
})

describe("L'Hôtellerie Restauration", () => {
  // It cannot be pre-filtered — a query string here would be a silent no-op.
  it('is a bare section link', () => {
    expect(HOTELLERIE_RESTAURATION_URL).not.toContain('?')
  })
})
