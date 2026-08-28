import { describe, expect, it } from 'vitest'
import { distanceMetres, indiceHilbert, planifierCellules } from '@/lib/maillage'
import type { Cellule, Point } from '@/lib/maillage'
import { MAILLAGE } from '@/lib/config'

const OPTIONS = { cible: 15, rayonMax: 200, rayonMin: 40 }

/** Centre de Lyon : les tests doivent tourner à la latitude où le maillage sert. */
const BASE: Point = { lat: 45.76, lng: 4.835 }
const METRES_PAR_DEGRE_LAT = 111_100
const METRES_PAR_DEGRE_LNG = METRES_PAR_DEGRE_LAT * Math.cos((BASE.lat * Math.PI) / 180)

/** Point à (dx, dy) mètres d'une origine — plus lisible que des degrés. */
function decale(origine: Point, dxMetres: number, dyMetres: number): Point {
  return {
    lat: origine.lat + dyMetres / METRES_PAR_DEGRE_LAT,
    lng: origine.lng + dxMetres / METRES_PAR_DEGRE_LNG,
  }
}

/** Pseudo-aléatoire déterministe : un test qui échoue doit réechouer à l'identique. */
function alea(graine: number) {
  let s = graine
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

function nuage(n: number, cote: number, graine: number, origine: Point = BASE): Point[] {
  const rnd = alea(graine)
  return Array.from({ length: n }, () =>
    decale(origine, (rnd() - 0.5) * cote, (rnd() - 0.5) * cote),
  )
}

const trie = (xs: number[]) => [...xs].sort((a, b) => a - b)
const mediane = (xs: number[]) => trie(xs)[Math.floor(xs.length / 2)]

/**
 * Cellule d'appartenance d'un point : la plus proche parmi celles qui le
 * couvrent. Le plan ne renvoie pas les appartenances — c'est une reconstitution
 * pour les tests, pas une vérité de l'algorithme.
 */
function celluleDe(point: Point, cellules: Cellule[]): number {
  let meilleure = -1
  let meilleureDistance = Infinity
  cellules.forEach((c, i) => {
    const d = distanceMetres(c, point)
    if (d <= c.rayon + 1e-6 && d < meilleureDistance) {
      meilleureDistance = d
      meilleure = i
    }
  })
  return meilleure
}

// ─────────────────────────────────────────────────────────────
// La courbe elle-même. C'est le morceau qui casse en silence :
// une rotation de quadrant fausse donne un tri plausible mais dispersé.
// ─────────────────────────────────────────────────────────────
describe('courbe de Hilbert', () => {
  it('numérote chaque case d’une grille une fois et une seule', () => {
    const n = 16
    const vus = new Set<number>()
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) vus.add(indiceHilbert(x, y, n))
    }
    expect(vus.size).toBe(n * n)
    expect(Math.min(...vus)).toBe(0)
    expect(Math.max(...vus)).toBe(n * n - 1)
  })

  it('enchaîne deux indices consécutifs sur deux cases contiguës', () => {
    const n = 16
    const parIndice: Point[] = []
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) parIndice[indiceHilbert(x, y, n)] = { lat: y, lng: x }
    }
    for (let d = 1; d < n * n; d++) {
      const pas = Math.abs(parIndice[d].lng - parIndice[d - 1].lng) +
        Math.abs(parIndice[d].lat - parIndice[d - 1].lat)
      expect(pas).toBe(1)
    }
  })

  it('tient sur toute la grille de projection sans perdre de précision', () => {
    // 2^32 - 1 : au-delà des entiers 32 bits des opérateurs binaires JS.
    expect(indiceHilbert(0, 0)).toBe(0)
    expect(indiceHilbert(65_535, 0)).toBe(4_294_967_295)
    expect(Number.isSafeInteger(indiceHilbert(65_535, 0))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// Les deux contraintes. Un dépassement de rayon = une troncature Google
// silencieuse ; un dépassement de comptage = un détecteur de troncature faux.
// ─────────────────────────────────────────────────────────────
describe('contraintes du plan', () => {
  const points = [
    ...nuage(400, 300, 1), // cœur dense : le comptage ferme les cellules
    ...nuage(150, 3000, 2), // couronne clairsemée : le rayon ferme les cellules
  ]
  const cellules = planifierCellules(points, OPTIONS)

  it('ne dépasse jamais la cible de points par cellule', () => {
    expect(cellules.every((c) => c.sireneCount <= OPTIONS.cible)).toBe(true)
  })

  it('ne dépasse jamais le rayon maximal', () => {
    expect(cellules.every((c) => c.rayon <= OPTIONS.rayonMax)).toBe(true)
  })

  it('n’émet jamais de cercle plus petit que le plancher', () => {
    expect(cellules.every((c) => c.rayon >= OPTIONS.rayonMin)).toBe(true)
  })

  it('n’émet aucune cellule vide', () => {
    expect(cellules.every((c) => c.sireneCount >= 1)).toBe(true)
  })

  it('ne perd ni ne duplique aucun point', () => {
    const total = cellules.reduce((s, c) => s + c.sireneCount, 0)
    expect(total).toBe(points.length)
  })

  it('couvre effectivement chaque point par au moins un cercle', () => {
    // Le vrai risque du projet : un établissement hors de tout cercle n'est
    // jamais interrogé, et son absence ne se voit nulle part.
    expect(points.every((p) => celluleDe(p, cellules) !== -1)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// Compacité : c'est tout l'intérêt de Hilbert face au quadtree.
// ─────────────────────────────────────────────────────────────
describe('compacité', () => {
  it('ne mélange pas des amas éloignés les uns des autres', () => {
    // 12 amas de 10 points distants de 1,2 km, chacun tenant largement sous les
    // deux contraintes : le plan doit rester proche de 12 cellules.
    const amas = Array.from({ length: 12 }, (_, i) =>
      decale(BASE, (i % 4) * 1200, Math.floor(i / 4) * 1200),
    )
    const points = amas.flatMap((centre) => nuage(10, 60, 7 + centre.lat * 1e6, centre))
    const cellules = planifierCellules(points, OPTIONS)

    // Aucune cellule ne peut contenir deux amas : son rayon vaudrait alors des
    // centaines de mètres. C'est la preuve directe de la non-fusion.
    expect(cellules.every((c) => c.rayon < 100)).toBe(true)
    // Un amas posé à cheval sur une frontière de quadrant de la courbe se
    // retrouve coupé en deux cellules — limite connue et acceptée : le coût est
    // d'un appel, là où un quadtree en dépensait plus du double.
    expect(cellules.length).toBeGreaterThanOrEqual(12)
    expect(cellules.length).toBeLessThanOrEqual(16)
  })

  it('range deux points voisins dans la même cellule, dans la grande majorité des cas', () => {
    const points = nuage(500, 800, 11)
    const cellules = planifierCellules(points, OPTIONS)
    const appartenance = points.map((p) => celluleDe(p, cellules))

    let ensemble = 0
    points.forEach((p, i) => {
      let voisin = -1
      let meilleure = Infinity
      points.forEach((q, j) => {
        if (i === j) return
        const d = distanceMetres(p, q)
        if (d < meilleure) {
          meilleure = d
          voisin = j
        }
      })
      if (appartenance[i] === appartenance[voisin]) ensemble++
    })

    // Mesuré autour de 0,86 sur plusieurs graines ; une affectation au hasard
    // donnerait 1/34. Le seuil vise la propriété de localité, pas la valeur
    // exacte que rend cette implémentation.
    expect(ensemble / points.length).toBeGreaterThan(0.75)
  })
})

// ─────────────────────────────────────────────────────────────
// Ce que la mesure a établi : c'est le rayon qui ferme les cellules.
// ─────────────────────────────────────────────────────────────
describe('hiérarchie des contraintes', () => {
  it('laisse le rayon fermer les cellules en zone clairsemée', () => {
    // 300 points sur 2 km × 2 km : 15 points y occupent bien plus de 200 m,
    // donc les cellules se ferment sous la cible, pas dessus.
    const cellules = planifierCellules(nuage(300, 2000, 23), OPTIONS)
    expect(mediane(cellules.map((c) => c.sireneCount))).toBeLessThan(OPTIONS.cible)
    expect(Math.max(...cellules.map((c) => c.rayon))).toBeLessThanOrEqual(OPTIONS.rayonMax)
  })

  it('laisse le comptage fermer les cellules en zone dense', () => {
    // 400 points sur 200 m × 200 m : le rayon n'est jamais atteint.
    const cellules = planifierCellules(nuage(400, 200, 29), OPTIONS)
    expect(mediane(cellules.map((c) => c.sireneCount))).toBe(OPTIONS.cible)
  })
})

// ─────────────────────────────────────────────────────────────
// Cas limites
// ─────────────────────────────────────────────────────────────
describe('cas limites', () => {
  it('ne planifie aucun appel sur un nuage vide', () => {
    expect(planifierCellules([], OPTIONS)).toEqual([])
  })

  it('pose le plancher de rayon sur un point isolé', () => {
    const cellules = planifierCellules([BASE], OPTIONS)
    expect(cellules).toHaveLength(1)
    expect(cellules[0].rayon).toBe(OPTIONS.rayonMin)
    expect(cellules[0].lat).toBeCloseTo(BASE.lat, 9)
    expect(cellules[0].lng).toBeCloseTo(BASE.lng, 9)
  })

  it('découpe par comptage un tas de points strictement superposés', () => {
    const cellules = planifierCellules(Array(40).fill(BASE), OPTIONS)
    expect(cellules.map((c) => c.sireneCount)).toEqual([15, 15, 10])
    expect(cellules.every((c) => c.rayon === OPTIONS.rayonMin)).toBe(true)
  })

  it('supporte un nuage entièrement aligné sans division par zéro', () => {
    const points = Array.from({ length: 30 }, (_, i) => decale(BASE, i * 50, 0))
    const cellules = planifierCellules(points, OPTIONS)
    expect(cellules.reduce((s, c) => s + c.sireneCount, 0)).toBe(30)
    expect(cellules.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(true)
  })

  it('refuse bruyamment un point non géocodé plutôt que de manquer la zone', () => {
    expect(() => planifierCellules([BASE, { lat: NaN, lng: 4.8 }], OPTIONS)).toThrow(/géocod/)
  })

  it('refuse une configuration de maillage incohérente', () => {
    expect(() => planifierCellules([BASE], { ...OPTIONS, cible: 0 })).toThrow(/cible/)
    expect(() => planifierCellules([BASE], { ...OPTIONS, rayonMax: 0 })).toThrow(/rayonMax/)
    expect(() => planifierCellules([BASE], { ...OPTIONS, rayonMin: 500 })).toThrow(/rayonMin/)
  })

  it('accepte la configuration du projet telle quelle', () => {
    const cellules = planifierCellules(nuage(100, 500, 31), MAILLAGE)
    expect(cellules.every((c) => c.sireneCount <= MAILLAGE.cible)).toBe(true)
    expect(cellules.every((c) => c.rayon <= MAILLAGE.rayonMax)).toBe(true)
  })
})
