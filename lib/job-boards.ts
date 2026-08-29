/**
 * Outbound links to the job boards, for the reader who wants to see what is actually
 * posted.
 *
 * The tool still never says whether a given establishment recruits (D1): every link here
 * is scoped to a trade and to the area, never to one establishment. That is why nothing in
 * this module takes a restaurant as an argument — the constraint is enforced by the
 * signatures, not by discipline.
 *
 * Static URLs only. The online app calls no external API (.specs/technique/00-architecture),
 * which also keeps the feature at zero euro and free of any third-party outage.
 *
 * See D26.
 */

/**
 * The global Lyon commune code — and the exact opposite of the SIRENE rule.
 *
 * SIRENE codes Lyon by district (69381-69389) and never 69123; La Bonne Boîte wants 69123
 * and knows nothing of the district codes. Wiring `COMMUNE_CODES` from lib/config into this
 * URL returns an empty result page without raising anything, so the two referentials are
 * kept apart on purpose.
 */
const LYON_CITY_CODE = '69123'

/**
 * Radius in kilometres. 10 km from the centre of Lyon already covers the whole swept
 * perimeter (Lyon 1st-9th + Villeurbanne, D16), so the block never has to follow the zone
 * filter. It also reaches beyond it — La Bonne Boîte is another tool with its own scope,
 * and we display none of its results.
 */
const SEARCH_RADIUS_KM = 10

/**
 * Hospitality trades, as ROME codes.
 *
 * Each code was read back from La Bonne Boîte's own autocomplete rather than guessed: a
 * wrong ROME silently returns the wrong trade, never an error. `G1606` and `G1607` look
 * like the missing "cuisinier" but are the contract-catering trades — the reason plain
 * cuisinier is absent here.
 *
 * Labels are French: they are read on screen. They are also kept to one short word where
 * one exists — the panel is 16rem wide, and the paired forms ("Serveur / Serveuse") each
 * take a full row, turning eight chips into eight lines. The board itself shows the
 * official trade name on arrival.
 */
export const TRADES = [
  { rome: 'G1803', label: 'Serveur' },
  { rome: 'G1601', label: 'Chef de cuisine' },
  { rome: 'G1602', label: 'Commis' },
  { rome: 'G1605', label: 'Plongeur' },
  { rome: 'G1801', label: 'Barman' },
  { rome: 'G1802', label: 'Maître d’hôtel' },
  { rome: 'G1603', label: 'Restauration rapide' },
  { rome: 'G1604', label: 'Pizzaïolo' },
] as const

export type Trade = (typeof TRADES)[number]

/**
 * La Bonne Boîte ranks companies by hiring potential and exists for spontaneous
 * applications — the same premise as this directory, which is why it leads the block.
 */
export function laBonneBoiteUrl(rome: string): string {
  const params = new URLSearchParams({
    rome,
    citycode: LYON_CITY_CODE,
    distance: String(SEARCH_RADIUS_KM),
  })
  return `https://labonneboite.francetravail.fr/recherche?${params}`
}

/** The widest net, and the one worth opening when the trade-scoped search comes up short. */
export function indeedUrl(query: string): string {
  const params = new URLSearchParams({ q: query, l: 'Lyon' })
  return `https://fr.indeed.com/jobs?${params}`
}

export const INDEED_QUERY = 'restauration'

/**
 * A constant rather than a builder, and it has to stay one: the board's search is a POST
 * form carrying an ASP.NET `__RequestVerificationToken`, so no query string reproduces a
 * filtered search, and there are no per-region landing pages either. The reader picks the
 * area on arrival.
 */
export const HOTELLERIE_RESTAURATION_URL =
  'https://www.lhotellerie-restauration.fr/emploi/emploi-hotel-restaurant'
