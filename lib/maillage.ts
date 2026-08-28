/**
 * Maillage du balayage : découper un nuage de points connus (SIRENE géocodé) en
 * cellules circulaires interrogeables une par une par `Nearby Search`.
 *
 * Pourquoi une courbe de Hilbert et pas un quadtree — un quadtree découpe
 * l'ESPACE uniformément : une zone dense force ses voisines clairsemées à se
 * subdiviser aussi. Mesuré sur le périmètre retenu : 1 316 cellules pour un
 * minimum théorique de 564. La courbe de Hilbert préserve la proximité
 * géographique tout en permettant un découpage par NOMBRE de points, ce qui
 * dépense des cellules là où il y a des restaurants et nulle part ailleurs.
 * Mesuré : 692 cellules. Voir DECISIONS.md D17.
 *
 * Deux contraintes ferment une cellule, et c'est le RAYON qui domine — mesure,
 * pas intuition : Google tronque à 20 résultats dès ~265 m de rayon, et à 168 m
 * une cellule en renvoie déjà 18. Le rayon médian obtenu est de 134 m, bien en
 * dessous de ce que la seule contrainte de comptage aurait donné.
 *
 * Module pur : aucune entrée/sortie, aucune dépendance à la base.
 */

export interface Point {
  lat: number
  lng: number
}

export interface OptionsMaillage {
  /** Nombre maximal de points par cellule. */
  cible: number
  /** Rayon maximal en mètres — la contrainte dominante. */
  rayonMax: number
  /** Plancher de rayon : un cercle de rayon nul ne cherche rien. */
  rayonMin: number
}

export interface Cellule {
  lat: number
  lng: number
  rayon: number
  /** Points SIRENE contenus. C'est le détecteur de troncature du balayage. */
  sireneCount: number
}

/** Exporté pour que le balayage borne ses rectangles avec la MÊME approximation. */
export const METRES_PAR_DEGRE_LAT = 111_100

/** Côté de la grille de projection. 2^16 : ~20 cm de résolution sur 13 km. */
const COTE_GRILLE = 65_536

/**
 * Distance en mètres, approximation équirectangulaire locale.
 * Sur des cellules de 200 m à la latitude de Lyon, l'écart avec un calcul
 * géodésique exact est inférieur au décimètre : inutile de payer un haversine.
 */
export function distanceMetres(a: Point, b: Point): number {
  const latMoyenne = (((a.lat + b.lat) / 2) * Math.PI) / 180
  const dy = (b.lat - a.lat) * METRES_PAR_DEGRE_LAT
  const dx = (b.lng - a.lng) * METRES_PAR_DEGRE_LAT * Math.cos(latMoyenne)
  return Math.hypot(dx, dy)
}

/**
 * Indice de Hilbert de la case (x, y) d'une grille n × n, n puissance de deux.
 *
 * Conversion xy -> d classique : on lit les bits de position du plus fort au
 * plus faible ; à chaque niveau le quadrant donne son rang le long de la courbe
 * (`(3·rx) ^ ry`), puis on fait TOURNER le repère pour que le motif du niveau
 * suivant se raccorde à celui-ci. C'est cette rotation qui fait la continuité de
 * la courbe, donc la préservation de la proximité.
 *
 * Précondition : x et y entiers dans [0, n-1].
 */
export function indiceHilbert(x: number, y: number, n: number = COTE_GRILLE): number {
  let cx = x
  let cy = y
  let d = 0
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (cx & s) > 0 ? 1 : 0
    const ry = (cy & s) > 0 ? 1 : 0
    // Somme et produit en arithmétique flottante : d monte jusqu'à 2^32 - 1,
    // hors des 32 bits signés des opérateurs binaires de JavaScript.
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        cx = n - 1 - cx
        cy = n - 1 - cy
      }
      const t = cx
      cx = cy
      cy = t
    }
  }
  return d
}

/** Barycentre du groupe. À cette échelle, une moyenne arithmétique suffit. */
function barycentre(points: Point[]): Point {
  let lat = 0
  let lng = 0
  for (const p of points) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

function rayonEnglobant(points: Point[], centre: Point): number {
  let rayon = 0
  for (const p of points) {
    const d = distanceMetres(centre, p)
    if (d > rayon) rayon = d
  }
  return rayon
}

/** Trie les points le long de la courbe, sans les copier plus d'une fois. */
function trierParHilbert(points: Point[]): Point[] {
  let latMin = Infinity
  let latMax = -Infinity
  let lngMin = Infinity
  let lngMax = -Infinity
  for (const p of points) {
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
  }
  // Nuage dégénéré (tous alignés, ou un seul point) : l'étendue nulle ne doit
  // pas produire de division par zéro, l'axe se replie alors sur la colonne 0.
  const etendueLat = latMax - latMin || 1
  const etendueLng = lngMax - lngMin || 1

  const indexes = points.map((p) => {
    const x = Math.floor(((p.lng - lngMin) / etendueLng) * (COTE_GRILLE - 1))
    const y = Math.floor(((p.lat - latMin) / etendueLat) * (COTE_GRILLE - 1))
    return { p, d: indiceHilbert(x, y) }
  })
  indexes.sort((a, b) => a.d - b.d)
  return indexes.map((i) => i.p)
}

function fermer(points: Point[], rayonMin: number): Cellule {
  const centre = barycentre(points)
  return {
    lat: centre.lat,
    lng: centre.lng,
    rayon: Math.max(rayonEnglobant(points, centre), rayonMin),
    sireneCount: points.length,
  }
}

/**
 * Plan de balayage : une cellule par appel Google à venir.
 *
 * Les points sont parcourus dans l'ordre de la courbe de Hilbert et accumulés
 * dans la cellule courante, fermée dès qu'ajouter le point suivant ferait
 * dépasser l'une des deux contraintes. Un point seul ne dépasse jamais rien :
 * aucune cellule ne peut être vide, et aucun point ne peut être perdu.
 */
export function planifierCellules(points: Point[], options: OptionsMaillage): Cellule[] {
  const { cible, rayonMax, rayonMin } = options

  if (!Number.isInteger(cible) || cible < 1) {
    throw new Error(`maillage : cible invalide (${cible}) — il faut au moins 1 point par cellule`)
  }
  if (!(rayonMax > 0)) {
    throw new Error(`maillage : rayonMax invalide (${rayonMax}) — un cercle sans rayon ne cherche rien`)
  }
  if (!(rayonMin >= 0) || rayonMin > rayonMax) {
    throw new Error(`maillage : rayonMin (${rayonMin}) doit tenir entre 0 et rayonMax (${rayonMax})`)
  }
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      throw new Error(
        `maillage : point sans coordonnées exploitables (lat=${p.lat}, lng=${p.lng}) — ` +
          'écarter les lignes non géocodées AVANT de planifier, sinon la zone est manquée en silence',
      )
    }
  }
  if (points.length === 0) return []

  const cellules: Cellule[] = []
  let courant: Point[] = []

  for (const point of trierParHilbert(points)) {
    if (courant.length === 0) {
      courant.push(point)
      continue
    }
    courant.push(point)
    const depasse =
      courant.length > cible || rayonEnglobant(courant, barycentre(courant)) > rayonMax
    if (depasse) {
      courant.pop()
      cellules.push(fermer(courant, rayonMin))
      courant = [point]
    }
  }
  cellules.push(fermer(courant, rayonMin))

  return cellules
}
