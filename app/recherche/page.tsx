import { asc, count } from 'drizzle-orm'
import { Suspense } from 'react'
import { db } from '@/lib/db/client'
import { restaurant } from '@/lib/db/schema'
import { buildConditions, countActive, parseFilters } from '@/lib/filters'
import type { ServiceWindow } from '@/lib/hours'
import { CATEGORY_LABELS, CONFIDENCE_LABELS, SPLIT_SHIFT_BADGES } from '@/components/badges'
import { FiltersPanel } from '@/components/filters'
import { RestaurantMap } from '@/components/map'
import { WeekGrid } from '@/components/week-grid'

export const dynamic = 'force-dynamic'

type Params = Promise<Record<string, string | string[] | undefined>>
type RestaurantRow = typeof restaurant.$inferSelect

export default async function SearchPage({ searchParams }: { searchParams: Params }) {
  const filters = parseFilters(await searchParams)
  const where = buildConditions(filters)

  const [results, [{ total }]] = await Promise.all([
    db.select().from(restaurant).where(where).orderBy(asc(restaurant.name)).limit(200),
    db.select({ total: count() }).from(restaurant).where(where),
  ])

  const points = results.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, splitShiftRisk: r.splitShiftRisk,
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
          <FiltersPanel activeCount={countActive(filters)} />
        </Suspense>

        <main className="space-y-4">
          <p className="text-sm font-medium text-stone-700">
            {total === 0 ? 'Aucun établissement ne correspond'
              : `${total} établissement${total > 1 ? 's' : ''}`}
          </p>

          <RestaurantMap points={points} />

          {total === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
              Essaie d’élargir un critère — le bouton « Tout effacer » remet la recherche à zéro.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((r) => <ResultRow key={r.id} row={r} />)}
            </ul>
          )}
        </main>
      </div>
    </div>
  )
}

function ResultRow({ row }: { row: RestaurantRow }) {
  const risk = SPLIT_SHIFT_BADGES[row.splitShiftRisk]
  return (
    <li className="rounded-lg border border-stone-200 bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-stone-50">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: risk.color }}
            aria-hidden
          />
          <span className="font-medium">{row.name}</span>
          <span className="text-sm text-stone-500">{row.commune}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs ${risk.className}`}>
            {risk.label}
          </span>
          {row.closedWeekend && (
            <span className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-900">
              Week-end libre
            </span>
          )}
          {row.maxConsecutiveDaysOff >= 2 && (
            <span className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
              2 jours d’affilée
            </span>
          )}
          <span className="ml-auto text-xs text-stone-400 group-open:hidden">Voir les horaires →</span>
        </summary>

        <div className="space-y-3 border-t border-stone-100 p-4">
          <p className="text-sm text-stone-800">{row.explanation}</p>
          <p className="text-xs text-stone-500">
            Fiabilité : {CONFIDENCE_LABELS[row.confidence]}
            {' · '}{CATEGORY_LABELS[row.category]}
            {row.phone && <> · <a className="underline" href={`tel:${row.phone.replace(/\s/g, '')}`}>{row.phone}</a></>}
          </p>
          <WeekGrid windows={(row.schedule ?? []) as ServiceWindow[]} />
          <p className="text-xs text-stone-400">{row.formattedAddress}</p>
        </div>
      </details>
    </li>
  )
}
