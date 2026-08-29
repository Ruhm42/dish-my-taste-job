import type { HoursFreshness } from '@/lib/results'

const fr = (n: number) => n.toLocaleString('fr-FR')

const date = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null

/**
 * Says that part of the opening hours on screen are older than the 30 days the Google
 * terms of service allow us to keep them (D7).
 *
 * A sibling of SweepBanner rather than a section of it: the sweep can converge while the
 * hours rot, and the hours can be fresh while the sweep still owes cells. Merging them
 * would make one of the two conditions invisible.
 *
 * Same `<details>` as the other banner, for the same reason: a `title` tooltip never opens
 * on a touch screen, and the audience is on a phone.
 */
export function HoursFreshnessBanner({ freshness }: { freshness: HoursFreshness }) {
  const { withHours, expired, oldestFetchedAt } = freshness
  const since = date(oldestFetchedAt)

  return (
    <details className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <summary className="cursor-pointer list-none">
        <span className="underline decoration-dotted underline-offset-2">
          Horaires à rafraîchir
        </span>
        {' — '}
        <strong>{fr(expired)}</strong> fiches sur {fr(withHours)} n’ont pas été revues
        depuis plus de 30 jours
      </summary>

      <div className="mt-2 max-w-prose space-y-1.5 border-t border-amber-200 pt-2 font-normal">
        <p>
          Les horaires sont relevés une fois par mois, et nous n’avons pas le droit de les
          conserver plus longtemps. <strong>{fr(expired)}</strong> fiches
          {since ? <> datent du <strong>{since}</strong> ou d’avant</> : <> ont dépassé ce délai</>}.
        </p>

        <p>
          Elles restent affichées, parce qu’une fiche sans horaires ne se filtre plus du
          tout. Mais un établissement a pu changer de rythme depuis : sur celles-là,
          <em> vérifiez avant de vous déplacer</em>.
        </p>
      </div>
    </details>
  )
}
