import { formatHeure, type Fenetre } from '@/lib/horaires'

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const DEBUT = 6 * 60    // l'échelle démarre à 6h
const FIN = 26 * 60     // et va jusqu'à 2h du matin, pour montrer les fermetures tardives
const SPAN = FIN - DEBUT

/**
 * La semaine en barres. C'est la pièce maîtresse de la fiche : la coupure s'y voit
 * comme un TROU au milieu de la journée, sans avoir à lire un seul horaire.
 */
export function GrilleHoraire({ fenetres }: { fenetres: Fenetre[] }) {
  if (!fenetres.length) {
    return <p className="text-sm text-stone-500">Aucun horaire connu pour cet établissement.</p>
  }

  return (
    <div className="space-y-1">
      {JOURS.map((nom, i) => {
        const jour = i + 1
        const duJour = fenetres.filter((f) => f.jour === jour).sort((a, b) => a.ouvre - b.ouvre)
        return (
          <div key={nom} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-stone-500">{nom}</span>
            <div className="relative h-5 flex-1 rounded bg-stone-100">
              {duJour.map((f, k) => {
                const gauche = ((Math.max(f.ouvre, DEBUT) - DEBUT) / SPAN) * 100
                const largeur = ((Math.min(f.ferme, FIN) - Math.max(f.ouvre, DEBUT)) / SPAN) * 100
                return (
                  <div
                    key={k}
                    className="absolute top-0 h-5 rounded bg-stone-700"
                    style={{ left: `${gauche}%`, width: `${Math.max(largeur, 1)}%` }}
                    title={`${formatHeure(f.ouvre)} – ${formatHeure(f.ferme)}`}
                  />
                )
              })}
              {duJour.length === 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-stone-400">fermé</span>
              )}
            </div>
            <span className="w-32 shrink-0 text-right text-stone-600">
              {duJour.map((f) => `${formatHeure(f.ouvre)}-${formatHeure(f.ferme)}`).join(' · ') || '—'}
            </span>
          </div>
        )
      })}
      <div className="flex justify-between pl-22 pr-32 pt-1 text-[10px] text-stone-400">
        <span>6h</span><span>12h</span><span>18h</span><span>0h</span>
      </div>
    </div>
  )
}
