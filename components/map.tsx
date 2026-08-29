'use client'

import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_SHAPES, SHAPE_LEGEND, SPLIT_SHIFT_BADGES } from './badges'
import type { Category, SplitShiftRisk } from '@/lib/hours'

/**
 * What a marker needs — and nothing else.
 *
 * The map carries the whole result set, so this shape is paid thousands of times. The
 * establishment's own information lives in the detail panel, which fetches one row when a
 * point is clicked. See lib/results.ts and D27.
 */
export interface MapPoint {
  id: string
  name: string
  lat: number
  lng: number
  splitShiftRisk: SplitShiftRisk
  category: Category
}

interface Props {
  /** Every establishment that passes the filters. Never a page, never a sample. */
  points: MapPoint[]
  /** Reframe when the SEARCH changes, not when the list loads another page. */
  fitKey: string
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/** Sentinel reasons, distinguished from an Error message by the fallback view. */
const NO_API_KEY = 'no-api-key'
const KEY_REFUSED = 'key-refused'
const NEVER_PAINTED = 'never-painted'

/** How long we let the map prove it can draw itself before falling back. */
const FIRST_PAINT_TIMEOUT_MS = 8_000

/**
 * A rejected key does not reject the script.
 *
 * Google loads its bundle normally, then paints its own English panel over the map and
 * calls this global. Without hooking it, the page shows a foreign error box in the middle
 * of a French tool and our fallback — which still draws the real spread — never appears.
 *
 * The usual cause is the referrer allowlist on the browser key: it names the production
 * domain and `localhost`, and a dev server that landed on another port is not in it.
 */
const authListeners = new Set<() => void>()
let authFailed = false

function onKeyRefused(listener: () => void): () => void {
  if (authFailed) listener()
  authListeners.add(listener)
  return () => { authListeners.delete(listener) }
}

/**
 * The clusterer groups up to this zoom — a street is read point by point, not in bulk.
 *
 * The level just above is therefore the first one on which every point is drawn on its own,
 * which is where a point buried inside a group reappears.
 */
const CLUSTER_MAX_ZOOM = 17

const LEGEND_ORDER: SplitShiftRisk[] = ['none', 'low', 'medium', 'high', 'unknown']

export function RestaurantMap(props: Props) {
  if (!API_KEY) return <MapFallback points={props.points} reason={NO_API_KEY} />
  return <GoogleMap {...props} />
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
    const globals = window as unknown as Record<string, () => void>
    globals[CALLBACK_NAME] = () => resolve()

    // Installed before the script, since Google calls it as soon as it has judged the key.
    globals.gm_authFailure = () => {
      authFailed = true
      authListeners.forEach((listener) => listener())
    }

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

type Emphasis = 'none' | 'hover' | 'selected'

/** Colour is the split-shift risk, shape is the kind of place, size is the emphasis. */
function iconFor(p: MapPoint, emphasis: Emphasis): google.maps.Symbol {
  const selected = emphasis === 'selected'
  return {
    path: CATEGORY_SHAPES[p.category],
    scale: emphasis === 'none' ? 0.85 : selected ? 1.5 : 1.2,
    fillColor: SPLIT_SHIFT_BADGES[p.splitShiftRisk].color,
    fillOpacity: 1,
    strokeColor: selected ? '#1c1917' : '#fff',
    strokeWeight: selected ? 2.5 : 1.5,
  }
}

/**
 * A cluster carries a NUMBER, never a colour.
 *
 * Colour is the verdict on the split shift. Averaging thirty verdicts into one tint would
 * present a mean as a fact — which is exactly what the product refuses to do everywhere
 * else. To judge a neighbourhood, filter: the density of what remains is the answer (D27).
 */
const clusterRenderer = {
  render: ({ count, position }: { count: number; position: google.maps.LatLng }) =>
    new google.maps.Marker({
      position,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12 + Math.min(12, Math.log10(count) * 9),
        fillColor: '#57534e',
        fillOpacity: 0.92,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      label: { text: String(count), color: '#ffffff', fontSize: '12px', fontWeight: '600' },
      title: `${count} établissements`,
      // Above the individual markers, below an emphasised one.
      zIndex: 500,
    }),
}

function GoogleMap({ points, fitKey, selectedId, hoveredId, onSelect, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const markers = useRef<Map<string, google.maps.Marker>>(new Map())
  const clusterer = useRef<MarkerClusterer | null>(null)
  const emphasised = useRef<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Whether the map's own box is on screen. On a phone the map lives in a tab that starts
  // closed, and a `display:none` container has no tile to load, no size to fit to, and
  // nothing worth paying a map load for.
  const [visible, setVisible] = useState(false)

  // Through refs: a marker listener is registered once, but the parent hands down a new
  // function on every render. Without this, every render would rebuild every marker.
  const handlers = useRef({ onSelect, onHover })
  handlers.current = { onSelect, onHover }

  const pointById = useMemo(() => new Map(points.map((p) => [p.id, p])), [points])

  useEffect(() => {
    let mounted = true
    loadMapsScript(API_KEY!)
      .then(() => mounted && setReady(true))
      .catch((e: Error) => mounted && setError(e.message))
    return () => { mounted = false }
  }, [])

  // A refused key arrives after the script has loaded, so it cannot come through the
  // promise above: Google announces it by calling a global.
  useEffect(() => onKeyRefused(() => setError(KEY_REFUSED)), [])

  /**
   * Nothing happens until the map has a box on screen.
   *
   * Below `lg` the map sits in a tab that starts closed, so on first paint its container is
   * `display:none`. A Map created there never loads a tile, which made the watchdog below
   * fire against a map that was merely hidden and pin the "Google did not paint" preview on
   * for the rest of the visit — a false diagnosis sending the reader after the API key.
   *
   * Measuring the box rather than reading a `mobileView` prop keeps this true whatever the
   * reason the container is hidden, and keeps the map ignorant of the layout around it.
   *
   * `getClientRects()` is empty exactly when the element generates no box, which is what
   * `display:none` means. A size test looks equivalent and is not: measured in a browser,
   * a displayed container still reported `offsetWidth` 0 while its height was already 300,
   * so `offsetWidth > 0` would have held the map shut for good — a worse failure than the
   * one being fixed.
   */
  const measure = useCallback(() => {
    const el = container.current
    setVisible(!!el && el.getClientRects().length > 0)
  }, [])

  // After every render, because switching to the map tab re-renders this component and that
  // is the case the guard exists for. Not left to the observer alone: its callbacks are not
  // delivered while the page is not being rendered, which is measurable in a hidden tab.
  useEffect(measure)

  // And for the changes that re-render nothing: crossing the `lg` breakpoint reveals the map
  // through a media query, with React none the wiser.
  useEffect(() => {
    const el = container.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  /**
   * Single instantiation.
   *
   * A map load is billed per `new google.maps.Map()`, never per pan or zoom. The map is
   * created once and only its markers change; otherwise every filter change would spend a
   * billable load. See .specs/technique/02-budget-google-et-garde-fous.md
   */
  useEffect(() => {
    if (!ready || !visible || !container.current || map.current) return
    map.current = new google.maps.Map(container.current, {
      center: { lat: 45.757, lng: 4.832 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
    })
  }, [ready, visible])

  /**
   * The map has to prove it painted.
   *
   * `gm_authFailure` is the documented hook, and it is not reliable: Google refused this
   * key on one load, logged `RefererNotAllowedMapError` to the console, and never called
   * it. What was left on screen was a grey rectangle saying nothing — the silent failure
   * this whole project is built against.
   *
   * So we stop trusting the announcement and watch the result: no first tile inside the
   * timeout means the map did not draw, whatever the reason, and the preview takes over.
   */
  useEffect(() => {
    if (!ready || !visible || !map.current) return
    const timer = setTimeout(() => setError((current) => current ?? NEVER_PAINTED), FIRST_PAINT_TIMEOUT_MS)
    const listener = google.maps.event.addListenerOnce(map.current, 'tilesloaded', () => {
      clearTimeout(timer)
      // A tile arriving after the deadline must be able to undo the verdict. A refused key
      // must not: that one is a real failure and stays.
      setError((current) => (current === NEVER_PAINTED ? null : current))
    })
    return () => { clearTimeout(timer); listener.remove() }
  }, [ready, visible])

  // Markers are reconciled, not rebuilt: changing one filter usually keeps most of the
  // points, and rebuilding four thousand Google objects to add ten is what makes a map
  // stutter.
  //
  // `visible` is a dependency because the map is not created until it is true. The script is
  // ready long before a phone reader taps the map tab, so this used to run once against a map
  // that did not exist yet and never again: the map opened framed on Lyon and completely
  // empty, which is the silent subset this project refuses everywhere else.
  useEffect(() => {
    if (!ready || !map.current) return

    for (const [id, marker] of markers.current) {
      if (pointById.has(id)) continue
      marker.setMap(null)
      markers.current.delete(id)
    }

    for (const p of points) {
      if (markers.current.has(p.id)) continue
      // No `map` option: the clusterer owns what is actually drawn.
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        title: p.name,
        icon: iconFor(p, 'none'),
      })
      marker.addListener('click', () => handlers.current.onSelect(p.id))
      marker.addListener('mouseover', () => handlers.current.onHover(p.id))
      marker.addListener('mouseout', () => handlers.current.onHover(null))
      markers.current.set(p.id, marker)
    }

    clusterer.current ??= new MarkerClusterer({
      map: map.current,
      renderer: clusterRenderer,
      algorithm: new SuperClusterAlgorithm({
        radius: 70,
        maxZoom: CLUSTER_MAX_ZOOM,
        /**
         * Nothing groups below four.
         *
         * A cluster trades colour for a count, and colour is the split-shift verdict — the
         * one thing people came to the map for. Collapsing a pair therefore hides two
         * verdicts to save the width of one marker: the worst rate the map can offer, and
         * it forced a zoom to undo. Small groups stay as real, coloured points; only a
         * heap that would genuinely be unreadable becomes a number.
         */
        minPoints: 4,
      }),
    })
    clusterer.current.clearMarkers(true)
    clusterer.current.addMarkers([...markers.current.values()])
  }, [ready, visible, points, pointById])

  // Emphasis: only the markers entering or leaving it are restyled. Touching all of them
  // would cost four thousand redraws for a mouse moving down the list.
  useEffect(() => {
    if (!ready) return
    const next = new Set([selectedId, hoveredId].filter((id): id is string => !!id))

    for (const id of emphasised.current) {
      if (next.has(id)) continue
      const point = pointById.get(id)
      const marker = markers.current.get(id)
      if (point && marker) {
        marker.setIcon(iconFor(point, 'none'))
        marker.setZIndex(undefined)
      }
    }

    for (const id of next) {
      const point = pointById.get(id)
      const marker = markers.current.get(id)
      if (!point || !marker) continue
      marker.setIcon(iconFor(point, id === selectedId ? 'selected' : 'hover'))
      marker.setZIndex(id === selectedId ? 1000 : 900)
    }

    emphasised.current = next
  }, [ready, selectedId, hoveredId, pointById])

  /**
   * A row picked in the list must be findable on the map.
   *
   * Panning is not enough on its own. A point caught in a group is not merely small on
   * screen: the clusterer takes it off the map and draws a count in its place, so
   * emphasising it changed nothing and centring on it centred on a number. The zoom is what
   * gets it back — one level past where the clusterer stops grouping is the first frame that
   * draws it alone.
   *
   * When it IS drawn, the map moves as little as it can: a pan only if the point sits
   * off-screen, nothing at all otherwise. Recentring on every click would move the map under
   * a reader comparing two places side by side.
   */
  const reveal = useCallback(() => {
    const m = map.current
    if (!m || !selectedId) return
    const point = pointById.get(selectedId)
    const marker = markers.current.get(selectedId)
    if (!point || !marker) return

    const position = { lat: point.lat, lng: point.lng }
    if (!marker.getMap()) {
      m.setZoom(CLUSTER_MAX_ZOOM + 1)
      m.panTo(position)
      return
    }

    const bounds = m.getBounds()
    if (bounds && !bounds.contains(position)) m.panTo(position)
  }, [selectedId, pointById])

  // Through a ref, so the framing effect below can hand over to it without taking the
  // selection as a dependency and refitting on every click.
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  useEffect(() => { if (ready) reveal() }, [ready, reveal])

  // Framing follows the SEARCH, not the scroll.
  //
  // Refitting whenever the points change would yank the map back to a new frame while the
  // reader is browsing. It now has every result from the start, so the frame it computes is
  // the true extent of the search rather than that of the first fifty names.
  useEffect(() => {
    if (!ready || !visible || !map.current || points.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }))
    map.current.fitBounds(bounds, 48)

    // Whatever moved the map, the selected point ends up visible on it: a frame that hides
    // the establishment whose sheet is open answers a click with nothing. On a phone this is
    // the only path there — the row is picked in the list tab, and the map is framed the
    // moment the reader switches to it.
    const m = map.current
    google.maps.event.addListenerOnce(m, 'idle', () => {
      // On a single result, fitBounds zooms all the way in and every landmark is lost:
      // keep enough context to place the neighbourhood.
      if ((m.getZoom() ?? 0) > 15) {
        m.setZoom(15)
        // What the clusterer draws is recomputed at the new zoom, on the next idle. Reading
        // it now would judge the frame we just left.
        google.maps.event.addListenerOnce(m, 'idle', () => revealRef.current())
        return
      }
      revealRef.current()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not `points`
  }, [ready, visible, fitKey])

  // A map that fails to load must not leave an empty frame: fall back to the preview,
  // which stays usable.
  if (error) return <MapFallback points={points} reason={error} />

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-stone-200">
      <div ref={container} className="h-full w-full" />
      {!ready && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">
          Chargement de la carte…
        </p>
      )}
      <Legend className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-white/90 px-2 py-1 shadow" />
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
    <div className="flex h-full flex-col rounded-lg border border-dashed border-stone-300 bg-white p-3">
      <p className="mb-2 text-xs text-stone-500">
        {reason === NO_API_KEY
          ? 'Aperçu de la répartition — la carte Google s’activera dès que la clé sera configurée.'
          : reason === KEY_REFUSED
            ? 'Aperçu de la répartition — Google a refusé la clé pour cette adresse. '
              + 'La clé Maps est restreinte par référent : cette adresse (port compris) doit '
              + 'figurer dans la liste autorisée.'
            : reason === NEVER_PAINTED
              ? 'Aperçu de la répartition — la carte Google ne s’est pas affichée. La cause la '
                + 'plus fréquente est une clé refusée pour cette adresse ; la console du '
                + 'navigateur donne le motif exact.'
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
