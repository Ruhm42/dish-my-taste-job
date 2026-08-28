'use client'

import { useEffect, useRef, useState } from 'react'
import { SPLIT_SHIFT_BADGES } from './badges'
import type { SplitShiftRisk } from '@/lib/hours'

export interface MapPoint {
  id: string
  name: string
  lat: number
  lng: number
  splitShiftRisk: SplitShiftRisk
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/** Sentinel reason, distinguished from an Error message by the fallback view. */
const NO_API_KEY = 'no-api-key'

const LEGEND_ORDER: SplitShiftRisk[] = ['none', 'low', 'medium', 'high', 'unknown']

/**
 * A "map load" is billed per map instantiation, not per pan or zoom. The map is
 * therefore created ONCE and only its markers are swapped: otherwise every filter
 * change would spend a billable load.
 * See .specs/technique/02-budget-google-et-garde-fous.md
 */
export function RestaurantMap({ points }: { points: MapPoint[] }) {
  if (!API_KEY) return <MapFallback points={points} reason={NO_API_KEY} />
  return <GoogleMap points={points} />
}

/**
 * Script load, once for the whole application.
 * Module-level promise: remounting must not fetch the script again.
 */
let scriptPromise: Promise<void> | null = null
const CALLBACK_NAME = '__dmtjMapsReady'

function loadMapsScript(apiKey: string): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    // Rejection messages surface in the fallback view, so they stay French.
    if (typeof window === 'undefined') return reject(new Error('côté serveur'))
    if (window.google?.maps?.Map) return resolve()

    // `loading=async` requires going through `callback`: the script's `load` event
    // fires BEFORE the constructors exist on `google.maps`.
    ;(window as unknown as Record<string, () => void>)[CALLBACK_NAME] = () => resolve()

    const timer = setTimeout(
      () => reject(new Error('délai dépassé au chargement')),
      10_000,
    )
    const stopTimer = () => clearTimeout(timer)

    const s = document.createElement('script')
    s.async = true
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
      + `&loading=async&libraries=maps,marker&callback=${CALLBACK_NAME}`
    s.onerror = () => { stopTimer(); reject(new Error('script Google Maps injoignable')) }
    document.head.appendChild(s)

    void Promise.resolve().then(() => scriptPromise?.then(stopTimer, stopTimer))
  })
  return scriptPromise
}

function GoogleMap({ points }: { points: MapPoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const markers = useRef<google.maps.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    loadMapsScript(API_KEY!)
      .then(() => mounted && setReady(true))
      .catch((e: Error) => mounted && setError(e.message))
    return () => { mounted = false }
  }, [])

  // Single instantiation — see the billing note above.
  useEffect(() => {
    if (!ready || !container.current || map.current) return
    map.current = new google.maps.Map(container.current, {
      center: { lat: 45.757, lng: 4.832 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
    })
  }, [ready])

  // Only the markers change when the filters move.
  useEffect(() => {
    if (!ready || !map.current) return
    markers.current.forEach((m) => m.setMap(null))
    markers.current = points.map((p) => new google.maps.Marker({
      map: map.current!,
      position: { lat: p.lat, lng: p.lng },
      title: p.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: SPLIT_SHIFT_BADGES[p.splitShiftRisk].color,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 1.5,
      },
    }))
    if (points.length) {
      const bounds = new google.maps.LatLngBounds()
      points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }))
      map.current.fitBounds(bounds, 48)

      // On a single result, fitBounds zooms all the way in and every landmark is lost:
      // keep enough context to place the neighbourhood.
      const m = map.current
      google.maps.event.addListenerOnce(m, 'idle', () => {
        if ((m.getZoom() ?? 0) > 15) m.setZoom(15)
      })
    }
  }, [ready, points])

  // A map that fails to load must not leave an empty frame: fall back to the preview,
  // which stays usable.
  if (error) return <MapFallback points={points} reason={error} />

  return (
    <div className="relative h-[28rem] w-full overflow-hidden rounded-lg bg-stone-200">
      <div ref={container} className="h-full w-full" />
      {!ready && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">
          Chargement de la carte…
        </p>
      )}
      <Legend className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 shadow" />
    </div>
  )
}

/**
 * Without a Google key — or when the map fails to load — we do not fake a map:
 * we show the real spread of the points, clearly labelled as such.
 */
function MapFallback({ points, reason }: { points: MapPoint[]; reason: string }) {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const bounds = points.length
    ? { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }
    : { north: 1, south: 0, east: 1, west: 0 }
  // Floor the extent: a single point would otherwise divide by zero.
  const height = Math.max(bounds.north - bounds.south, 1e-4)
  const width = Math.max(bounds.east - bounds.west, 1e-4)

  return (
    <div className="flex h-[28rem] flex-col rounded-lg border border-dashed border-stone-300 bg-white p-3">
      <p className="mb-2 text-xs text-stone-500">
        {reason === NO_API_KEY
          ? 'Aperçu de la répartition — la carte Google s’activera dès que la clé sera configurée.'
          : `Aperçu de la répartition — carte Google indisponible (${reason}).`}
      </p>
      <svg viewBox="0 0 100 100" className="min-h-0 flex-1 rounded bg-stone-100">
        {points.map((p) => (
          <circle
            key={p.id}
            cx={((p.lng - bounds.west) / width) * 96 + 2}
            cy={((bounds.north - p.lat) / height) * 96 + 2}
            r={1.6}
            fill={SPLIT_SHIFT_BADGES[p.splitShiftRisk].color}
            stroke="#fff"
            strokeWidth={0.4}
          >
            <title>{p.name}</title>
          </circle>
        ))}
      </svg>
      <Legend className="mt-2" />
    </div>
  )
}

function Legend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600 ${className}`}>
      {LEGEND_ORDER.map((risk) => (
        <span key={risk} className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: SPLIT_SHIFT_BADGES[risk].color }} />
          {SPLIT_SHIFT_BADGES[risk].label}
        </span>
      ))}
    </div>
  )
}
