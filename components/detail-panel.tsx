'use client'

import { useEffect, useRef, useState } from 'react'
import { headcountLabel, type ServiceWindow } from '@/lib/hours'
import type { ResultRow } from '@/lib/results'
import { CATEGORY_LABELS, CONFIDENCE_LABELS, SPLIT_SHIFT_BADGES, googleMapsUrl } from './badges'
import { WeekGrid } from './week-grid'

interface Props {
  /** Null when nothing is selected: the panel is then absent, not hidden. */
  id: string | null
  /** The row when the list already holds it — spares a round trip, never required. */
  initial: ResultRow | null
  onClose: () => void
}

/**
 * The detail of one establishment, in a panel on the side.
 *
 * It opens indifferently from a list row or from a map marker, and never *inside* the list:
 * a sheet unfolding between two rows pushes everything below it and makes the reader lose
 * their place. That is what made the list hard to scroll (D27).
 *
 * The map holds every establishment that passes the filters while the list has loaded only
 * its first pages, so the panel cannot count on the row being here: it fetches the one it
 * needs when the list does not have it.
 */
export function DetailPanel({ id, initial, onClose }: Props) {
  const [row, setRow] = useState<ResultRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!id) return

    if (initial && initial.id === id) {
      setRow(initial)
      setError(null)
      setLoading(false)
      return
    }

    // `cancelled` rather than an AbortController: clicking three markers in a row must show
    // the third, and a late answer to the first would otherwise overwrite it.
    let cancelled = false
    setLoading(true)
    setError(null)
    setRow(null)

    fetch(`/api/etablissements/${id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((fetched: ResultRow) => { if (!cancelled) setRow(fetched) })
      .catch(() => { if (!cancelled) setError('La fiche n’a pas pu être chargée.') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [id, initial])

  // Escape closes: the panel covers the map on a small screen, and a reader who opened it
  // by mistake must not have to hunt for the cross.
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    closeButton.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [id, onClose])

  if (!id) return null

  const risk = row && SPLIT_SHIFT_BADGES[row.splitShiftRisk]
  const mapsUrl = row && googleMapsUrl(row.googlePlaceId)

  return (
    <>
      {/* Small screens only: the panel covers the screen there, and the backdrop is what
          says the rest is on hold. On a large screen it takes its own column, so there is
          nothing to put on hold. */}
      <div
        className="fixed inset-0 z-30 bg-stone-900/20 lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      {/*
        Three placements, one rule: NEVER over the map.
        The sheet says what the rhythm is, the map says where the place is, and the two are
        read together — covering one to show the other is exactly what moving the detail out
        of the list was meant to stop.

         - phone: a drawer over everything, since nothing else is legible at that width
         - from `lg`: it sits over the LIST column, whose width it matches. Four columns do
           not fit under 1536px, and squeezing the map to three hundred pixels would give
           back the defect we just fixed. The list is what gets covered — you have just
           picked from it, and closing brings it straight back.
         - from `2xl`: its own column, everything visible at once
      */}
      <aside
        role="dialog"
        aria-label={row ? `Fiche de ${row.name}` : 'Fiche établissement'}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-stone-200 bg-white shadow-xl
          lg:absolute lg:inset-y-0 lg:left-0 lg:right-auto lg:z-20 lg:w-80 lg:max-w-none lg:rounded-lg lg:border lg:shadow-lg
          2xl:static 2xl:z-auto 2xl:min-h-0 2xl:w-96 2xl:shrink-0 2xl:shadow-sm"
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{row?.name ?? 'Chargement…'}</h2>
            {row && (
              <p className="truncate text-sm text-stone-500">
                {[row.commune, CATEGORY_LABELS[row.category], row.cuisine]
                  .filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Fermer la fiche"
            className="shrink-0 rounded px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading && <p className="text-sm text-stone-500">Chargement de la fiche…</p>}

          {error && (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          {row && risk && (
            <>
              <div className="space-y-2">
                <span className={`inline-block rounded border px-2 py-0.5 text-sm ${risk.className}`}>
                  {risk.label}
                </span>
                {/* The reasoning, not just the verdict: the reader knows the trade better
                    than the tool and must be able to judge it. */}
                <p className="text-sm text-stone-800">{row.explanation}</p>
                <p className="text-xs text-stone-500">
                  Fiabilité : {CONFIDENCE_LABELS[row.confidence]}
                  {' · Effectif : '}{headcountLabel(row.headcountCode) ?? 'inconnu (estimé)'}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
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
              </div>

              {/* The centrepiece: a split shift reads as a hole in the middle of the day,
                  without parsing a single time. */}
              <WeekGrid windows={(row.schedule ?? []) as ServiceWindow[]} />

              <div className="space-y-1 border-t border-stone-100 pt-3 text-sm">
                {row.formattedAddress && <p className="text-stone-600">{row.formattedAddress}</p>}
                {row.phone && (
                  <p>
                    <a className="underline" href={`tel:${row.phone.replace(/\s/g, '')}`}>
                      {row.phone}
                    </a>
                  </p>
                )}
                {mapsUrl && (
                  <p>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-stone-600 underline"
                    >
                      Vérifier sur Google Maps — horaires, avis, photos ↗
                    </a>
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
