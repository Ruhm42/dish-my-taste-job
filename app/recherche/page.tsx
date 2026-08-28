import { asc, count } from 'drizzle-orm'
import { Suspense } from 'react'
import { db } from '@/lib/db/client'
import { restaurant } from '@/lib/db/schema'
import { compterActifs, construireConditions, lireFiltres } from '@/lib/filtres'
import type { Fenetre } from '@/lib/horaires'
import { CATEGORIE_LABEL, FIABILITE, RISQUE } from '@/components/badges'
import { PanneauFiltres } from '@/components/filtres'
import { Carte } from '@/components/carte'
import { GrilleHoraire } from '@/components/grille-horaire'

export const dynamic = 'force-dynamic'

type Params = Promise<Record<string, string | string[] | undefined>>

export default async function Recherche({ searchParams }: { searchParams: Params }) {
  const filtres = lireFiltres(await searchParams)
  const where = construireConditions(filtres)

  const [resultats, [{ total }]] = await Promise.all([
    db.select().from(restaurant).where(where).orderBy(asc(restaurant.name)).limit(200),
    db.select({ total: count() }).from(restaurant).where(where),
  ])

  const points = resultats.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, coupureRisk: r.coupureRisk,
  }))

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Dish My Taste Job</h1>
        <p className="text-sm text-stone-600">
          Les restaurants de la Métropole de Lyon, filtrés par rythme de travail.
        </p>
        <p className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Données de démonstration — établissements fictifs, en attendant le premier balayage.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Suspense fallback={<div className="text-sm text-stone-400">Chargement des filtres…</div>}>
          <PanneauFiltres nbActifs={compterActifs(filtres)} />
        </Suspense>

        <main className="space-y-4">
          <p className="text-sm font-medium text-stone-700">
            {total === 0 ? 'Aucun établissement ne correspond'
              : `${total} établissement${total > 1 ? 's' : ''}`}
          </p>

          <Carte points={points} />

          {total === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
              Essaie d’élargir un critère — le bouton « Tout effacer » remet la recherche à zéro.
            </p>
          ) : (
            <ul className="space-y-2">
              {resultats.map((r) => <Ligne key={r.id} r={r} />)}
            </ul>
          )}
        </main>
      </div>
    </div>
  )
}

function Ligne({ r }: { r: typeof restaurant.$inferSelect }) {
  const risque = RISQUE[r.coupureRisk]
  return (
    <li className="rounded-lg border border-stone-200 bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-stone-50">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: risque.couleur }}
            aria-hidden
          />
          <span className="font-medium">{r.name}</span>
          <span className="text-sm text-stone-500">{r.commune}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs ${risque.classe}`}>
            {risque.label}
          </span>
          {r.closedWeekend && (
            <span className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-900">
              Week-end libre
            </span>
          )}
          {r.maxConsecutiveDaysOff >= 2 && (
            <span className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
              2 jours d’affilée
            </span>
          )}
          <span className="ml-auto text-xs text-stone-400 group-open:hidden">Voir les horaires →</span>
        </summary>

        <div className="space-y-3 border-t border-stone-100 p-4">
          <p className="text-sm text-stone-800">{r.explication}</p>
          <p className="text-xs text-stone-500">
            Fiabilité : {FIABILITE[r.fiabilite]}
            {' · '}{CATEGORIE_LABEL[r.categorie] ?? r.categorie}
            {r.telephone && <> · <a className="underline" href={`tel:${r.telephone.replace(/\s/g, '')}`}>{r.telephone}</a></>}
          </p>
          <GrilleHoraire fenetres={(r.schedule ?? []) as Fenetre[]} />
          <p className="text-xs text-stone-400">{r.formattedAddress}</p>
        </div>
      </details>
    </li>
  )
}
