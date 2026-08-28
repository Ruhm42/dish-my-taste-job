import type { Category } from './hours'

/**
 * Infers the establishment category from the only three signals available:
 * Google types, SIRENE activity code, name.
 *
 * The category serves two purposes: it is a filter exposed to the user, and it is an
 * inference shortcut — contract catering short-circuits the whole split-shift
 * reasoning. See .specs/technique/05-inference-des-horaires.md, step 5.
 *
 * `other` means "no clue", not "something else". A caller that already holds a
 * category must not overwrite it with this value.
 */

/** The activity code is written `56.10C` in config and `5610C` in the SIRENE stock file. */
const stripSeparators = (code: string): string => code.toUpperCase().replace(/[^0-9A-Z]/g, '')

const NAF_CANTEEN = ['56.29A', '56.29B'].map(stripSeparators)
const NAF_FAST_FOOD = stripSeparators('56.10C')
const NAF_BAR = stripSeparators('56.30Z')

/**
 * Google names the same concept `fast_food_restaurant` (Places v1) or `fast_food`
 * (older API): we look for the fragment rather than enumerate the variants.
 */
const FAST_FOOD_FRAGMENT = 'fast_food'
const PIZZA_FRAGMENT = 'pizza'

const OTHER_FAST_FOOD_TYPES = new Set(['hamburger_restaurant', 'sandwich_shop'])

/** Exact match, otherwise `barbecue_restaurant` would become a bar. */
const BAR_TYPES = new Set(['bar', 'pub', 'wine_bar'])

const FINE_DINING_TYPE = 'fine_dining_restaurant'

// French keywords: they are matched against French establishment names.
const FINE_DINING_WORDS = /gastronomi/
const BRASSERIE_WORDS = /brasserie|taverne/
const BISTRO_WORDS = /bistro|bouchon|estaminet|troquet/

/** Lowercase without accents: "Pizzéria" and "PIZZERIA" must hit the same rule. */
const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export interface CategorySignals {
  /** The establishment's `googleTypes`. */
  types?: readonly string[] | null
  /** SIRENE activity code, null until the establishment is matched. */
  naf?: string | null
  name?: string | null
}

export function inferCategory({ types, naf, name }: CategorySignals): Category {
  const t = new Set((types ?? []).map((x) => x.toLowerCase()))
  const code = naf ? stripSeparators(naf) : ''
  const n = name ? normalizeName(name) : ''

  const someTypeContains = (fragment: string) => [...t].some((x) => x.includes(fragment))

  // The activity code wins: it is the only declared signal, the other two are marketing.
  // Canteen comes first because it short-circuits the split-shift inference — getting it
  // wrong here would wrongly assert "no split shift".
  if (NAF_CANTEEN.includes(code)) return 'canteen'

  if (code === NAF_FAST_FOOD || someTypeContains(FAST_FOOD_FRAGMENT)) return 'fast_food'
  if ([...t].some((x) => OTHER_FAST_FOOD_TYPES.has(x))) return 'fast_food'

  if (code === NAF_BAR || [...t].some((x) => BAR_TYPES.has(x))) return 'bar'

  if (someTypeContains(PIZZA_FRAGMENT) || /pizz/.test(n)) return 'pizzeria'

  if (t.has(FINE_DINING_TYPE) || FINE_DINING_WORDS.test(n)) return 'fine_dining'
  if (BRASSERIE_WORDS.test(n)) return 'brasserie'
  if (BISTRO_WORDS.test(n)) return 'bistro'

  return 'other'
}
