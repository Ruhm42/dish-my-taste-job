'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { Cursor, PointRow, ResultRow } from '@/lib/results'
import { DetailPanel } from './detail-panel'
import { FiltersPanel } from './filters'
import { RestaurantMap } from './map'
import { ResultList } from './result-list'

interface Props {
  /** First page, rendered on the server so the list is there before any JavaScript runs. */
  initialRows: ResultRow[]
  initialCursor: Cursor | null
  total: number
  /** EVERY establishment passing the filters. Not a page, not a sample. */
  points: PointRow[]
  /** The active filters, verbatim, so the API sees exactly the same search. */
  query: string
  activeFilterCount: number
}

type MobileView = 'liste' | 'carte'

/**
 * Bring an element into view, scrolling its container by hand.
 *
 * `scrollIntoView` looks like the obvious call and does nothing here: it walks up to the
 * document's scrolling element, which cannot move on a screen-height layout, and never
 * touches a `position: fixed` ancestor — which is exactly what the filter drawer is on a
 * phone. Measured: the drawer opened, the block stayed 794px down a 760px window, and its
 * scrollTop never left zero.
 */
function revealElement(id: string): void {
  const element = document.getElementById(id)
  if (!element) return

  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    const scrollable = (overflowY === 'auto' || overflowY === 'scroll')
      && node.scrollHeight > node.clientHeight
    if (!scrollable) continue
    const delta = element.getBoundingClientRect().top - node.getBoundingClientRect().top
    node.scrollTo({ top: node.scrollTop + delta, behavior: 'smooth' })
    return
  }

  // No scrollable ancestor: the page itself is what moves.
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * The search screen: filters, list and map, driven by one selection.
 *
 * The two surfaces render the same set — the one that passes the filters — but not at the
 * same rhythm. The list arrives in pages, because nobody reads four thousand rows; the map
 * arrives whole, because a spread cannot be judged from a sample. What is decoupled is the
 * loading, never the content (D27).
 *
 * On a large screen the list scrolls and the map stays put. On a small one they become two
 * alternative views: 375 pixels are not enough for both to be legible.
 */
export function SearchScreen({
  initialRows, initialCursor, total, points, query, activeFilterCount,
}: Props) {
  const [rows, setRows] = useState<ResultRow[]>(initialRows)
  const [cursor, setCursor] = useState<Cursor | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<MobileView>('liste')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [revealJobBoards, setRevealJobBoards] = useState(false)

  // A new search replaces the rows: without this, changing a filter would append the new
  // results underneath the old ones. The view and the selection survive on purpose — a
  // reader who is looking at the map should not be sent back to the list by a filter.
  useEffect(() => {
    setRows(initialRows)
    setCursor(initialCursor)
    setError(null)
  }, [initialRows, initialCursor])

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams(query)
      params.set('apres', cursor.name)
      params.set('apresId', cursor.id)

      const response = await fetch(`/api/etablissements?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const page = (await response.json()) as { rows: ResultRow[]; nextCursor: Cursor | null }
      // Guard against a double fire: the observer can trigger twice before state settles,
      // and appending the same page twice would duplicate keys.
      setRows((current) => {
        const known = new Set(current.map((r) => r.id))
        return [...current, ...page.rows.filter((r) => !known.has(r.id))]
      })
      setCursor(page.nextCursor)
    } catch {
      // Said out loud, with a way to retry. A scroll that quietly stops reads exactly like
      // "there is nothing more", which would be a lie.
      setError('Le chargement de la suite a échoué.')
    } finally {
      setLoading(false)
    }
  }, [cursor, loading, query])

  // Spares a round trip when the list already holds the row; the panel fetches on its own
  // for the thousands of markers the list has not loaded.
  const preloaded = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  )

  // Picking a marker on the small-screen map opens the panel over it; picking a row and
  // landing on the list is the same gesture. Nothing else changes view on its own.
  const select = useCallback((id: string) => setSelectedId(id), [])

  /**
   * Show the job boards, which live at the foot of the filter panel (D26).
   *
   * On a phone that panel is a closed drawer, so the block is not in the document at all:
   * opening it has to come first. Scrolling is deferred to an effect rather than done here
   * — at this point React has not committed the drawer, and the element would not exist yet.
   */
  const showJobBoards = useCallback(() => {
    setFiltersOpen(true)
    setRevealJobBoards(true)
  }, [])

  useEffect(() => {
    if (!revealJobBoards) return
    revealElement('offres')
    setRevealJobBoards(false)
  }, [revealJobBoards])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 lg:flex-row">
      {filtersOpen && (
        <div
          className="fixed inset-0 z-30 bg-stone-900/20 lg:hidden"
          onClick={() => setFiltersOpen(false)}
          aria-hidden
        />
      )}

      {/* One panel, two placements: a static column on a large screen, a drawer below it.
          Rendering it twice would duplicate the inputs the URL already drives. */}
      <aside
        className={`overflow-y-auto ${
          filtersOpen
            ? 'fixed inset-y-0 left-0 z-40 w-80 max-w-[85vw] bg-white p-4 shadow-xl'
            : 'hidden'
        } lg:static lg:z-auto lg:block lg:w-64 lg:max-w-none lg:shrink-0 lg:bg-transparent lg:p-0 lg:pt-1 lg:shadow-none`}
      >
        {filtersOpen && (
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="mb-3 w-full rounded border border-stone-300 px-3 py-1.5 text-sm lg:hidden"
          >
            Voir les {total} résultat{total > 1 ? 's' : ''}
          </button>
        )}
        {/*
          Rendered here, not handed down from the page as a prop.
          It used to cross the server/client boundary as an element, and an element that
          travels through the RSC payload loses the mark React uses to tell a hand-written
          child from one produced by a loop — so it landed in this children array and React
          asked it for a key it could never have. Both are client components; there was
          never a reason for the page to build this one.
        */}
        <Suspense fallback={<p className="text-sm text-stone-400">Chargement des filtres…</p>}>
          <FiltersPanel activeCount={activeFilterCount} />
        </Suspense>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/* The count is visible whichever surface is on screen — including on a phone,
            where only one of the two is. */}
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <p className="text-sm font-medium text-stone-700">
            {total === 0
              ? 'Aucun établissement'
              : `${total} établissement${total > 1 ? 's' : ''}`}
            {total > rows.length && (
              <span className="ml-2 font-normal text-stone-400">
                {rows.length} dans la liste
              </span>
            )}
          </p>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="ml-auto rounded border border-stone-300 px-2.5 py-1 text-xs text-stone-700 lg:hidden"
          >
            Filtres{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>

          <div className="flex rounded border border-stone-300 text-xs lg:hidden" role="tablist">
            {(['liste', 'carte'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={mobileView === view}
                onClick={() => setMobileView(view)}
                className={`px-3 py-1 capitalize first:rounded-l last:rounded-r ${
                  mobileView === view ? 'bg-stone-900 text-white' : 'text-stone-700'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        {/* `relative`: from `lg` the detail panel is positioned against this row, so it
            lands exactly on the list column and leaves the map alone. */}
        <div className="relative flex min-h-0 flex-1 gap-3">
          {/*
            A fixed width, not a share of the space. The list is read line by line: past
            roughly twenty-five characters the eye stops tracking rows and the column just
            wastes what the map could use. `min-w-0` is what lets the names actually
            truncate — a flex child defaults to min-width:auto, and without it the longest
            establishment name sets the width of the whole column and squeezes the map to a
            sliver.
          */}
          {/* `lg:w-80` is not a free choice: below 2xl the detail panel overlays this exact
              column, and the two widths have to match or the overlay leaves a sliver. */}
          <div
            className={`min-h-0 min-w-0 flex-col ${mobileView === 'liste' ? 'flex' : 'hidden'} lg:flex lg:w-80 lg:flex-none`}
          >
            <ResultList
              rows={rows}
              cursor={cursor}
              loading={loading}
              error={error}
              total={total}
              onLoadMore={() => void loadMore()}
              onShowJobBoards={showJobBoards}
              selectedId={selectedId}
              onSelect={select}
              onHover={setHoveredId}
            />
          </div>

          {/* The map takes everything the other two leave: it is the widest surface, and it
              is the one that needs the room. */}
          <div
            className={`min-h-0 min-w-0 flex-1 ${mobileView === 'carte' ? 'block' : 'hidden'} lg:block`}
          >
            <RestaurantMap
              points={points}
              fitKey={query}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={select}
              onHover={setHoveredId}
            />
          </div>

          {/* In the flow on a large screen, so opening a sheet never covers the map: the
              two are read together — the verdict on one side, where it is on the other. */}
          <DetailPanel
            id={selectedId}
            initial={preloaded}
            onClose={() => setSelectedId(null)}
          />
        </div>
      </main>
    </div>
  )
}
