/**
 * Demo dataset.
 *
 * The establishments are FICTIONAL — we do not fabricate fake data about real businesses.
 * The opening hours, on the other hand, go through exactly the same chain as the future
 * sweep: Google format -> parseOpeningHours -> computeProfile.
 * The day the keys arrive, only the source changes.
 */
import { computeProfile, parseOpeningHours } from '../lib/hours'
import type { Category, GooglePeriod } from '../lib/hours'
import { profileColumns } from '../lib/profile-columns'
import { db } from '../lib/db/client'
import { restaurant } from '../lib/db/schema'

type Service = [number, number, number, number] // openHour, openMinute, closeHour, closeMinute

/** Builds periods in Google's format. `day` 0 = Sunday. */
function periods(days: number[], services: Service[]): GooglePeriod[] {
  return days.flatMap((day) =>
    services.map(([openH, openM, closeH, closeM]) => {
      const afterMidnight = closeH * 60 + closeM <= openH * 60 + openM
      return {
        open: { day, hour: openH, minute: openM },
        close: { day: afterMidnight ? (day + 1) % 7 : day, hour: closeH, minute: closeM },
      }
    }),
  )
}

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0
const WEEKDAYS = [MON, TUE, WED, THU, FRI]
const TUE_TO_SAT = [TUE, WED, THU, FRI, SAT]
const EVERY_DAY = [MON, TUE, WED, THU, FRI, SAT, SUN]

interface Archetype {
  category: Category
  headcountCode: string | null
  periods: GooglePeriod[] | null
}

const ARCHETYPES: Record<string, Archetype> = {
  // Closed Sunday + Monday: two consecutive days off, but a certain split shift.
  lyonBistro: { category: 'bistro', headcountCode: '02', periods: periods(TUE_TO_SAT, [[12, 0, 14, 0], [19, 0, 22, 0]]) },
  // Continuous service, large team: no split shift possible.
  continuousBrasserie: { category: 'bistro', headcountCode: '12', periods: periods(EVERY_DAY, [[11, 30, 23, 0]]) },
  // The prize profile: neither split shift nor weekend.
  staffCanteen: { category: 'canteen', headcountCode: '11', periods: periods(WEEKDAYS, [[7, 0, 15, 0]]) },
  officeLunch: { category: 'bistro', headcountCode: '02', periods: periods(WEEKDAYS, [[11, 30, 15, 0]]) },
  // Split shift, but a mid-sized team: two partial services are conceivable.
  fineDining: { category: 'fine_dining', headcountCode: '03', periods: periods([WED, THU, FRI, SAT], [[12, 0, 13, 30], [19, 30, 21, 30]]) },
  fastFood: { category: 'fast_food', headcountCode: '11', periods: periods(EVERY_DAY, [[11, 0, 23, 0]]) },
  // Closing after midnight: the Google conversion pitfall.
  wineBar: { category: 'bar', headcountCode: '01', periods: periods(TUE_TO_SAT, [[17, 0, 1, 0]]) },
  eveningPizzeria: { category: 'pizzeria', headcountCode: '02', periods: periods([TUE, WED, THU, FRI, SAT, SUN], [[18, 30, 23, 0]]) },
  // Split shift in the opening hours, but 20+ employees: two brigades are likely.
  splitShiftBrasserie: { category: 'bistro', headcountCode: '12', periods: periods([MON, TUE, WED, THU, FRI, SAT], [[12, 0, 15, 0], [19, 0, 23, 0]]) },
  // Unknown headcount: the confidence must degrade visibly.
  splitShiftUnknownHeadcount: { category: 'bistro', headcountCode: null, periods: periods(TUE_TO_SAT, [[12, 0, 14, 30], [19, 0, 22, 30]]) },
  // Google does not know the opening hours: we display the place anyway.
  withoutHours: { category: 'other', headcountCode: '02', periods: null },
}

/**
 * Kept in sync with COMMUNE_CODES: demo data must not spread beyond the perimeter the
 * sweep actually covers (D16), otherwise the zone filter offers communes no real sweep
 * would ever populate.
 */
const ZONES: { commune: string; insee: string; district: number | null; lat: number; lng: number }[] = [
  { commune: 'Lyon 1er', insee: '69381', district: 1, lat: 45.7677, lng: 4.8336 },
  { commune: 'Lyon 2e', insee: '69382', district: 2, lat: 45.7500, lng: 4.8270 },
  { commune: 'Lyon 3e', insee: '69383', district: 3, lat: 45.7600, lng: 4.8560 },
  { commune: 'Lyon 4e', insee: '69384', district: 4, lat: 45.7750, lng: 4.8290 },
  { commune: 'Lyon 5e', insee: '69385', district: 5, lat: 45.7580, lng: 4.8180 },
  { commune: 'Lyon 6e', insee: '69386', district: 6, lat: 45.7700, lng: 4.8500 },
  { commune: 'Lyon 7e', insee: '69387', district: 7, lat: 45.7400, lng: 4.8420 },
  { commune: 'Lyon 8e', insee: '69388', district: 8, lat: 45.7330, lng: 4.8700 },
  { commune: 'Lyon 9e', insee: '69389', district: 9, lat: 45.7800, lng: 4.8050 },
  { commune: 'Villeurbanne', insee: '69266', district: null, lat: 45.7700, lng: 4.8800 },
]

/** Fictional names: no real establishment is described here. */
const DEMO_NAMES: [string, keyof typeof ARCHETYPES][] = [
  ['Le Tablier de Soie', 'lyonBistro'], ['Chez Mauricette', 'lyonBistro'],
  ['La Marmite Canut', 'lyonBistro'], ['Le Pot Renversé', 'lyonBistro'],
  ['Brasserie du Quai Perdu', 'continuousBrasserie'], ['Le Grand Balcon', 'continuousBrasserie'],
  ['Taverne des Trois Ponts', 'continuousBrasserie'],
  ['Restaurant Inter-Entreprises Novaris', 'staffCanteen'], ['Cantine Lumière Campus', 'staffCanteen'],
  ['Self du Parc Technologique', 'staffCanteen'], ['Table du Lycée Ampère-Sud', 'staffCanteen'],
  ['Le Midi Pile', 'officeLunch'], ['Cantoche & Compagnie', 'officeLunch'],
  ['Le Plateau du Jour', 'officeLunch'], ['Bento Presqu’Ile', 'officeLunch'],
  ['La Table d’Aristide', 'fineDining'], ['Maison Verdelet', 'fineDining'],
  ['L’Ardoise Blanche', 'fineDining'],
  ['Burger Fabrique', 'fastFood'], ['Wok Express Gerland', 'fastFood'], ['Tacos du Rhône', 'fastFood'],
  ['Le Verre à Moitié Plein', 'wineBar'], ['Bar des Serruriers', 'wineBar'],
  ['Comptoir Nocturne', 'wineBar'],
  ['Pizzeria Sole Mio', 'eveningPizzeria'], ['La Part du Feu', 'eveningPizzeria'],
  ['Forno Bellecour', 'eveningPizzeria'],
  ['Brasserie Grand Comptoir', 'splitShiftBrasserie'], ['Le Régent des Halles', 'splitShiftBrasserie'],
  ['Brasserie de la Gare Nord', 'splitShiftBrasserie'],
  ['Le Petit Sillon', 'splitShiftUnknownHeadcount'], ['Auberge des Deux Rives', 'splitShiftUnknownHeadcount'],
  ['Chez Norbert', 'splitShiftUnknownHeadcount'], ['La Cuisine d’Emma', 'splitShiftUnknownHeadcount'],
  ['Le Bouchon Discret', 'splitShiftUnknownHeadcount'],
  ['Snack Rive Gauche', 'withoutHours'], ['Le Zinc Oublié', 'withoutHours'],
]

/** Deterministic pseudo-random: the seed has to be reproducible. */
function seededRandom(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

async function main() {
  const rnd = seededRandom(42)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000)

  const rows = DEMO_NAMES.map(([name, key], i) => {
    const archetype = ARCHETYPES[key]
    const zone = ZONES[i % ZONES.length]
    const hours = archetype.periods ? { periods: archetype.periods } : null
    const windows = parseOpeningHours(hours)
    const profile = computeProfile({
      windows,
      headcountCode: archetype.headcountCode,
      category: archetype.category,
    })

    return {
      googlePlaceId: `demo-${String(i + 1).padStart(3, '0')}`,
      name,
      formattedAddress: `${1 + Math.floor(rnd() * 90)} rue de la Démonstration, ${zone.commune}`,
      lat: zone.lat + (rnd() - 0.5) * 0.012,
      lng: zone.lng + (rnd() - 0.5) * 0.016,
      googleTypes: ['restaurant'],
      businessStatus: 'OPERATIONAL',
      inseeCode: zone.insee,
      commune: zone.commune,
      district: zone.district,
      category: archetype.category,
      phone: `04 78 ${10 + Math.floor(rnd() * 89)} ${10 + Math.floor(rnd() * 89)} ${10 + Math.floor(rnd() * 89)}`,
      siret: archetype.headcountCode ? String(10000000000000 + Math.floor(rnd() * 8999999999999)) : null,
      headcountCode: archetype.headcountCode,
      rawOpeningHours: hours,
      hoursFetchedAt: hours ? now : null,
      hoursExpiresAt: hours ? expiresAt : null,
      ...profileColumns(windows, profile),
      profileComputedAt: now,
    }
  })

  await db.delete(restaurant)
  await db.insert(restaurant).values(rows)

  console.log(`${rows.length} demo establishments inserted`)
  const byRisk = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.splitShiftRisk] = (acc[r.splitShiftRisk] ?? 0) + 1
    return acc
  }, {})
  console.log('split-shift risk distribution:', byRisk)
  console.log('no split shift AND free weekend:',
    rows.filter((r) => r.splitShiftRisk === 'none' && r.closedWeekend).length)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
