/**
 * Balayage Google `Nearby Search` — LE SEUL SCRIPT DU DÉPÔT QUI COÛTE DE L'ARGENT.
 *
 * Un balayage complet vaut ~692 appels sur les 1 000 gratuits du mois, et le compte n'a
 * aucun crédit de secours : tout dépassement part sur la carte bancaire dès le premier
 * euro. D'où `--dry-run` par défaut, le compteur à arrêt net, et le refus de rejouer un
 * balayage récent.
 *
 * Voir .specs/technique/02-budget-google-et-garde-fous.md
 *  et  .specs/technique/03-algorithme-de-balayage.md
 *
 * Usage :
 *   node --env-file=.env.local --import tsx scripts/sweep.ts            # dry-run, 0 appel
 *   node --env-file=.env.local --import tsx scripts/sweep.ts --go       # dépense réellement
 *   node --env-file=.env.local --import tsx scripts/sweep.ts --go --force
 */
import { and, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { cellule, restaurant, sirene, sweepRun } from '../lib/db/schema'
import {
  ARRONDISSEMENT_PAR_COMMUNE, BALAYAGE, FIELD_MASK, MAILLAGE, NOM_COMMUNE,
  RATIO_GOOGLE_SIRENE, RESULTATS_MAX_NEARBY, TTL_HORAIRES_JOURS, TYPES_GOOGLE,
} from '../lib/config'
import { deduireCategorie } from '../lib/categorie'
import { calculerProfil, parserHoraires } from '../lib/horaires'
import type { Categorie, GoogleHoraires } from '../lib/horaires'
import { colonnesProfil } from '../lib/profil-colonnes'
// Le maillage a posé les cercles avec CETTE distance : les recouper avec une autre
// approximation ferait sortir du cercle des points que le plan y avait mis.
import { distanceMetres as distancePoints, METRES_PAR_DEGRE_LAT } from '../lib/maillage'

const URL_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby'

/** Au-delà, le SIRENE le plus proche n'est plus une preuve de commune, juste un voisin. */
const RAYON_RATTACHEMENT = 300

const RAD = Math.PI / 180

const STATUT_REUSSI = 'reussi'
const STATUT_ECHEC = 'echec'

type Cellule = typeof cellule.$inferSelect

interface LieuGoogle {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  businessStatus?: string
  regularOpeningHours?: GoogleHoraires
  nationalPhoneNumber?: string
}

interface PointSirene {
  lat: number
  lng: number
  codeCommune: string
  commune: string | null
}

interface Etat {
  appels: number
  /**
   * Appels déjà facturés par les exécutions précédentes de CE run. Sans eux, chaque
   * reprise repartirait de zéro et le plafond de `BALAYAGE.appelsMax` deviendrait un
   * plafond par exécution, pas par balayage : dix reprises, dix fois le plafond.
   */
  appelsAnterieurs: number
  cellulesInterrogees: number
  vus: Set<string>
  avecHoraires: Set<string>
  sansRattachement: Set<string>
  sirene: PointSirene[]
}

// --- Géométrie ---------------------------------------------------------------------

function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return distancePoints({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng })
}

/** Pré-filtre par rectangle englobant avant la distance exacte — pas de PostGIS (D12). */
function pointsDansCercle(points: PointSirene[], lat: number, lng: number, rayon: number): PointSirene[] {
  const dLat = rayon / METRES_PAR_DEGRE_LAT
  const dLng = dLat / Math.max(0.01, Math.cos(lat * RAD))
  return points.filter(
    (p) =>
      Math.abs(p.lat - lat) <= dLat &&
      Math.abs(p.lng - lng) <= dLng &&
      distanceMetres(lat, lng, p.lat, p.lng) <= rayon,
  )
}

/**
 * Quatre cercles couvrant le cercle parent SANS TROU.
 *
 * On couvre le carré circonscrit au parent : chacun de ses quatre quadrants, de côté R,
 * tient dans un cercle de rayon R·√2/2 centré sur ce quadrant. Un découpage plus serré
 * (quatre cercles de rayon R/2) laisserait quatre zones jamais interrogées — exactement
 * le défaut qui ne se voit jamais dans l'interface.
 */
function subdiviser(parent: Cellule): { lat: number; lng: number; rayon: number }[] {
  const rayon = Math.max(MAILLAGE.rayonMin, parent.rayon * Math.SQRT1_2)
  const demi = parent.rayon / 2
  const metresParDegreLng = METRES_PAR_DEGRE_LAT * Math.max(0.01, Math.cos(parent.lat * RAD))

  return [
    [-demi, -demi], [demi, -demi], [-demi, demi], [demi, demi],
  ].map(([dx, dy]) => ({
    lat: parent.lat + dy / METRES_PAR_DEGRE_LAT,
    lng: parent.lng + dx / metresParDegreLng,
    rayon,
  }))
}

// --- Appel Google ------------------------------------------------------------------

async function interrogerGoogle(lat: number, lng: number, rayon: number): Promise<LieuGoogle[]> {
  const reponse = await fetch(URL_NEARBY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY as string,
      // Constante partagée, jamais reconstruite : la facturation suit le champ le plus cher.
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [...TYPES_GOOGLE],
      maxResultCount: RESULTATS_MAX_NEARBY,
      // Sans ce tri, la distance du dernier résultat ne dit rien : c'est lui qui rend la
      // détection de troncature possible.
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: rayon } },
    }),
  })

  // Ici un 429 ne veut pas dire « ralentis » mais « quota épuisé » : on ne réessaie pas.
  if (reponse.status === 429) {
    throw new Error(
      'HTTP 429 — quota Google atteint. NE PAS RELANCER avant le renouvellement mensuel. ' +
      `Réponse : ${(await reponse.text()).slice(0, 300)}`,
    )
  }
  if (!reponse.ok) {
    throw new Error(`HTTP ${reponse.status} — ${(await reponse.text()).slice(0, 300)}`)
  }

  const donnees = (await reponse.json()) as { places?: LieuGoogle[] }
  return donnees.places ?? []
}

/**
 * Les résultats étant triés par distance et plafonnés à 20, tout établissement au-delà du
 * 20e a été écarté : la cellule n'est couverte que jusqu'à la distance du dernier.
 * Le compte SIRENE sert de second signal, indépendant de la justesse du premier.
 */
function detecterTroncature(
  nombre: number, distanceMax: number, rayon: number, sireneCount: number,
): { tronquee: boolean; motif: string } {
  if (nombre < RESULTATS_MAX_NEARBY) return { tronquee: false, motif: '' }

  if (distanceMax < rayon) {
    return {
      tronquee: true,
      motif: `20 résultats, le plus lointain à ${Math.round(distanceMax)} m pour un rayon de ${Math.round(rayon)} m`,
    }
  }
  if (sireneCount * RATIO_GOOGLE_SIRENE >= RESULTATS_MAX_NEARBY) {
    return {
      tronquee: true,
      motif: `20 résultats et ${sireneCount} établissements SIRENE attendus dans le cercle`,
    }
  }
  return { tronquee: false, motif: '' }
}

// --- Écriture des établissements ----------------------------------------------------

/**
 * Rattachement administratif par le SIRENE géocodé le plus proche : sans géométrie
 * communale (D12), c'est la seule appartenance qu'on puisse établir. Elle est approximative
 * en bordure de commune — préférable à un arrondissement inventé.
 */
function rattacher(etat: Etat, lat: number, lng: number): PointSirene | null {
  const proches = pointsDansCercle(etat.sirene, lat, lng, RAYON_RATTACHEMENT)
  let meilleur: PointSirene | null = null
  let meilleureDistance = Infinity
  for (const p of proches) {
    const d = distanceMetres(lat, lng, p.lat, p.lng)
    if (d < meilleureDistance) {
      meilleureDistance = d
      meilleur = p
    }
  }
  return meilleur
}

async function ecrireLieux(lieux: LieuGoogle[], etat: Etat): Promise<void> {
  const valides = lieux.filter((l) => l.id && l.location?.latitude != null && l.location?.longitude != null)
  for (const rejete of lieux.filter((l) => !valides.includes(l))) {
    console.warn(`  ! lieu sans identifiant ou sans position, ignoré : ${JSON.stringify(rejete).slice(0, 160)}`)
  }
  if (valides.length === 0) return

  // L'effectif et le code d'activité appartiennent à `match:sirene`, la catégorie affinée
  // à `compute:profiles`. On les relit pour ne rien dégrader entre ce balayage et eux.
  const connus = await db
    .select({
      id: restaurant.googlePlaceId,
      effectif: restaurant.effectifCode,
      naf: restaurant.nafCode,
      categorie: restaurant.categorie,
    })
    .from(restaurant)
    .where(inArray(restaurant.googlePlaceId, valides.map((l) => l.id as string)))
  const anterieurs = new Map(connus.map((r) => [r.id, r]))

  const maintenant = new Date()
  const expiration = new Date(maintenant.getTime() + TTL_HORAIRES_JOURS * 24 * 3600 * 1000)

  for (const lieu of valides) {
    const id = lieu.id as string
    const lat = lieu.location!.latitude as number
    const lng = lieu.location!.longitude as number

    const horaires = lieu.regularOpeningHours ?? null
    const fenetres = parserHoraires(horaires)
    const nom = lieu.displayName?.text ?? '(sans nom)'

    // `autre` veut dire « aucun indice » : il ne doit pas écraser une catégorie déjà déduite.
    const anterieur = anterieurs.get(id)
    const deduite = deduireCategorie({ types: lieu.types, naf: anterieur?.naf, nom })
    const categorie: Categorie = deduite === 'autre' ? (anterieur?.categorie ?? 'autre') : deduite

    const profil = calculerProfil({ fenetres, codeEffectif: anterieur?.effectif, categorie })

    const point = rattacher(etat, lat, lng)
    if (!point) etat.sansRattachement.add(id)

    const ligne = {
      googlePlaceId: id,
      name: nom,
      formattedAddress: lieu.formattedAddress ?? null,
      lat,
      lng,
      googleTypes: lieu.types ?? [],
      businessStatus: lieu.businessStatus ?? null,
      inseeCode: point?.codeCommune ?? null,
      commune: point ? (NOM_COMMUNE[point.codeCommune] ?? point.commune) : null,
      arrondissement: point ? (ARRONDISSEMENT_PAR_COMMUNE[point.codeCommune] ?? null) : null,
      categorie,
      telephone: lieu.nationalPhoneNumber ?? null,
      rawOpeningHours: horaires,
      hoursFetchedAt: horaires ? maintenant : null,
      hoursExpiresAt: horaires ? expiration : null,
      ...colonnesProfil(fenetres, profil),
      profileComputedAt: maintenant,
      lastSeenAt: maintenant,
    }

    // Ce que `ligne` ne contient pas n'est pas réécrit : `firstSeenAt`, qui date la
    // première apparition, et le rattachement SIRENE, qui appartient à `match:sirene`.
    await db.insert(restaurant).values(ligne)
      .onConflictDoUpdate({ target: restaurant.googlePlaceId, set: ligne })

    etat.vus.add(id)
    if (horaires) etat.avecHoraires.add(id)
  }
}

// --- Traitement d'une cellule -------------------------------------------------------

async function traiterCellule(c: Cellule, etat: Etat): Promise<void> {
  // Le cumul, pas le compteur de cette exécution : une reprise ne rouvre pas le plafond.
  if (etat.appelsAnterieurs + etat.appels >= BALAYAGE.appelsMax) {
    throw new Error(
      `plafond local de ${BALAYAGE.appelsMax} appels atteint (BALAYAGE.appelsMax) — ` +
      `${etat.appelsAnterieurs} déjà consommés par les exécutions précédentes de ce run, ` +
      `${etat.appels} par celle-ci. Arrêt avant toute dépense supplémentaire.`,
    )
  }

  etat.appels++
  let lieux: LieuGoogle[]
  try {
    lieux = await interrogerGoogle(c.lat, c.lng, c.rayon)
  } catch (erreur) {
    await db.update(cellule)
      .set({ statut: 'echec', interrogeeLe: new Date() })
      .where(eq(cellule.id, c.id))
    throw erreur
  }
  etat.cellulesInterrogees++

  const distanceMax = lieux.reduce((max, l) => {
    const lat = l.location?.latitude
    const lng = l.location?.longitude
    if (lat == null || lng == null) return max
    return Math.max(max, distanceMetres(c.lat, c.lng, lat, lng))
  }, 0)

  await ecrireLieux(lieux, etat)

  const mesure = {
    googleCount: lieux.length,
    distanceDernier: lieux.length ? distanceMax : null,
    interrogeeLe: new Date(),
  }
  const { tronquee, motif } = detecterTroncature(lieux.length, distanceMax, c.rayon, c.sireneCount)

  if (!tronquee) {
    await db.update(cellule).set({ ...mesure, statut: 'faite' }).where(eq(cellule.id, c.id))
    return
  }

  if (c.profondeur >= BALAYAGE.profondeurMax) {
    await db.update(cellule).set({ ...mesure, statut: 'irreductible' }).where(eq(cellule.id, c.id))
    console.warn(
      `  ! IRRÉDUCTIBLE — ${c.lat.toFixed(5)},${c.lng.toFixed(5)} r=${Math.round(c.rayon)} m ` +
      `profondeur ${c.profondeur} : ${motif}. À inspecter à la main.`,
    )
    return
  }

  const enfants = subdiviser(c).map((e) => ({
    sweepRunId: c.sweepRunId,
    lat: e.lat,
    lng: e.lng,
    rayon: e.rayon,
    sireneCount: pointsDansCercle(etat.sirene, e.lat, e.lng, e.rayon).length,
    profondeur: c.profondeur + 1,
    parentId: c.id,
    statut: 'a_faire' as const,
  }))

  // Marquage et enfants dans la même transaction : une cellule tronquée sans enfants
  // serait une troncature perdue de vue.
  await db.transaction(async (tx) => {
    await tx.update(cellule).set({ ...mesure, statut: 'tronquee' }).where(eq(cellule.id, c.id))
    await tx.insert(cellule).values(enfants)
  })

  console.log(`  troncature (${motif}) -> 4 cellules de ${Math.round(enfants[0].rayon)} m`)
}

// --- Bilan --------------------------------------------------------------------------

/** Une cellule tronquée n'est couverte que si TOUS ses enfants le sont, récursivement. */
function construireCouverture(cellules: Cellule[]): (c: Cellule) => boolean {
  const enfants = new Map<string, Cellule[]>()
  for (const c of cellules) {
    if (!c.parentId) continue
    const liste = enfants.get(c.parentId) ?? []
    liste.push(c)
    enfants.set(c.parentId, liste)
  }
  const couverte = (c: Cellule): boolean => {
    if (c.statut === 'faite') return true
    if (c.statut !== 'tronquee') return false
    const fils = enfants.get(c.id) ?? []
    return fils.length > 0 && fils.every(couverte)
  }
  return couverte
}

function pourcent(part: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((part / total) * 100)} %`
}

// --- Programme principal -------------------------------------------------------------

async function main() {
  const arguments_ = process.argv.slice(2)
  const inconnus = arguments_.filter((a) => !['--go', '--dry-run', '--force'].includes(a))
  if (inconnus.length) {
    console.error(`Options inconnues : ${inconnus.join(' ')}. Attendu : --go, --dry-run, --force`)
    process.exit(1)
  }
  const go = arguments_.includes('--go')
  const force = arguments_.includes('--force')

  // 1. Le plan. Un run dont il reste des cellules à faire, ou dont des cellules ont échoué.
  const enAttente = await db
    .selectDistinct({ runId: cellule.sweepRunId })
    .from(cellule)
    .where(inArray(cellule.statut, ['a_faire', 'echec']))

  if (enAttente.length === 0) {
    console.error(
      'Aucun plan de balayage à exécuter : aucune cellule « a_faire ».\n' +
      'Lancer `plan:cells` d\'abord — le balayage n\'invente pas son maillage.',
    )
    process.exit(1)
  }

  const ids = enAttente.map((r) => r.runId)
  const runsConnus = await db.select().from(sweepRun)
    .where(inArray(sweepRun.id, ids))
    .orderBy(desc(sweepRun.startedAt))

  if (runsConnus.length === 0 && ids.length > 1) {
    console.error(
      `${ids.length} plans de balayage en attente, aucun n'a de ligne dans sweep_run : ` +
      'impossible de choisir. Nettoyer la table cellule avant de continuer.',
    )
    process.exit(1)
  }
  const runId = runsConnus[0]?.id ?? ids[0]
  if (ids.length > 1) {
    console.warn(`! ${ids.length} plans en attente — seul le plus récent (${runId}) est balayé.`)
  }

  const cellules = await db.select().from(cellule).where(eq(cellule.sweepRunId, runId))
  const prevues = cellules.filter((c) => !c.parentId).length
  const aInterroger = cellules.filter((c) => c.statut === 'a_faire' || c.statut === 'echec').length

  // 2. Récence : le quota est mensuel, deux balayages dans le mois le consomment entièrement.
  const [dernierReussi] = await db.select().from(sweepRun)
    .where(eq(sweepRun.status, STATUT_REUSSI))
    .orderBy(desc(sweepRun.finishedAt))
    .limit(1)

  const joursDepuis = dernierReussi?.finishedAt
    ? (Date.now() - dernierReussi.finishedAt.getTime()) / 86_400_000
    : Infinity
  const tropRecent = joursDepuis < BALAYAGE.joursEntreBalayages

  // Une reprise a déjà dépensé : le coût annoncé est celui qui RESTE, et le plafond
  // s'apprécie sur le cumul. Annoncer le seul reliquat ferait croire à une marge.
  const dejaDepenses = runsConnus[0]?.callsMade ?? 0

  console.log('--- Plan de balayage ---')
  console.log(`run                       : ${runId}`)
  console.log(`cellules du plan          : ${prevues}`)
  console.log(`cellules à interroger     : ${aInterroger}`)
  console.log(`APPELS PRÉVUS             : ${aInterroger}  (plafond local ${BALAYAGE.appelsMax})`)
  console.log('  + 4 appels par cellule tronquée, jusqu\'à convergence')
  if (dejaDepenses > 0) {
    console.log(`  reprise : ${dejaDepenses} appel(s) déjà consommés par ce run, ` +
      `cumul prévu ${dejaDepenses + aInterroger}`)
  }
  if (dejaDepenses + aInterroger > BALAYAGE.appelsMax) {
    console.warn(`! le plan dépasse déjà le plafond de ${BALAYAGE.appelsMax} appels : il sera interrompu en cours de route.`)
  }
  if (tropRecent) {
    console.warn(
      `! un balayage a réussi il y a ${joursDepuis.toFixed(1)} jour(s), ` +
      `moins que les ${BALAYAGE.joursEntreBalayages} jours exigés.`,
    )
  }

  if (!go) {
    console.log('\nDRY-RUN — aucun appel émis, rien écrit. Ajouter --go pour dépenser réellement.')
    process.exit(0)
  }

  if (tropRecent && !force) {
    console.error(
      '\nREFUS DE DÉMARRER : le quota Google est mensuel et un balayage complet en consomme ' +
      'les deux tiers. Relancer après ce délai, ou forcer avec --force en connaissance de cause.',
    )
    process.exit(1)
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY manquante — voir .specs/technique/08-infrastructure.md')
    process.exit(1)
  }

  // 3. Le run existe peut-être déjà (créé par plan:cells, ou interrompu et repris).
  await db.insert(sweepRun).values({ id: runId, cellsPlanned: prevues }).onConflictDoNothing()
  await db.update(sweepRun)
    .set({ cellsPlanned: prevues, finishedAt: null, status: 'en_cours', error: null })
    .where(eq(sweepRun.id, runId))
  const [enCours] = await db.select().from(sweepRun).where(eq(sweepRun.id, runId))

  // Une reprise ne remet pas les compteurs à zéro : ce qui a déjà été dépensé l'a été.
  const appelsAnterieurs = enCours.callsMade
  const cellulesAnterieures = enCours.cellsQueried
  const debutRun = enCours.startedAt ?? new Date()

  // Une cellule en échec n'a jamais renvoyé de résultat : la reprise doit la rejouer.
  const reprises = cellules.filter((c) => c.statut === 'echec').length
  if (reprises > 0) {
    await db.update(cellule).set({ statut: 'a_faire' })
      .where(and(eq(cellule.sweepRunId, runId), eq(cellule.statut, 'echec')))
    console.log(`${reprises} cellule(s) en échec remises à faire.`)
  }
  const dejaFaites = cellules.filter((c) => c.statut === 'faite').length
  if (dejaFaites > 0) console.log(`${dejaFaites} cellule(s) déjà faites, non rejouées.`)

  const points = await db
    .select({ lat: sirene.lat, lng: sirene.lng, codeCommune: sirene.codeCommune, commune: sirene.commune })
    .from(sirene)
    .where(and(isNotNull(sirene.lat), isNotNull(sirene.lng), gte(sirene.geocodeScore, MAILLAGE.scoreGeocodeMin)))

  if (points.length === 0) {
    console.warn(
      '! aucun point SIRENE géocodé : ni recoupement de troncature, ni rattachement de commune. ' +
      'Le balayage continue, mais la base sortira sans arrondissements.',
    )
  }

  const etat: Etat = {
    appels: 0,
    appelsAnterieurs,
    cellulesInterrogees: 0,
    vus: new Set(),
    avecHoraires: new Set(),
    sansRattachement: new Set(),
    sirene: points as PointSirene[],
  }

  console.log('\n--- Balayage en cours ---')
  let interruption: Error | null = null

  try {
    // Vague par vague : les enfants créés par une troncature sont repris au tour suivant.
    for (;;) {
      const lot = await db.select().from(cellule)
        .where(and(eq(cellule.sweepRunId, runId), eq(cellule.statut, 'a_faire')))
        .orderBy(cellule.profondeur, cellule.id)
      if (lot.length === 0) break

      for (const c of lot) {
        // Séquentiel et jamais en parallèle : le compteur d'appels doit rester exact.
        await traiterCellule(c, etat)
        if (etat.cellulesInterrogees % 25 === 0) {
          console.log(`  ${etat.appels} appels, ${etat.vus.size} établissements`)
        }
      }
    }
  } catch (erreur) {
    // Toute erreur arrête le balayage : continuer à appeler une API qui répond mal,
    // c'est dépenser sans rien collecter. Les cellules faites ne seront pas rejouées.
    interruption = erreur as Error
    console.error(`\nARRÊT IMMÉDIAT DU BALAYAGE — ${interruption.message}`)
  }

  // 4. Bilan. Il fait foi : c'est lui qui décide si le balayage est réussi.
  const finales = await db.select().from(cellule).where(eq(cellule.sweepRunId, runId))
  const couverte = construireCouverture(finales)
  const tronquees = finales.filter((c) => c.statut === 'tronquee')
  const resolues = tronquees.filter(couverte).length
  const nonResolues = tronquees.length - resolues
  const irreductibles = finales.filter((c) => c.statut === 'irreductible').length
  const echecs = finales.filter((c) => c.statut === 'echec').length
  const restantes = finales.filter((c) => c.statut === 'a_faire').length

  const motifs: string[] = []
  if (nonResolues > 0) motifs.push(`${nonResolues} troncature(s) non résolue(s)`)
  if (irreductibles > 0) motifs.push(`${irreductibles} cellule(s) irréductible(s)`)
  if (echecs > 0) motifs.push(`${echecs} cellule(s) en échec`)
  if (restantes > 0) motifs.push(`${restantes} cellule(s) jamais interrogée(s)`)
  if (interruption) motifs.push(`interrompu : ${interruption.message}`)

  // Cumul des reprises : c'est le compteur qu'on confronte à la console de facturation.
  const [{ totalRun }] = await db.select({ totalRun: count() }).from(restaurant)
    .where(gte(restaurant.lastSeenAt, debutRun))
  const reprise = appelsAnterieurs > 0

  console.log('\n--- Bilan du balayage ---')
  console.log(`cellules prévues          : ${prevues}`)
  console.log(`cellules interrogées      : ${etat.cellulesInterrogees}`)
  console.log(`APPELS CONSOMMÉS          : ${etat.appels}  (prévus : ${aInterroger})`)
  if (reprise) {
    console.log(`  cumul du run             : ${appelsAnterieurs + etat.appels} appels, ` +
      `${cellulesAnterieures + etat.cellulesInterrogees} cellules interrogées`)
  }
  console.log(`troncatures résolues      : ${resolues}`)
  console.log(`troncatures NON résolues  : ${nonResolues}`)
  console.log(`cellules irréductibles    : ${irreductibles}`)
  console.log(`cellules en échec         : ${echecs}`)
  console.log(`cellules non interrogées  : ${restantes}`)
  console.log(`établissements trouvés    : ${etat.vus.size}`)
  if (reprise) console.log(`  cumul du run             : ${totalRun}`)
  console.log(`  avec horaires           : ${etat.avecHoraires.size} (${pourcent(etat.avecHoraires.size, etat.vus.size)})`)
  console.log(`  sans commune rattachée  : ${etat.sansRattachement.size}`)

  if (irreductibles > 0) {
    const liste = finales.filter((x) => x.statut === 'irreductible')
    console.log('\nCellules irréductibles à inspecter :')
    for (const c of liste.slice(0, 20)) {
      console.log(`  ${c.lat.toFixed(5)},${c.lng.toFixed(5)} r=${Math.round(c.rayon)} m — ${c.googleCount} résultats, SIRENE ${c.sireneCount}`)
    }
    if (liste.length > 20) {
      console.log(`  … et ${liste.length - 20} autres : select * from cellule where sweep_run_id = '${runId}' and statut = 'irreductible'`)
    }
  }

  const reussi = motifs.length === 0
  await db.update(sweepRun).set({
    finishedAt: new Date(),
    cellsPlanned: prevues,
    cellsQueried: cellulesAnterieures + etat.cellulesInterrogees,
    callsMade: appelsAnterieurs + etat.appels,
    truncatedUnresolved: nonResolues,
    irreducibleCells: irreductibles,
    placesFound: totalRun,
    status: reussi ? STATUT_REUSSI : STATUT_ECHEC,
    error: reussi ? null : motifs.join(' ; '),
  }).where(eq(sweepRun.id, runId))

  if (!reussi) {
    console.error(`\nBALAYAGE EN ÉCHEC — ${motifs.join(' ; ')}`)
    console.error('Une base silencieusement incomplète est pire qu\'un script en erreur : ' +
      'reprendre ce run (les cellules faites ne sont pas rejouées) après avoir traité la cause.')
    process.exit(1)
  }

  console.log('\nBalayage réussi. Suite du pipeline : match:sirene puis compute:profiles.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
