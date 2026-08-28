import { and, eq, gte, ilike, inArray, or, type SQL } from 'drizzle-orm'
import { restaurant } from './db/schema'

export interface Filtres {
  zones: string[]
  coupure: 'sans' | 'sans-ou-probable' | ''
  weekend: 'libre' | 'dimanche' | ''
  repos2: boolean
  categories: string[]
  taille: 'petit' | 'moyen' | 'grand' | ''
  q: string
}

const EFFECTIFS: Record<string, string[]> = {
  petit: ['00', '01', '02'],
  moyen: ['03', '11'],
  grand: ['12', '21', '22', '31', '32', '41', '42', '51', '52', '53'],
}

const liste = (v: string | string[] | undefined): string[] =>
  !v ? [] : Array.isArray(v) ? v : [v]

export function lireFiltres(params: Record<string, string | string[] | undefined>): Filtres {
  const un = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]) ?? ''
  return {
    zones: liste(params.zone),
    coupure: un('coupure') as Filtres['coupure'],
    weekend: un('weekend') as Filtres['weekend'],
    repos2: un('repos2') === '1',
    categories: liste(params.categorie),
    taille: un('taille') as Filtres['taille'],
    q: un('q').trim(),
  }
}

/** Le filtrage porte entièrement sur les colonnes dénormalisées : aucune déduction ici. */
export function construireConditions(f: Filtres): SQL | undefined {
  const c: (SQL | undefined)[] = []

  if (f.zones.length) c.push(inArray(restaurant.inseeCode, f.zones))

  if (f.coupure === 'sans') c.push(eq(restaurant.coupureRisk, 'aucun'))
  else if (f.coupure === 'sans-ou-probable') {
    c.push(inArray(restaurant.coupureRisk, ['aucun', 'faible']))
  }

  if (f.weekend === 'libre') c.push(eq(restaurant.closedWeekend, true))
  else if (f.weekend === 'dimanche') c.push(eq(restaurant.closedSunday, true))

  if (f.repos2) c.push(gte(restaurant.maxConsecutiveDaysOff, 2))
  if (f.categories.length) c.push(inArray(restaurant.categorie, f.categories as never[]))
  if (f.taille && EFFECTIFS[f.taille]) c.push(inArray(restaurant.effectifCode, EFFECTIFS[f.taille]))

  if (f.q) {
    c.push(or(ilike(restaurant.name, `%${f.q}%`), ilike(restaurant.commune, `%${f.q}%`)))
  }

  const actives = c.filter(Boolean) as SQL[]
  return actives.length ? and(...actives) : undefined
}

export function compterActifs(f: Filtres): number {
  return [
    f.zones.length > 0, !!f.coupure, !!f.weekend, f.repos2,
    f.categories.length > 0, !!f.taille, !!f.q,
  ].filter(Boolean).length
}
