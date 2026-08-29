'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_SIZE } from '@/lib/config'
import type { Cursor, ResultRow as Row } from '@/lib/results'
import type { ServiceWindow } from '@/lib/hours'
import { headcountLabel } from '@/lib/hours'
import {
  CATEGORY_LABELS, CONFIDENCE_LABELS, SPLIT_SHIFT_BADGES, googleMapsUrl,
} from './badges'
import { RestaurantMap } from './map'
import { WeekGrid } from './week-grid'

interface Props {
  /** First page, rendered on the server so the list is there before any JavaScript runs. */
  initialRows: Row[]
  initialCursor: Cursor | null
  total: number
  /** The active filters, verbatim, so the API sees exactly the same search. */
  query: string
}

/**
 * The results area: count, map and list, all driven by one piece of state.
 *
 * They share state because the functional spec requires it — the map and the list must
 * always show the same establishments, never a subset of one another.
 *
 * Pages load as the reader reaches the bottom. The alternative it replaces was a silent
 * `LIMIT 200`: the counter said 4,465 and the list stopped at 200 without a word, which is
 * the same class of defect as a sweep that returns an incomplete database.
 */
export function Results({ initialRows, initialCursor, total, query }: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [cursor, setCursor] = useState<Cursor | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  // A new search replaces everything: without this, changing a filter would append the
  // new results underneath the old ones.
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

      const page = (await response.json()) as { rows: Row[]; nextCursor: Cursor | null }
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

  useEffect(() => {
    const node = sentinel.current
    if (!node || !cursor || error) return

    // rootMargin: start fetching before the sentinel is actually visible, so the next rows
    // are usually there by the time the reader gets to them.
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore() },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, error, loadMore])

  const points = rows.map((r) => ({
    id: r.id, name: r.name, lat: r.lat, lng: r.lng, splitShiftRisk: r.splitShiftRisk,
    category: r.category, cuisine: r.cuisine, commune: r.commune,
    explanation: r.explanation, headcountCode: r.headcountCode,
    phone: r.phone, googlePlaceId: r.googlePlaceId,
  }))

  return (
    <main className="space-y-4">
      <p className="text-sm font-medium text-stone-700">
        {total === 0
          ? 'Aucun établissement ne correspond'
          : `${total} établissement${total > 1 ? 's' : ''}`}
        {/* How far down the list you are. Without it, an infinite scroll gives no sense
            of scale — the reader cannot tell 50 of 4,465 from 50 of 50. */}
        {total > rows.length && (
          <span className="ml-2 font-normal text-stone-400">
            {rows.length} affichés
          </span>
        )}
      </p>

      {/* fitKey: reframe when the SEARCH changes, not when a page is appended. */}
      <RestaurantMap points={points} fitKey={query} />

      {total === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Essaie d’élargir un critère — le bouton « Tout effacer » remet la recherche à zéro.
          {/* An anchor rather than a second <JobBoards />: two copies of the block on
              screen at once would each ask to be read first. */}
          {' '}Ou regarde les offres publiées ailleurs :{' '}
          <a href="#offres" className="underline">Trouver des offres</a>, en bas des filtres.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => <ResultCard key={row.id} row={row} />)}
          </ul>

          {/*
            The sentinel loads the next page on its own, but the button is not a fallback
            for a broken browser — it is the keyboard path. Pure infinite scroll is
            unreachable without a pointer, and it also gives the reader no way to say
            "yes, more" deliberately.
          */}
          <div ref={sentinel} className="py-4 text-center text-sm text-stone-400">
            {error ? (
              <span className="text-red-700">
                {error}{' '}
                <button
                  type="button"
                  onClick={() => { setError(null); void loadMore() }}
                  className="underline"
                >
                  Réessayer
                </button>
              </span>
            ) : loading ? (
              'Chargement…'
            ) : cursor ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="rounded border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-100"
              >
                Voir les {Math.min(PAGE_SIZE, total - rows.length)} suivants
              </button>
            ) : (
              `Fin de la liste — ${rows.length} établissement${rows.length > 1 ? 's' : ''}`
            )}
          </div>
        </>
      )}
    </main>
  )
}

function ResultCard({ row }: { row: Row }) {
  const risk = SPLIT_SHIFT_BADGES[row.splitShiftRisk]
  const mapsUrl = googleMapsUrl(row.googlePlaceId)

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
          {mapsUrl && (
            <a
              href={mapsUrl}
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
