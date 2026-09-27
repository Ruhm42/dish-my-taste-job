import type { HoursFreshness } from '@/lib/results'

const fr = (n: number) => n.toLocaleString('fr-FR')

// Pinned to Paris because the server renders in UTC: an instant late in a Paris evening
// would otherwise print the previous day. `new Date()` because a raw `sql<Date>` column
// comes back from the driver as a string, whatever the type annotation says.
const date = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Paris',
      })
    : null

/**
 * Says how many records have stopped showing their hours, and since when.
 *
 * Not "hours to refresh on screen" any more: past 30 days they are not on screen at all.
 * The terms of service no longer let us keep them (D7), so the record stays without its
 * rhythm and is set aside by default like an establishment Google publishes no hours for
 * (D30 rule 6). What the banner exists for is that the drop be stated: a directory that
 * quietly holds fewer answers than last week is the failure mode this project names as its
 * worst.
 *
 * A sibling of SweepBanner rather than a section of it: the sweep can converge while the
 * hours rot, and the hours can be fresh while the sweep still owes cells. Merging them
 * would make one of the two conditions invisible.
 *
 * Same `<details>` as the other banner, for the same reason: a `title` tooltip never opens
 * on a touch screen, and the audience is on a phone.
 *
 * Mounted by the page only while something HAS expired: at zero there is nothing to state,
 * and a banner that says all is well is a banner readers learn to skip.
 */
export function HoursFreshnessBanner({ freshness }: { freshness: HoursFreshness }) {
  const { withHours, expired, oldestFetchedAt, nextExpiryAt } = freshness
  const since = date(oldestFetchedAt)
  const next = date(nextExpiryAt)

  return (
    <details className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <summary className="cursor-pointer list-none">
        <span className="underline decoration-dotted underline-offset-2">
          Horaires périmés
        </span>
        {' — '}
        <strong>{fr(expired)}</strong> fiches sur {fr(withHours)} n’affichent plus leurs
        horaires
      </summary>

      <div className="mt-2 max-w-prose space-y-1.5 border-t border-amber-200 pt-2 font-normal">
        <p>
          Les horaires sont relevés une fois par mois, et nous n’avons pas le droit de les
          conserver plus longtemps. <strong>{fr(expired)}</strong> fiches
          {since ? <> datent du <strong>{since}</strong> ou d’avant</> : <> ont dépassé ce délai</>}.
        </p>

        <p>
          Ces fiches ne sont pas supprimées : l’adresse et le téléphone restent, mais le
          rythme de travail repasse en <em>horaires inconnus</em> et elles sortent des
          résultats par défaut — comme un établissement dont Google ne publie pas les
          horaires. Un clic sur <em>les afficher</em> les ramène.
        </p>

        {next && (
          <p>
            D’autres fiches, aujourd’hui encore affichées, perdront leurs horaires à partir
            du <strong>{next}</strong> si elles n’ont pas été relevées d’ici là.
          </p>
        )}

        <p>
          Le relevé mensuel rachète d’abord les plus anciennes, avant d’aller en chercher de
          nouvelles.
        </p>
      </div>
    </details>
  )
}
