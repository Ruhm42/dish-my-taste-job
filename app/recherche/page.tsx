import { count, like } from 'drizzle-orm'
import { Suspense } from 'react'
import { db } from '@/lib/db/client'
import { getUser } from '@/lib/supabase/server'
import { restaurant } from '@/lib/db/schema'
import { countActive, parseFilters } from '@/lib/filters'
import { countResults, fetchPage, fetchSweepProgress } from '@/lib/results'
import { Account } from '@/components/account'
import { FiltersPanel } from '@/components/filters'
import { Results } from '@/components/results'
import { SweepBanner } from '@/components/sweep-banner'

export const dynamic = 'force-dynamic'

type Params = Promise<Record<string, string | string[] | undefined>>

export default async function SearchPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams
  const user = await getUser()
  const filters = parseFilters(params)

  // Sequential, never Promise.all.
  //
  // Supabase's transaction pooler hands out a backend PER TRANSACTION, and the serverless
  // client holds a single connection. Queries pipelined onto that one connection can sit
  // waiting for a backend that never arrives, until Postgres kills them with
  // `57014 canceling statement due to statement timeout` — a five-millisecond query
  // failing after two minutes. That took production down once; see D23.
  const page = await fetchPage(filters, null)
  const total = await countResults(filters)

  // Both banners are derived rather than hard-coded: a banner someone has to remember to
  // remove is a banner that eventually lies about what is on screen. Neither is filtered —
  // they describe the database, not the current search.
  const [{ demo }] = await db
    .select({ demo: count() })
    .from(restaurant).where(like(restaurant.googlePlaceId, 'demo-%'))

  // How far the sweep has got. While anything is still owed, the densest streets are
  // under-counted, and saying so is what separates an incomplete list from a misleading one.
  const progress = await fetchSweepProgress()
  const sweepUnfinished = progress.pending + progress.truncated > 0

  // The search as the user expressed it, handed to the API verbatim so the next pages come
  // from exactly the same query. Rebuilding it from the parsed filters would risk drifting.
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x] as [string, string])
      : v === undefined ? []
      : [[k, v] as [string, string]]),
  ).toString()

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
        ) : sweepUnfinished ? (
          <SweepBanner progress={progress} />
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Suspense fallback={<div className="text-sm text-stone-400">Chargement des filtres…</div>}>
          <FiltersPanel activeCount={countActive(filters)} />
        </Suspense>

        <Results
          // Keyed on the search: a new query must reset the list rather than append to it.
          key={query}
          initialRows={page.rows}
          initialCursor={page.nextCursor}
          total={total}
          query={query}
        />
      </div>
    </div>
  )
}
