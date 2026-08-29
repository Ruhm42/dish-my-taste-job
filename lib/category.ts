import type { Category } from './hours'

/**
 * Establishment category and cuisine, inferred from Google types, the SIRENE activity
 * code, and the name.
 *
 * The category serves two purposes: it is a filter exposed to the user, and it is an
 * inference shortcut — contract catering short-circuits the whole split-shift reasoning.
 * See .specs/technique/05-inference-des-horaires.md, step 5.
 *
 * THE ORDER OF `types` CARRIES MEANING. Google puts the primary type first, and it alone
 * settles 94.8% of establishments. An earlier version collapsed the array into a Set,
 * which destroyed that order and left 41.6% of the database in `other`. It also tested
 * the drinks-licence activity code before anything else, which would have filed 600
 * bar-and-restaurant places — the ordinary French café-restaurant — under `bar`.
 *
 * `other` means "no clue", not "something else". A caller that already holds a category
 * must not overwrite it with this value.
 */

/** The activity code is written `56.10C` in config and `5610C` in the SIRENE stock file. */
const stripSeparators = (code: string): string => code.toUpperCase().replace(/[^0-9A-Z]/g, '')

const NAF_CANTEEN = ['56.29A', '56.29B'].map(stripSeparators)

/**
 * Google type → category. Keyed on the PRIMARY type first, then used again as a fallback
 * scan over the rest of the array.
 *
 * Cuisine-specific types (`italian_restaurant`, `japanese_restaurant`…) deliberately map
 * to plain `restaurant`: the cuisine is reported separately, and it says nothing about the
 * working rhythm, which is what this product is about.
 */
const TYPE_TO_CATEGORY: Record<string, Category> = {
  // Bars and nightlife
  bar: 'bar', pub: 'bar', wine_bar: 'bar', cocktail_bar: 'bar', sports_bar: 'bar',
  night_club: 'bar', beer_garden: 'bar', beer_hall: 'bar', irish_pub: 'bar',
  bar_and_grill: 'bar', karaoke: 'bar',

  // Coffee and tea — a different rhythm from a bar, and from a restaurant
  cafe: 'cafe', coffee_shop: 'cafe', tea_house: 'cafe', internet_cafe: 'cafe',
  cat_cafe: 'cafe', dog_cafe: 'cafe',

  // Counter service
  fast_food_restaurant: 'fast_food', hamburger_restaurant: 'fast_food',
  sandwich_shop: 'fast_food', kebab_shop: 'fast_food', taco_restaurant: 'fast_food',
  salad_shop: 'fast_food', meal_takeaway: 'fast_food', food_court: 'fast_food',
  chicken_restaurant: 'fast_food', bagel_shop: 'fast_food', juice_shop: 'fast_food',
  acai_shop: 'fast_food', pizza_delivery: 'fast_food',

  pizza_restaurant: 'pizzeria',

  // Baking and sweets: very early starts, no split shift, a trade of its own
  bakery: 'bakery', pastry_shop: 'bakery', confectionery: 'bakery',
  dessert_shop: 'bakery', dessert_restaurant: 'bakery', ice_cream_shop: 'bakery',
  chocolate_shop: 'bakery', chocolate_factory: 'bakery', donut_shop: 'bakery',
  candy_store: 'bakery', bagel_bakery: 'bakery',

  // No dining room at all
  catering_service: 'caterer', meal_delivery: 'caterer', food_delivery: 'caterer',

  // French sit-down, where bistro and brasserie are indistinguishable in the data
  bistro: 'bistro', french_restaurant: 'bistro', brasserie: 'bistro',
  family_restaurant: 'bistro', brunch_restaurant: 'bistro',
  breakfast_restaurant: 'bistro',

  fine_dining_restaurant: 'fine_dining',

  restaurant: 'restaurant',
}

/**
 * Google type → French cuisine label, shown as secondary information.
 *
 * `french_restaurant` is absent on purpose: in a Lyon directory, saying "cuisine française"
 * on a bistro is noise.
 */
const TYPE_TO_CUISINE: Record<string, string> = {
  italian_restaurant: 'italien', pizza_restaurant: 'italien',
  japanese_restaurant: 'japonais', sushi_restaurant: 'japonais',
  ramen_restaurant: 'japonais', yakitori_restaurant: 'japonais',
  chinese_restaurant: 'chinois', hot_pot_restaurant: 'chinois',
  dumpling_restaurant: 'chinois',
  indian_restaurant: 'indien', indonesian_restaurant: 'indonésien',
  thai_restaurant: 'thaï', vietnamese_restaurant: 'vietnamien',
  korean_restaurant: 'coréen', asian_restaurant: 'asiatique',
  ramen_shop: 'japonais', noodle_shop: 'asiatique',
  lebanese_restaurant: 'libanais', turkish_restaurant: 'turc',
  middle_eastern_restaurant: 'moyen-oriental', afghani_restaurant: 'afghan',
  african_restaurant: 'africain', moroccan_restaurant: 'marocain',
  mediterranean_restaurant: 'méditerranéen', greek_restaurant: 'grec',
  spanish_restaurant: 'espagnol', portuguese_restaurant: 'portugais',
  mexican_restaurant: 'mexicain', brazilian_restaurant: 'brésilien',
  american_restaurant: 'américain', hamburger_restaurant: 'américain',
  steak_house: 'grillades', barbecue_restaurant: 'grillades',
  seafood_restaurant: 'fruits de mer',
  vegetarian_restaurant: 'végétarien', vegan_restaurant: 'végétalien',
  halal_restaurant: 'halal', kosher_restaurant: 'casher',
  buffet_restaurant: 'buffet',
}

/**
 * Primary types that are not eating places, whatever else Google lists alongside.
 *
 * The sweep asks for `meal_takeaway` among others, so a Carrefour City comes back as a
 * result. Without this guard the fallback scan finds that type and files 61 supermarkets
 * under "restauration rapide" — plausible-looking rows that are not jobs in the trade.
 *
 * Hotels are deliberately absent: a hotel-restaurant is a real employer, and its
 * secondary types describe it correctly.
 */
const NOT_AN_EATING_PLACE = new Set([
  'supermarket', 'grocery_store', 'convenience_store', 'liquor_store', 'wine_store',
  'wholesaler', 'gas_station', 'department_store', 'shopping_mall', 'market',
  'butcher_shop', 'fish_market', 'cheese_shop', 'food_store', 'farm', 'manufacturer',
  'gym', 'school', 'university', 'hospital', 'corporate_office',
])

// French keywords, matched against French establishment names. Last resort only.
const NAME_RULES: [RegExp, Category][] = [
  [/bouchon|bistro|estaminet|troquet/, 'bistro'],
  [/brasserie|taverne/, 'bistro'],
  [/pizz/, 'pizzeria'],
  [/boulangerie|patisserie|viennoiserie/, 'bakery'],
  [/traiteur/, 'caterer'],
  [/gastronomi/, 'fine_dining'],
]

/** Lowercase without accents: "Pizzéria" and "PIZZERIA" must hit the same rule. */
const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export interface CategorySignals {
  /** The establishment's `googleTypes`. ORDER MATTERS: index 0 is Google's primary type. */
  types?: readonly string[] | null
  /** SIRENE activity code, null until the establishment is matched. */
  naf?: string | null
  name?: string | null
}

export function inferCategory({ types, naf, name }: CategorySignals): Category {
  const list = (types ?? []).map((x) => x.toLowerCase())
  const code = naf ? stripSeparators(naf) : ''

  // 1. The activity code wins for canteens, and only for canteens: it is a declared
  // signal, and it short-circuits the split-shift inference. Getting it wrong here would
  // wrongly assert "no split shift" — the one error the user cannot detect.
  if (NAF_CANTEEN.includes(code)) return 'canteen'

  // 2. A shop is a shop. Checked before anything else Google says, because these places
  // carry food-service types they do not deserve.
  if (list[0] && NOT_AN_EATING_PLACE.has(list[0])) return 'other'

  // 3. Google's primary type, and we stop there when we recognise it — INCLUDING when it
  // is plain `restaurant`.
  //
  // Scanning further would be a trap: 600 establishments carry both `restaurant` and
  // `bar`, the ordinary French café-restaurant. If Google's primary type says restaurant,
  // a `bar` sitting further down the array is a facility the place happens to have, not
  // what the place is.
  const primary = list[0] ? TYPE_TO_CATEGORY[list[0]] : undefined
  if (primary) return primary

  // 4. The primary type is one we do not map — `store`, `event_venue`, `service`… Only
  // now is it worth scanning the rest, in order, so the most relevant one wins.
  for (const t of list.slice(1)) {
    const mapped = TYPE_TO_CATEGORY[t]
    if (mapped) return mapped
  }

  // 5. A cuisine-specific type means a sit-down restaurant, whatever the cuisine.
  if (list.some((t) => t in TYPE_TO_CUISINE)) return 'restaurant'

  // 6. The name, as a last resort.
  const n = name ? normalizeName(name) : ''
  if (n) {
    for (const [pattern, category] of NAME_RULES) {
      if (pattern.test(n)) return category
    }
  }

  return 'other'
}

/**
 * French cuisine label, or null when Google says nothing specific.
 *
 * Reads the types in order so the primary one wins: a place listed as
 * `japanese_restaurant, sushi_restaurant` reads "japonais", not "japonais" twice over.
 */
export function inferCuisine(types?: readonly string[] | null): string | null {
  for (const t of types ?? []) {
    const cuisine = TYPE_TO_CUISINE[t.toLowerCase()]
    if (cuisine) return cuisine
  }
  return null
}
