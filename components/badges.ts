import { COMMUNE_CODES, COMMUNE_NAMES } from '@/lib/config'
import type { Category, Confidence, SplitShiftRisk } from '@/lib/hours'

/**
 * The one place where English enum values become French screen labels.
 *
 * The database, the inference engine and the URL all speak the enum; the reader is a
 * French hospitality worker. Translating anywhere else would leak French into the data
 * or English onto the screen.
 *
 * Wording is domain vocabulary, never technical: no numeric score is ever shown.
 */
export const SPLIT_SHIFT_BADGES: Record<
  SplitShiftRisk,
  { label: string; color: string; className: string }
> = {
  none:    { label: 'Sans coupure',          color: '#16a34a', className: 'bg-green-100 text-green-900 border-green-300' },
  low:     { label: 'Coupure peu probable',  color: '#84cc16', className: 'bg-lime-100 text-lime-900 border-lime-300' },
  medium:  { label: 'Coupure possible',      color: '#f59e0b', className: 'bg-amber-100 text-amber-900 border-amber-300' },
  high:    { label: 'Coupure probable',      color: '#dc2626', className: 'bg-red-100 text-red-900 border-red-300' },
  unknown: { label: 'Horaires inconnus',     color: '#a8a29e', className: 'bg-stone-100 text-stone-600 border-stone-300' },
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  confirmed: 'Confirmé',
  likely: 'Probable',
  unverified: 'À vérifier',
}

/** Insertion order drives the filter chips, so it is also the order on screen. */
export const CATEGORY_LABELS: Record<Category, string> = {
  restaurant: 'Restaurant', bistro: 'Bistrot / Brasserie', fine_dining: 'Gastronomique',
  fast_food: 'Restauration rapide', pizzeria: 'Pizzeria', bar: 'Bar', cafe: 'Café',
  bakery: 'Boulangerie / Pâtisserie', caterer: 'Traiteur / Livraison',
  canteen: 'Restauration collective', other: 'Autre',
}

/**
 * The categories offered as filter chips.
 *
 * `canteen` (2 establishments) and `fine_dining` (7) are left out: company canteens are
 * not on Google Maps because they are not open to the public, and Google barely uses
 * `fine_dining_restaurant`. A chip that can only ever return nothing is worse than no
 * chip. Both stay in the enum — `canteen` short-circuits the split-shift inference.
 */
export const FILTERABLE_CATEGORIES: Category[] = [
  'restaurant', 'bistro', 'fast_food', 'pizzeria', 'bar', 'cafe', 'bakery', 'caterer', 'other',
]

/**
 * Zone filter chips, derived from the sweep perimeter rather than listed by hand.
 *
 * A hand-written list drifted once already: it still offered Bron and Vénissieux after
 * D16 narrowed the perimeter, so those two chips could only ever return zero results.
 * Deriving them makes that drift impossible — the filter cannot offer a commune the
 * sweep never visits.
 *
 * Commune names are proper nouns: the translation to English leaves them alone.
 */
export const ZONES = COMMUNE_CODES.map((insee) => ({
  insee,
  label: COMMUNE_NAMES[insee] ?? insee,
}))

/**
 * Marker shape per category, so the map carries two dimensions at once: colour says
 * split-shift risk, shape says what kind of place it is.
 *
 * SVG paths centred on (0,0), sized for a ~16 px marker. Kept to simple geometry —
 * anything more detailed turns to mush at that size.
 */
export const CATEGORY_SHAPES: Record<Category, string> = {
  restaurant: 'M 0,-8 A 8,8 0 1,1 0,8 A 8,8 0 1,1 0,-8 Z',   // cercle
  bistro: 'M -7,-7 H 7 V 7 H -7 Z',                          // carré
  fine_dining: 'M 0,-9 L 9,0 L 0,9 L -9,0 Z',                // losange
  fast_food: 'M -9,-5 H 9 V 5 H -9 Z',                       // rectangle plat
  pizzeria: 'M 0,-8 L 8,6 L -8,6 Z',                         // triangle pointe en haut
  bar: 'M 0,8 L 8,-6 L -8,-6 Z',                             // triangle pointe en bas
  cafe: 'M -6,-6 H 6 L 4,7 H -4 Z',                          // tasse (trapèze)
  bakery: 'M 0,-8 L 7,-4 V 4 L 0,8 L -7,4 V -4 Z',           // hexagone
  caterer: 'M -2,-8 H 2 V -2 H 8 V 2 H 2 V 8 H -2 V 2 H -8 V -2 H -2 Z',  // croix
  canteen: 'M -6,-8 H 6 L 8,0 L 6,8 H -6 L -8,0 Z',          // octogone allongé
  other: 'M 0,-5 A 5,5 0 1,1 0,5 A 5,5 0 1,1 0,-5 Z',        // petit cercle
}

/** Shapes worth showing in the legend, in the order they read best. */
/** Only the shapes a user can actually meet in the filter, in the order they read best. */
export const SHAPE_LEGEND: Category[] = FILTERABLE_CATEGORIES

/**
 * Deep link to the establishment's own Google Maps page — the fastest way to check the
 * hours we inferred against reviews and photos.
 *
 * The documented `place_id` form is exact. Falling back to a name search would land on a
 * different establishment often enough to be worse than no link at all, so when there is
 * no place id we return null and the UI simply omits the link.
 */
export function googleMapsUrl(placeId: string | null | undefined): string | null {
  if (!placeId || placeId.startsWith('demo-')) return null
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
}
