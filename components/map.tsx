'use client'

import { useEffect, useRef, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_SHAPES, SHAPE_LEGEND, SPLIT_SHIFT_BADGES, googleMapsUrl } from './badges'
import { headcountLabel } from '@/lib/hours'
import type { Category, SplitShiftRisk } from '@/lib/hours'

export interface MapPoint {
  id: string
  name: string
  lat: number
  lng: number
  splitShiftRisk: SplitShiftRisk
  category: Category
  commune: string | null
  explanation: string
  headcountCode: string | null
  phone: string | null
  googlePlaceId: string
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
  const infoWindow = useRef<google.maps.InfoWindow | null>(null)
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
    infoWindow.current ??= new google.maps.InfoWindow()

    markers.current = points.map((p) => {
      const marker = new google.maps.Marker({
        map: map.current!,
        position: { lat: p.lat, lng: p.lng },
        title: p.name,
        icon: {
          // Two dimensions on one marker: colour is the split-shift risk, shape is the
          // kind of place.
          path: CATEGORY_SHAPES[p.category],
          scale: 0.85,
          fillColor: SPLIT_SHIFT_BADGES[p.splitShiftRisk].color,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 1.5,
        },
      })
      marker.addListener('click', () => {
        // A DOM node rather than an HTML string: establishment names come from Google and
        // are not ours to trust with innerHTML.
        infoWindow.current!.setContent(buildCard(p))
        infoWindow.current!.open({ map: map.current!, anchor: marker })
      })
      return marker
    })
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
 * The card shown when a marker is clicked: what you need to decide whether the place is
 * worth a walk, without leaving the map.
 *
 * Built with DOM nodes rather than an HTML string. Establishment names come from Google,
 * and a name containing markup would otherwise be injected straight into the page.
 */
function buildCard(p: MapPoint): HTMLElement {
  const root = document.createElement('div')
  root.style.cssText = 'font: 13px/1.45 system-ui, sans-serif; max-width: 15rem; color: #1c1917'

  const title = document.createElement('div')
  title.textContent = p.name
  title.style.cssText = 'font-weight: 600; margin-bottom: 2px'
  root.append(title)

  const context = [p.commune, CATEGORY_LABELS[p.category]].filter(Boolean).join(' · ')
  if (context) {
    const line = document.createElement('div')
    line.textContent = context
    line.style.cssText = 'color: #78716c; font-size: 12px'
    root.append(line)
  }

  const risk = SPLIT_SHIFT_BADGES[p.splitShiftRisk]
  const badge = document.createElement('div')
  badge.textContent = risk.label
  badge.style.cssText = 'margin: 6px 0 4px; display: inline-block; padding: 1px 6px; '
    + 'border-radius: 4px; font-size: 12px; color: #fff; background: ' + risk.color
  root.append(badge)

  const why = document.createElement('div')
  why.textContent = p.explanation
  why.style.cssText = 'font-size: 12px'
  root.append(why)

  // The headcount is what turns opening hours into a verdict about the staff: showing it
  // lets the reader judge the reasoning instead of taking the badge on faith.
  const staff = document.createElement('div')
  staff.textContent = 'Effectif : ' + (headcountLabel(p.headcountCode) ?? 'inconnu (estimé)')
  staff.style.cssText = 'margin-top: 4px; color: #78716c; font-size: 12px'
  root.append(staff)

  const actions = document.createElement('div')
  actions.style.cssText = 'margin-top: 8px; display: flex; gap: 10px; font-size: 12px'

  if (p.phone) {
    const tel = document.createElement('a')
    tel.href = 'tel:' + p.phone.replace(/\s/g, '')
    tel.textContent = p.phone
    actions.append(tel)
  }

  const maps = googleMapsUrl(p.googlePlaceId)
  if (maps) {
    const link = document.createElement('a')
    link.href = maps
    link.target = '_blank'
    // noopener: the page we open must not get a handle back on ours.
    link.rel = 'noopener noreferrer'
    link.textContent = 'Voir sur Google Maps ↗'
    actions.append(link)
  }

  if (actions.childElementCount > 0) root.append(actions)
  return root
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

/**
 * Two dimensions, so the legend has to explain both: colour carries the split-shift risk,
 * shape carries the kind of place. Colour comes first — it is the criterion people came
 * for; the shape is context.
 */
function Legend({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-1 text-[11px] text-stone-600 ${className}`}>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND_ORDER.map((risk) => (
          <span key={risk} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: SPLIT_SHIFT_BADGES[risk].color }}
            />
            {SPLIT_SHIFT_BADGES[risk].label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-stone-500">
        {SHAPE_LEGEND.map((category) => (
          <span key={category} className="flex items-center gap-1">
            <svg viewBox="-10 -10 20 20" className="h-2.5 w-2.5" aria-hidden>
              <path d={CATEGORY_SHAPES[category]} fill="currentColor" />
            </svg>
            {CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
    </div>
  )
}
