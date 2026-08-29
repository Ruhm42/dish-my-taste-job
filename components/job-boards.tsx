import {
  HOTELLERIE_RESTAURATION_URL, INDEED_QUERY, TRADES, indeedUrl, laBonneBoiteUrl,
} from '@/lib/job-boards'

/**
 * Where to go when the reader wants the offers this directory deliberately does not carry.
 *
 * Static markup, no state: the trades are eight links, not a picker. It therefore renders
 * from the client panel and from the server page alike.
 *
 * The wording says *chercher*, never *recrute*. This block is a signpost to somewhere else,
 * and reading it as a statement about any establishment on screen would be reading it wrong.
 */
export function JobBoards() {
  return (
    <section id="offres" className="space-y-2 border-t border-stone-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Trouver des offres
      </h3>
      <p className="text-xs text-stone-600">
        Cet annuaire ne dit pas qui recrute. Pour les offres publiées :
      </p>

      <p className="text-xs text-stone-500">Par métier, sur La Bonne Boîte</p>
      <div className="flex flex-wrap gap-1.5">
        {TRADES.map((trade) => (
          <a
            key={trade.rome}
            href={laBonneBoiteUrl(trade.rome)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs transition hover:border-stone-500"
          >
            {trade.label}
          </a>
        ))}
      </div>

      <div className="flex flex-col items-start gap-1 pt-1">
        <Board href={indeedUrl(INDEED_QUERY)}>Indeed — offres à Lyon</Board>
        {/* No Lyon in this one: the board cannot be pre-filtered by URL. See lib/job-boards. */}
        <Board href={HOTELLERIE_RESTAURATION_URL}>L’Hôtellerie Restauration</Board>
      </div>
    </section>
  )
}

function Board({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-stone-600 underline"
    >
      {children} ↗
    </a>
  )
}
