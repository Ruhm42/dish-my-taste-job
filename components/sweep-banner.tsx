import type { SweepProgress } from '@/lib/results'

const fr = (n: number) => n.toLocaleString('fr-FR')

/**
 * Says how incomplete the database is, in measured numbers.
 *
 * A `<details>` rather than a `title` tooltip: a title attribute never opens on a touch
 * screen, and this is exactly the kind of caveat a reader on a phone should be able to
 * reach.
 *
 * What it deliberately does NOT show is an estimated total. A truncated cell returned the
 * 20-result cap and hid an unknown number beyond it — the count is censored, and putting
 * a number on it would dress a guess up as a measurement.
 */
export function SweepBanner({ progress }: { progress: SweepProgress }) {
  const { found, queried, pending, truncated, sirene } = progress

  return (
    <details className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <summary className="cursor-pointer list-none">
        <span className="underline decoration-dotted underline-offset-2">
          Balayage en cours
        </span>
        {' — '}
        <strong>{fr(found)}</strong> établissements trouvés,{' '}
        <strong>{fr(pending)}</strong> zones restent à explorer
      </summary>

      <div className="mt-2 max-w-prose space-y-1.5 border-t border-amber-200 pt-2 font-normal">
        <p>
          Le balayage découpe la ville en zones et interroge chacune séparément.
          {' '}<strong>{fr(queried)}</strong> ont été interrogées,{' '}
          <strong>{fr(pending)}</strong> attendent leur tour.
        </p>

        {truncated > 0 && (
          <p>
            <strong>{fr(truncated)}</strong> zones ont renvoyé le maximum de 20 résultats :
            elles en cachaient donc davantage et seront redécoupées en quatre. Le nombre
            total de zones à explorer va donc <em>augmenter</em> à mesure qu’on avance.
          </p>
        )}

        <p>
          Impossible de dire combien d’établissements manquent exactement : une zone qui
          plafonne à 20 en cache un nombre qu’on ne connaît pas. Pour situer l’ordre de
          grandeur, le registre officiel des entreprises en recense{' '}
          <strong>{fr(sirene)}</strong> sur ce périmètre.
        </p>

        <p className="text-amber-700">
          Ce sont les rues les plus denses qui restent — Presqu’île, Cordeliers. Le compte
          augmentera donc plus vite que la progression ne le laisse penser.
        </p>
      </div>
    </details>
  )
}
