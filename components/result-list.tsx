'use client'

import { useEffect, useRef, useState } from 'react'
import { PAGE_SIZE } from '@/lib/config'
import type { Cursor, ResultRow as Row } from '@/lib/results'
import { SPLIT_SHIFT_BADGES } from './badges'

interface Props {
  rows: Row[]
  /** Null when the list is exhausted — that is what stops the infinite scroll. */
  cursor: Cursor | null
  loading: boolean
  error: string | null
  total: number
  onLoadMore: () => void
  /** Reveals the job-board block, wherever the filter panel happens to be. */
  onShowJobBoards: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

/**
 * The results, line by line, in a column that scrolls on its own.
 *
 * Three rules make it readable at speed, and they are the point of the whole component:
 *
 *  - **Rows keep a constant height.** The detail used to unfold inside the list, so opening
 *    one sheet pushed everything below it and the reader lost their place. It now opens in
 *    the side panel.
 *  - **The scroll belongs to the list, not the page.** Going down the results does not drag
 *    the header, the filters and the map along with it.
 *  - **There is a way back to the top**, because a broad search is browsed, left, and
 *    resumed. See .specs/fonctionnel/04-carte.md
 */
export function ResultList({
  rows, cursor, loading, error, total, onLoadMore, onShowJobBoards, selectedId, onSelect, onHover,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  // The observer watches inside the list, not inside the window: with its own scroll
  // container, a viewport-rooted observer would consider the sentinel permanently visible
  // and load every page at once.
  useEffect(() => {
    const node = sentinel.current
    const root = container.current
    if (!node || !root || !cursor || error) return

    // rootMargin: start fetching before the sentinel is actually visible, so the next rows
    // are usually there by the time the reader gets to them.
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onLoadMore() },
      { root, rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, error, onLoadMore])

  useEffect(() => {
    const root = container.current
    if (!root) return
    const onScroll = () => setScrolled(root.scrollTop > 800)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [])

  if (total === 0) {
    return (
      <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
        Aucun établissement ne correspond. Essaie d’élargir un critère — le bouton
        « Tout effacer » remet la recherche à zéro.
        {/*
          A pointer to the one block, never a second copy of it: two on screen at once would
          each ask to be read first.

          A button and not an anchor, though. On a phone the filter panel is a closed drawer,
          so `#offres` names an element that is not rendered — the link would do nothing
          precisely where the reader has the least patience. This opens the panel first, then
          scrolls to the block, which is the same gesture at every width.
        */}
        {' '}Ou regarde les offres publiées ailleurs :{' '}
        <button type="button" onClick={onShowJobBoards} className="underline">
          Trouver des offres
        </button>, en bas des filtres.
      </p>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={container} className="h-full overflow-y-auto pr-1">
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <ResultRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
              onHover={onHover}
            />
          ))}
        </ul>

        {/*
          The sentinel loads the next page on its own, but the button is not a fallback for
          a broken browser — it is the keyboard path. Pure infinite scroll is unreachable
          without a pointer, and it gives the reader no way to say "yes, more" deliberately.
        */}
        <div ref={sentinel} className="py-4 text-center text-sm text-stone-400">
          {error ? (
            <span className="text-red-700">
              {error}{' '}
              <button type="button" onClick={onLoadMore} className="underline">
                Réessayer
              </button>
            </span>
          ) : loading ? (
            'Chargement…'
          ) : cursor ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="rounded border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-100"
            >
              Voir les {Math.min(PAGE_SIZE, total - rows.length)} suivants
            </button>
          ) : (
            `Fin de la liste — ${rows.length} établissement${rows.length > 1 ? 's' : ''}`
          )}
        </div>
      </div>

      {scrolled && (
        <button
          type="button"
          onClick={() => container.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-stone-300 bg-white/95 px-3 py-1.5 text-xs text-stone-700 shadow hover:bg-stone-100"
        >
          ↑ Retour en haut
        </button>
      )}
    </div>
  )
}

/**
 * One row, one height.
 *
 * A button rather than a clickable div: this is the keyboard path into the detail panel,
 * and it is the same target the map's markers open.
 */
function ResultRow({ row, selected, onSelect, onHover }: {
  row: Row
  selected: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}) {
  const risk = SPLIT_SHIFT_BADGES[row.splitShiftRisk]

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        onMouseEnter={() => onHover(row.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(row.id)}
        onBlur={() => onHover(null)}
        aria-current={selected}
        className={`w-full rounded-lg border p-2.5 text-left transition ${
          selected
            ? 'border-stone-900 bg-stone-50'
            : 'border-stone-200 bg-white hover:border-stone-400'
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: risk.color }}
            aria-hidden
          />
          {/* truncate, never wrap: a long name must not make this row taller than the next
              one, or scrolling stops being predictable. */}
          <span className="truncate font-medium">{row.name}</span>
          <span className="ml-auto shrink-0 text-xs text-stone-400">{row.commune}</span>
        </span>
        <span className="mt-1 flex flex-nowrap items-center gap-1.5 overflow-hidden">
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${risk.className}`}>
            {risk.label}
          </span>
          {row.closedWeekend && (
            <span className="shrink-0 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-900">
              Week-end libre
            </span>
          )}
          {row.maxConsecutiveDaysOff >= 2 && (
            <span className="shrink-0 rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
              2 jours d’affilée
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
