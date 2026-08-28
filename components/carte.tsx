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
 * Un « map load » se compte à chaque `new google.maps.Map()`, pas au pan/zoom.
 * La carte est donc instanciée UNE SEULE FOIS et on ne remplace que les marqueurs :
 * sinon chaque changement de filtre consommerait un chargement facturable.
 * Voir .specs/technique/02-budget-google-et-garde-fous.md
 */
export function Carte({ points }: { points: Point[] }) {
  if (!CLE) return <ApercuSansCle points={points} />
  return <CarteGoogle points={points} />
}

function CarteGoogle({ points }: { points: Point[] }) {
  const conteneur = useRef<HTMLDivElement>(null)
  const carte = useRef<google.maps.Map | null>(null)
  const marqueurs = useRef<google.maps.Marker[]>([])
  const [pret, setPret] = useState(false)

  // Chargement du script, une fois pour toutes.
  useEffect(() => {
    if (window.google?.maps) { setPret(true); return }
    const id = 'gmaps-js'
    if (document.getElementById(id)) return
    const s = document.createElement('script')
    s.id = id
    s.async = true
    s.src = `https://maps.googleapis.com/maps/api/js?key=${CLE}&libraries=maps&loading=async`
    s.onload = () => setPret(true)
    document.head.appendChild(s)
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
    if (!carte.current) return
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
    }
  }, [points, pret])

  return <div ref={conteneur} className="h-full min-h-[24rem] w-full rounded-lg bg-stone-200" />
}

/**
 * Sans clé Google, on ne fabrique pas une fausse carte : on montre la répartition
 * réelle des points, clairement étiquetée comme un aperçu.
 */
function ApercuSansCle({ points }: { points: Point[] }) {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const bornes = points.length
    ? { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lngs), o: Math.min(...lngs) }
    : { n: 1, s: 0, e: 1, o: 0 }
  const hauteur = Math.max(bornes.n - bornes.s, 1e-4)
  const largeur = Math.max(bornes.e - bornes.o, 1e-4)

  return (
    <div className="flex h-full min-h-[24rem] flex-col rounded-lg border border-dashed border-stone-300 bg-white p-3">
      <p className="mb-2 text-xs text-stone-500">
        Aperçu de la répartition — la carte Google s’activera dès que la clé sera configurée.
      </p>
      <svg viewBox="0 0 100 100" className="flex-1 rounded bg-stone-100">
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
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600">
        {(['aucun', 'faible', 'moyen', 'eleve', 'inconnu'] as RisqueCoupure[]).map((r) => (
          <span key={r} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISQUE[r].couleur }} />
            {RISQUE[r].label}
          </span>
        ))}
      </div>
    </div>
  )
}
