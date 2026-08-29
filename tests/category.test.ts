import { describe, expect, it } from 'vitest'
import { inferCategory, inferCuisine } from '@/lib/category'

const cat = (types: string[] | null, naf?: string | null, name?: string | null) =>
  inferCategory({ types, naf, name })

// ─────────────────────────────────────────────────────────────
// The order of `types` is the whole point. These are the tests
// that would have caught the 41.6% "other" defect.
// ─────────────────────────────────────────────────────────────
describe('the primary type decides', () => {
  it('reads types[0] and stops there', () => {
    expect(cat(['bar', 'restaurant', 'point_of_interest'])).toBe('bar')
    expect(cat(['restaurant', 'bar', 'point_of_interest'])).toBe('restaurant')
  })

  it('never lets a secondary `bar` override a primary `restaurant`', () => {
    // 600 establishments carry both: the ordinary French café-restaurant. Scanning the
    // array without regard for order filed every one of them under `bar`.
    expect(cat(['restaurant', 'bar', 'cafe', 'food'])).toBe('restaurant')
  })

  it('does not let a secondary `restaurant` soften a primary `bar`', () => {
    expect(cat(['cocktail_bar', 'restaurant', 'food'])).toBe('bar')
  })
})

describe('the declared activity code wins for canteens', () => {
  it('overrides any Google type', () => {
    expect(cat(['restaurant', 'bar'], '56.29A')).toBe('canteen')
    expect(cat(['fast_food_restaurant'], '56.29B')).toBe('canteen')
  })

  it('accepts the SIRENE stock spelling without separators', () => {
    expect(cat(['restaurant'], '5629A')).toBe('canteen')
  })

  it('applies to no other activity code — a drinks licence is not a category', () => {
    // 56.30Z covers 958 establishments, many of them restaurants that also serve drinks.
    expect(cat(['restaurant'], '56.30Z')).toBe('restaurant')
  })
})

describe('fallbacks, in order', () => {
  it('scans the rest only when the primary type is unknown to us', () => {
    expect(cat(['store', 'bakery', 'food'])).toBe('bakery')
    expect(cat(['event_venue', 'bar'])).toBe('bar')
  })

  it('treats a cuisine-specific type as a sit-down restaurant', () => {
    expect(cat(['japanese_restaurant', 'food'])).toBe('restaurant')
    expect(cat(['store', 'lebanese_restaurant'])).toBe('restaurant')
  })

  it('falls back to the name, accents and case notwithstanding', () => {
    expect(cat(['store'], null, 'Pizzéria Da Vinci')).toBe('pizzeria')
    expect(cat(['store'], null, 'Le Bouchon des Canuts')).toBe('bistro')
    expect(cat(['point_of_interest'], null, 'BOULANGERIE Rivoire')).toBe('bakery')
  })

  it('returns `other` when nothing is known, without throwing', () => {
    expect(cat([])).toBe('other')
    expect(cat(null)).toBe('other')
    expect(cat(['store', 'point_of_interest'])).toBe('other')
    expect(inferCategory({})).toBe('other')
  })
})

describe('shops are not eating places', () => {
  it('never files a supermarket under fast food, whatever else Google lists', () => {
    // The sweep asks for `meal_takeaway`, so a convenience store comes back as a result.
    // Without a guard, 61 supermarkets landed in "restauration rapide".
    expect(cat(['supermarket', 'meal_takeaway', 'food', 'store'])).toBe('other')
    expect(cat(['grocery_store', 'restaurant'])).toBe('other')
    expect(cat(['gas_station', 'meal_takeaway'])).toBe('other')
    expect(cat(['liquor_store', 'bar'])).toBe('other')
  })

  it('keeps hotels: a hotel-restaurant is a real employer in the trade', () => {
    expect(cat(['hotel', 'restaurant'])).toBe('restaurant')
    expect(cat(['hotel', 'bar'])).toBe('bar')
  })

  it('does not mistake a bakery for a shop', () => {
    expect(cat(['bakery', 'store', 'food'])).toBe('bakery')
  })
})

describe('the categories that carry a rhythm of their own', () => {
  it('files counter service under fast_food', () => {
    for (const t of ['fast_food_restaurant', 'sandwich_shop', 'kebab_shop', 'taco_restaurant']) {
      expect(cat([t])).toBe('fast_food')
    }
  })

  it('separates cafés from bars — the working day is not the same', () => {
    expect(cat(['coffee_shop'])).toBe('cafe')
    expect(cat(['tea_house'])).toBe('cafe')
    expect(cat(['wine_bar'])).toBe('bar')
  })

  it('files baking and sweets together: early starts, no split shift', () => {
    for (const t of ['bakery', 'pastry_shop', 'confectionery', 'ice_cream_shop']) {
      expect(cat([t])).toBe('bakery')
    }
  })

  it('files the trades with no dining room under caterer', () => {
    expect(cat(['catering_service'])).toBe('caterer')
    expect(cat(['meal_delivery'])).toBe('caterer')
  })

  it('merges bistrot and brasserie — the data cannot tell them apart', () => {
    expect(cat(['bistro'])).toBe('bistro')
    expect(cat(['french_restaurant'])).toBe('bistro')
    expect(cat(['brasserie'])).toBe('bistro')
  })
})

// ─────────────────────────────────────────────────────────────
// Cuisine: information, not a filter
// ─────────────────────────────────────────────────────────────
describe('cuisine', () => {
  it('reads the primary type first', () => {
    expect(inferCuisine(['japanese_restaurant', 'sushi_restaurant'])).toBe('japonais')
    expect(inferCuisine(['restaurant', 'italian_restaurant'])).toBe('italien')
  })

  it('says nothing when Google says nothing specific', () => {
    expect(inferCuisine(['restaurant', 'bar'])).toBeNull()
    expect(inferCuisine([])).toBeNull()
    expect(inferCuisine(null)).toBeNull()
  })

  it('stays silent on French cuisine — in a Lyon directory it is noise', () => {
    expect(inferCuisine(['french_restaurant'])).toBeNull()
  })

  it('is independent of the category: a pizzeria is still Italian', () => {
    expect(cat(['pizza_restaurant'])).toBe('pizzeria')
    expect(inferCuisine(['pizza_restaurant'])).toBe('italien')
  })
})
