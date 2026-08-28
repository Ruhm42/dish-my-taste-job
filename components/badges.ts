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
  bistro: 'Bistrot', brasserie: 'Brasserie', fine_dining: 'Gastronomique',
  fast_food: 'Restauration rapide', canteen: 'Restauration collective',
  bar: 'Bar', pizzeria: 'Pizzeria', other: 'Autre',
}

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
