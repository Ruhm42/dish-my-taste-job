'use client'

import { useEffect, useRef, useState } from 'react'
import { RISQUE } from './badges'
import type { RisqueCoupure } from '@/lib/horaires'

export interface Point {
  id: string
  name: string
  lat: number
  lng: number
  coupureRisk: RisqueCoupure
}

const CLE = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Un « map load » se compte à chaque instanciation de carte, pas au pan/zoom.
 * La carte est donc créée UNE SEULE FOIS et on ne remplace que les marqueurs :
 * sinon chaque changement de filtre consommerait un chargement facturable.
 * Voir .specs/technique/02-budget-google-et-garde-fous.md
 */
export function Carte({ points }: { points: Point[] }) {
  if (!CLE) return <ApercuSansCle points={points} raison="cle-absente" />
  return <CarteGoogle points={points} />
}

/**
 * Chargement du script, une fois pour toute l'application.
 * Promesse au niveau du module : plusieurs montages ne rechargent pas le script.
 */
let chargement: Promise<void> | null = null
const NOM_CALLBACK = '__dmtjMapsPret'

function chargerScript(cle: string): Promise<void> {
  if (chargement) return chargement
  chargement = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('cote serveur'))
    if (window.google?.maps?.Map) return resolve()

    // `loading=async` impose de passer par `callback` : l'événement `load` du script
    // se déclenche AVANT que les constructeurs soient disponibles sur `google.maps`.
    ;(window as unknown as Record<string, () => void>)[NOM_CALLBACK] = () => resolve()

    const minuteur = setTimeout(
      () => reject(new Error('délai dépassé au chargement')),
      10_000,
    )
    const fini = () => clearTimeout(minuteur)

    const s = document.createElement('script')
    s.async = true
    s.src = `https://maps.googleapis.com/maps/api/js?key=${cle}`
      + `&loading=async&libraries=maps,marker&callback=${NOM_CALLBACK}`
    s.onerror = () => { fini(); reject(new Error('script Google Maps injoignable')) }
    document.head.appendChild(s)

    void Promise.resolve().then(() => chargement?.then(fini, fini))
  })
  return chargement
}

function CarteGoogle({ points }: { points: Point[] }) {
  const conteneur = useRef<HTMLDivElement>(null)
  const carte = useRef<google.maps.Map | null>(null)
  const marqueurs = useRef<google.maps.Marker[]>([])
  const [pret, setPret] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    chargerScript(CLE!)
      .then(() => vivant && setPret(true))
      .catch((e: Error) => vivant && setErreur(e.message))
    return () => { vivant = false }
  }, [])

  // Instanciation unique.
  useEffect(() => {
    if (!pret || !conteneur.current || carte.current) return
    carte.current = new google.maps.Map(conteneur.current, {
      center: { lat: 45.757, lng: 4.832 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
    })
  }, [pret])

  // Seuls les marqueurs changent quand les filtres bougent.
  useEffect(() => {
    if (!pret || !carte.current) return
    marqueurs.current.forEach((m) => m.setMap(null))
    marqueurs.current = points.map((p) => new google.maps.Marker({
      map: carte.current!,
      position: { lat: p.lat, lng: p.lng },
      title: p.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: RISQUE[p.coupureRisk].couleur,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 1.5,
      },
    }))
    if (points.length) {
      const bornes = new google.maps.LatLngBounds()
      points.forEach((p) => bornes.extend({ lat: p.lat, lng: p.lng }))
      carte.current.fitBounds(bornes, 48)

      // Sur un resultat unique, fitBounds cadre au zoom maximum et on perd tout
      // repere : on garde assez de contexte pour situer le quartier.
      const c = carte.current
      google.maps.event.addListenerOnce(c, 'idle', () => {
        if ((c.getZoom() ?? 0) > 15) c.setZoom(15)
      })
    }
  }, [pret, points])

  // Si la carte ne charge pas, on ne laisse pas un cadre vide : on retombe sur
  // l'aperçu, qui reste utilisable.
  if (erreur) return <ApercuSansCle points={points} raison={erreur} />

  return (
    <div className="relative h-[28rem] w-full overflow-hidden rounded-lg bg-stone-200">
      <div ref={conteneur} className="h-full w-full" />
      {!pret && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">
          Chargement de la carte…
        </p>
      )}
      <Legende className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 shadow" />
    </div>
  )
}

/**
 * Sans clé Google — ou si la carte ne charge pas — on ne fabrique pas une fausse
 * carte : on montre la répartition réelle des points, clairement étiquetée.
 */
function ApercuSansCle({ points, raison }: { points: Point[]; raison: string }) {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const bornes = points.length
    ? { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lngs), o: Math.min(...lngs) }
    : { n: 1, s: 0, e: 1, o: 0 }
  const hauteur = Math.max(bornes.n - bornes.s, 1e-4)
  const largeur = Math.max(bornes.e - bornes.o, 1e-4)

  return (
    <div className="flex h-[28rem] flex-col rounded-lg border border-dashed border-stone-300 bg-white p-3">
      <p className="mb-2 text-xs text-stone-500">
        {raison === 'cle-absente'
          ? 'Aperçu de la répartition — la carte Google s’activera dès que la clé sera configurée.'
          : `Aperçu de la répartition — carte Google indisponible (${raison}).`}
      </p>
      <svg viewBox="0 0 100 100" className="min-h-0 flex-1 rounded bg-stone-100">
        {points.map((p) => (
          <circle
            key={p.id}
            cx={((p.lng - bornes.o) / largeur) * 96 + 2}
            cy={((bornes.n - p.lat) / hauteur) * 96 + 2}
            r={1.6}
            fill={RISQUE[p.coupureRisk].couleur}
            stroke="#fff"
            strokeWidth={0.4}
          >
            <title>{p.name}</title>
          </circle>
        ))}
      </svg>
      <Legende className="mt-2" />
    </div>
  )
}

function Legende({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600 ${className}`}>
      {(['aucun', 'faible', 'moyen', 'eleve', 'inconnu'] as RisqueCoupure[]).map((r) => (
        <span key={r} className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISQUE[r].couleur }} />
          {RISQUE[r].label}
        </span>
      ))}
    </div>
  )
}
