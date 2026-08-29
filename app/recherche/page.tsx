import { asc, count, inArray, like } from 'drizzle-orm'
import { Suspense } from 'react'
import { db } from '@/lib/db/client'
import { getUser } from '@/lib/supabase/server'
import { cell, restaurant } from '@/lib/db/schema'
import { buildConditions, countActive, parseFilters } from '@/lib/filters'
import { headcountLabel } from '@/lib/hours'
import type { ServiceWindow } from '@/lib/hours'
import { CATEGORY_LABELS, CONFIDENCE_LABELS, SPLIT_SHIFT_BADGES, googleMapsUrl } from '@/components/badges'
import { Account } from '@/components/account'
import { FiltersPanel } from '@/components/filters'
import { RestaurantMap } from '@/components/map'
import { WeekGrid } from '@/components/week-grid'

export const dynamic = 'force-dynamic'

type Params = Promise<Record<string, string | string[] | undefined>>
/**
 * Exactly the columns the list renders — `raw_opening_hours` is the largest column in the
 * table and nothing here reads it. Narrowing the type rather than using $inferSelect means
 * adding a field to the JSX without adding it to the query fails to compile, instead of
 * silently reading undefined.
 */
type RestaurantRow = Pick<typeof restaurant.$inferSelect,
  | 'id' | 'name' | 'commune' | 'lat' | 'lng' | 'phone' | 'formattedAddress'
  | 'googlePlaceId' | 'category' | 'cuisine' | 'headcountCode' | 'splitShiftRisk' | 'confidence'
  | 'closedWeekend' | 'maxConsecutiveDaysOff' | 'explanation' | 'schedule'>

export default async function SearchPage({ searchParams }: { searchParams: Params }) {
  const user = await getUser()
  const filters = parseFilters(await searchParams)
  const where = buildConditions(filters)

  // Sequential, never Promise.all.
  //
  // Supabase's transaction pooler hands out a backend PER TRANSACTION, and the serverless
  // client holds a single connection. Queries pipelined on that one connection can sit
  // waiting for a backend that never arrives, until Postgres kills them with
  // `57014 canceling statement due to statement timeout` — a five-millisecond query
  // failing after two minutes of waiting. That is what took production down; the queries
  // were never slow, they were concurrent.
  //
  // Only the columns the page actually renders: `raw_opening_hours` is the largest column
  // in the table and nothing here reads it.
  const results = await db
    .select({
      id: restaurant.id, name: restaurant.name, commune: restaurant.commune,
      lat: restaurant.lat, lng: restaurant.lng, phone: restaurant.phone,
      formattedAddress: restaurant.formattedAddress, googlePlaceId: restaurant.googlePlaceId,
      category: restaurant.category, cuisine: restaurant.cuisine,
      headcountCode: restaurant.headcountCode,
      splitShiftRisk: restaurant.splitShiftRisk, confidence: restaurant.confidence,
      closedWeekend: restaurant.closedWeekend,
      maxConsecutiveDaysOff: restaurant.maxConsecutiveDaysOff,
      explanation: restaurant.explanation, schedule: restaurant.schedule,
    })
    .from(restaurant).where(where).orderBy(asc(restaurant.name)).limit(200)

  const [{ total }] = await db.select({ total: count() }).from(restaurant).where(where)

  // Both banners are derived rather than hard-coded: a banner someone has to remember to
  // remove is a banner that eventually lies about what is on screen. Neither is filtered —
  // they describe the database, not the current search.
  const [{ demo }] = await db
    .select({ demo: count() })
    .from(restaurant).where(like(restaurant.googlePlaceId, 'demo-%'))

  // Cells still owed a query: while this is above zero, the densest streets are
  // under-counted, and saying so is what separates an incomplete list from a misleading one.
  const [{ owed }] = await db
    .select({ owed: count() })
    .from(cell).where(inArray(cell.status, ['pending', 'truncated']))

  const points = results.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, splitShiftRisk: r.splitShiftRisk,
    category: r.category, cuisine: r.cuisine, commune: r.commune, explanation: r.explanation,
    headcountCode: r.headcountCode, phone: r.phone, googlePlaceId: r.googlePlaceId,
  }))

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dish My Taste Job</h1>
            <p className="text-sm text-stone-600">
              Les restaurants de la Métropole de Lyon, filtrés par rythme de travail.
            </p>
          </div>
          {user?.email && <Account email={user.email} />}
        </div>
        {demo > 0 ? (
          <p className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Données de démonstration — établissements fictifs, en attendant le premier balayage.
          </p>
        ) : owed > 0 ? (
          <p className="mt-2 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Balayage en cours — les rues les plus denses sont encore sous-représentées.
            Certains établissements manquent à l’appel.
          </p>
        ) : null}
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
            {row.cuisine && <> · {row.cuisine}</>}
            {/* The headcount is the hinge of the whole verdict: opening hours alone never
                say whether a split shift lands on the staff. Showing it lets the reader
                judge the reasoning rather than trust the badge. */}
            {' · Effectif : '}
            {headcountLabel(row.headcountCode) ?? 'inconnu (estimé)'}
            {row.phone && <> · <a className="underline" href={`tel:${row.phone.replace(/\s/g, '')}`}>{row.phone}</a></>}
          </p>
          <WeekGrid windows={(row.schedule ?? []) as ServiceWindow[]} />
          <p className="text-xs text-stone-400">{row.formattedAddress}</p>
          {googleMapsUrl(row.googlePlaceId) && (
            <a
              href={googleMapsUrl(row.googlePlaceId)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-stone-600 underline"
            >
              Vérifier sur Google Maps — horaires, avis, photos ↗
            </a>
          )}
        </div>
      </details>
    </li>
  )
}
