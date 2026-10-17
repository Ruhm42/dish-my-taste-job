/**
 * Name comparison for the Google <-> SIRENE matching, as SQL fragments.
 *
 * Written in SQL so that `similarity()` compares two strings prepared the same way, inside
 * the one query that pairs every candidate. Kept apart from scripts/match-sirene.ts, which
 * connects at import time, so the tests can run these exact fragments against pg_trgm.
 */

/**
 * Trigram similarity threshold. Tunable — it is the one number in the matching that will
 * need calibrating against real data, hence match:sirene's `--threshold`.
 * Too low and we pin wrong headcounts; too high and we lose legitimate matches, dropping
 * the split-shift filter back to its degraded mode.
 */
export const DEFAULT_THRESHOLD = 0.45

/** Domain stop words: present everywhere, therefore discriminating nowhere. */
const STOP_WORDS = [
  'restaurant', 'le', 'la', 'les', 'chez', 'aux', 'du', 'de', 'brasserie', 'bar', 'cafe',
]

/**
 * A name that normalization shrinks below 3 characters discriminates nothing any more
 * ("Le Bar" becomes empty): we would rather not match at all.
 */
const MIN_NAME_LENGTH = 3

/**
 * Places Google appends to a sign: "INADA Confluence", "Le Plan B - Lyon Brotteaux". Written
 * as they read after normalization: lowercase, no accent, a space for each hyphen or
 * apostrophe.
 *
 * Only the names of places, never a word that also names a business: "Tonkin", "Cusset" or
 * "Saint-Jean" would strip the sign itself. And only on the Google side: there the place is
 * an addition, while in the registry it is the name — "BRASSERIE DE VAISE" would strip to
 * nothing.
 */
const PLACE_TOKENS = [
  'lyon', 'villeurbanne',
  'presqu ile', 'terreaux', 'cordeliers', 'jacobins', 'bellecour', 'ainay', 'perrache',
  'confluence', 'croix rousse', 'vieux lyon', 'fourviere', 'brotteaux', 'part dieu',
  'tete d or', 'guillotiere', 'jean mace', 'gerland', 'monplaisir', 'montchat',
  'grange blanche', 'vaise', 'duchere', 'gorge de loup', 'charpennes', 'gratte ciel',
  'croix luizet', 'grandclement',
  // A street, but Google labels chain branches with it: without it "Sushi Shop Lyon Vitton"
  // outscored "SUSHI CORP VITTON" for the registry's "SUSHI VITTON".
  'vitton',
]

/**
 * Where a Google name stops being the sign: "Bombay Palace - Restaurant Indien - Buffet à
 * volonté - Lyon 5". A hyphen counts only between spaces, or "Croix-Rousse" would be cut.
 */
const SUFFIX = '( - | [|] | : |[•(,]).*$'

/**
 * Name normalization. Written once and applied to BOTH sides: a divergence between the two
 * normalizations would sink the match rate without a single message.
 *
 * `unaccent` is not installed (only `pg_trgm` is), hence the explicit `translate`.
 * Ligatures come first, because they unfold into two letters.
 */
function normalized(column: string, words: string[]): string {
  return `btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(replace(replace(lower(${column}), 'œ', 'oe'), 'æ', 'ae'),
                  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                  'aaaaaaceeeeiiiinooooouuuuyy'),
        '[^a-z0-9]+', ' ', 'g'),
      '\\y(${words.join('|')})\\y', ' ', 'g'),
    '\\s+', ' ', 'g'))`
}

/**
 * A Google name gets a second reading, stripped of its suffix and its places. The full one
 * stays: "Brasserie des Brotteaux" strips to almost nothing and must still find its record.
 */
export function googleNameColumns(column: string): string {
  return `${normalized(column, STOP_WORDS)} AS normalized_name,
    ${normalized(`regexp_replace(${column}, '${SUFFIX}', '')`, [...STOP_WORDS, ...PLACE_TOKENS])}
      AS stripped_name`
}

export function sireneNameColumns(column: string): string {
  return `${normalized(column, STOP_WORDS)} AS normalized_name`
}

/**
 * The better of the two Google readings against the SIRENE name; `google` and `sirene` are
 * the aliases of the rows holding those columns. A reading counts only when it is long
 * enough to discriminate.
 */
export function nameScore(google: string, sirene: string): string {
  const reading = (name: string) => `CASE
    WHEN length(${name}) >= ${MIN_NAME_LENGTH} AND length(${sirene}.normalized_name) >= ${MIN_NAME_LENGTH}
    THEN similarity(${name}, ${sirene}.normalized_name) ELSE 0 END`
  return `GREATEST(${reading(`${google}.normalized_name`)}, ${reading(`${google}.stripped_name`)})`
}
