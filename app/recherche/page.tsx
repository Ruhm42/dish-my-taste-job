import { count, like } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getUser } from '@/lib/supabase/server'
import { restaurant } from '@/lib/db/schema'
import { countActive, parseFilters } from '@/lib/filters'
import {
  countExcluded, countResults, fetchHoursFreshness, fetchPage, fetchPoints, fetchSweepProgress,
} from '@/lib/results'
import { Account } from '@/components/account'
import { SearchScreen } from '@/components/search-screen'
import { SweepBanner } from '@/components/sweep-banner'
import { HoursFreshnessBanner } from '@/components/hours-freshness-banner'

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

  // The map gets the whole search, the list gets it in slices (D27). This is the one query
  // on the page that is not paginated, deliberately: a spread cannot be read from a sample.
  const points = await fetchPoints(filters)

  // What this search left out. Counted against the reader's own criteria so the line under
  // the total means something (D29).
  const excluded = await countExcluded(filters)

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

  // And how old what it brought back is. The two are independent: a converged sweep can
  // still be serving hours past the 30 days the terms of service allow, and that window is
  // exactly the one where nothing else on this page would say so.
  const freshness = await fetchHoursFreshness()

  // The search as the user expressed it, handed to the API verbatim so the next pages come
  // from exactly the same query. Rebuilding it from the parsed filters would risk drifting.
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x] as [string, string])
      : v === undefined ? []
      : [[k, v] as [string, string]]),
  ).toString()

  return (
    // The screen is the viewport: the list scrolls inside its own column rather than
    // dragging the header, the filters and the map away with it.
    <div className="flex h-[100dvh] flex-col bg-stone-50">
      <header className="shrink-0 border-b border-stone-200 bg-white px-3 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight">Dish My Taste Job</h1>
            <p className="hidden text-xs text-stone-600 sm:block">
              Les restaurants de la Métropole de Lyon, filtrés par rythme de travail.
            </p>
          </div>
          {user?.email && <Account email={user.email} />}
        </div>
        {demo > 0 ? (
          <p className="mt-1.5 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Données de démonstration — établissements fictifs, en attendant le premier balayage.
          </p>
        ) : sweepUnfinished || freshness.expired > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {sweepUnfinished && <SweepBanner progress={progress} />}
            {freshness.expired > 0 && <HoursFreshnessBanner freshness={freshness} />}
          </div>
        ) : null}
      </header>

      <SearchScreen
        initialRows={page.rows}
        initialCursor={page.nextCursor}
        total={total}
        points={points}
        query={query}
        activeFilterCount={countActive(filters)}
        excluded={excluded}
        unknownHoursIncluded={filters.includeUnknownHours}
      />
    </div>
  )
}
