/**
 * Jeu de démonstration.
 *
 * Les établissements sont FICTIFS — on ne fabrique pas de fausses données sur des
 * commerces réels. En revanche les horaires traversent exactement la même chaîne que
 * le futur balayage : format Google -> parserHoraires -> calculerProfil.
 * Le jour où les clés arrivent, seule la source change.
 */
import { calculerProfil, parserHoraires } from '../lib/horaires'
import type { Categorie, GooglePeriode } from '../lib/horaires'
import { db } from '../lib/db/client'
import { restaurant } from '../lib/db/schema'

type Service = [number, number, number, number] // hOuvre, mOuvre, hFerme, mFerme

/** Construit des périodes au format Google. `day` 0 = dimanche. */
function periodes(jours: number[], services: Service[]): GooglePeriode[] {
  return jours.flatMap((jour) =>
    services.map(([hO, mO, hF, mF]) => {
      const apresMinuit = hF * 60 + mF <= hO * 60 + mO
      return {
        open: { day: jour, hour: hO, minute: mO },
        close: { day: apresMinuit ? (jour + 1) % 7 : jour, hour: hF, minute: mF },
      }
    }),
  )
}

const LUN = 1, MAR = 2, MER = 3, JEU = 4, VEN = 5, SAM = 6, DIM = 0
const SEMAINE = [LUN, MAR, MER, JEU, VEN]
const MAR_SAM = [MAR, MER, JEU, VEN, SAM]
const TOUS = [LUN, MAR, MER, JEU, VEN, SAM, DIM]

interface Archetype {
  categorie: Categorie
  effectif: string | null
  periodes: GooglePeriode[] | null
}

const ARCHETYPES: Record<string, Archetype> = {
  // Fermé dimanche + lundi : deux jours de repos d'affilée, mais coupure certaine.
  bouchon: { categorie: 'bistrot', effectif: '02', periodes: periodes(MAR_SAM, [[12, 0, 14, 0], [19, 0, 22, 0]]) },
  // Service continu, grosse équipe : pas de coupure possible.
  brasserieContinue: { categorie: 'brasserie', effectif: '12', periodes: periodes(TOUS, [[11, 30, 23, 0]]) },
  // Le profil roi : ni coupure ni week-end.
  cantine: { categorie: 'collectivite', effectif: '11', periodes: periodes(SEMAINE, [[7, 0, 15, 0]]) },
  midiBureaux: { categorie: 'bistrot', effectif: '02', periodes: periodes(SEMAINE, [[11, 30, 15, 0]]) },
  // Coupure, mais équipe moyenne : deux services partiels envisageables.
  gastro: { categorie: 'gastronomique', effectif: '03', periodes: periodes([MER, JEU, VEN, SAM], [[12, 0, 13, 30], [19, 30, 21, 30]]) },
  rapide: { categorie: 'rapide', effectif: '11', periodes: periodes(TOUS, [[11, 0, 23, 0]]) },
  // Fermeture après minuit : le piège de conversion Google.
  barAVin: { categorie: 'bar', effectif: '01', periodes: periodes(MAR_SAM, [[17, 0, 1, 0]]) },
  pizzeriaSoir: { categorie: 'pizzeria', effectif: '02', periodes: periodes([MAR, MER, JEU, VEN, SAM, DIM], [[18, 30, 23, 0]]) },
  // Coupure à l'ouverture, mais 20+ salariés : deux brigades probables.
  brasserieCoupure: { categorie: 'brasserie', effectif: '12', periodes: periodes([LUN, MAR, MER, JEU, VEN, SAM], [[12, 0, 15, 0], [19, 0, 23, 0]]) },
  // Effectif inconnu : la fiabilité doit se dégrader visiblement.
  coupureInconnu: { categorie: 'bistrot', effectif: null, periodes: periodes(MAR_SAM, [[12, 0, 14, 30], [19, 0, 22, 30]]) },
  // Google ne connaît pas les horaires : on l'affiche quand même.
  sansHoraires: { categorie: 'autre', effectif: '02', periodes: null },
}

const ZONES: { commune: string; insee: string; arr: number | null; lat: number; lng: number }[] = [
  { commune: 'Lyon 1er', insee: '69381', arr: 1, lat: 45.7677, lng: 4.8336 },
  { commune: 'Lyon 2e', insee: '69382', arr: 2, lat: 45.7500, lng: 4.8270 },
  { commune: 'Lyon 3e', insee: '69383', arr: 3, lat: 45.7600, lng: 4.8560 },
  { commune: 'Lyon 4e', insee: '69384', arr: 4, lat: 45.7750, lng: 4.8290 },
  { commune: 'Lyon 5e', insee: '69385', arr: 5, lat: 45.7580, lng: 4.8180 },
  { commune: 'Lyon 6e', insee: '69386', arr: 6, lat: 45.7700, lng: 4.8500 },
  { commune: 'Lyon 7e', insee: '69387', arr: 7, lat: 45.7400, lng: 4.8420 },
  { commune: 'Lyon 8e', insee: '69388', arr: 8, lat: 45.7330, lng: 4.8700 },
  { commune: 'Lyon 9e', insee: '69389', arr: 9, lat: 45.7800, lng: 4.8050 },
  { commune: 'Villeurbanne', insee: '69266', arr: null, lat: 45.7700, lng: 4.8800 },
  { commune: 'Bron', insee: '69029', arr: null, lat: 45.7350, lng: 4.9100 },
  { commune: 'Vénissieux', insee: '69259', arr: null, lat: 45.6970, lng: 4.8850 },
]

/** Noms fictifs : aucun établissement réel n'est décrit ici. */
const NOMS: [string, keyof typeof ARCHETYPES][] = [
  ['Le Tablier de Soie', 'bouchon'], ['Chez Mauricette', 'bouchon'],
  ['La Marmite Canut', 'bouchon'], ['Le Pot Renversé', 'bouchon'],
  ['Brasserie du Quai Perdu', 'brasserieContinue'], ['Le Grand Balcon', 'brasserieContinue'],
  ['Taverne des Trois Ponts', 'brasserieContinue'],
  ['Restaurant Inter-Entreprises Novaris', 'cantine'], ['Cantine Lumière Campus', 'cantine'],
  ['Self du Parc Technologique', 'cantine'], ['Table du Lycée Ampère-Sud', 'cantine'],
  ['Le Midi Pile', 'midiBureaux'], ['Cantoche & Compagnie', 'midiBureaux'],
  ['Le Plateau du Jour', 'midiBureaux'], ['Bento Presqu’Ile', 'midiBureaux'],
  ['La Table d’Aristide', 'gastro'], ['Maison Verdelet', 'gastro'],
  ['L’Ardoise Blanche', 'gastro'],
  ['Burger Fabrique', 'rapide'], ['Wok Express Gerland', 'rapide'], ['Tacos du Rhône', 'rapide'],
  ['Le Verre à Moitié Plein', 'barAVin'], ['Bar des Serruriers', 'barAVin'],
  ['Comptoir Nocturne', 'barAVin'],
  ['Pizzeria Sole Mio', 'pizzeriaSoir'], ['La Part du Feu', 'pizzeriaSoir'],
  ['Forno Bellecour', 'pizzeriaSoir'],
  ['Brasserie Grand Comptoir', 'brasserieCoupure'], ['Le Régent des Halles', 'brasserieCoupure'],
  ['Brasserie de la Gare Nord', 'brasserieCoupure'],
  ['Le Petit Sillon', 'coupureInconnu'], ['Auberge des Deux Rives', 'coupureInconnu'],
  ['Chez Norbert', 'coupureInconnu'], ['La Cuisine d’Emma', 'coupureInconnu'],
  ['Le Bouchon Discret', 'coupureInconnu'],
  ['Snack Rive Gauche', 'sansHoraires'], ['Le Zinc Oublié', 'sansHoraires'],
]

/** Pseudo-aléatoire déterministe : le seed doit être reproductible. */
function alea(graine: number) {
  let s = graine
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

async function main() {
  const rnd = alea(42)
  const maintenant = new Date()
  const expiration = new Date(maintenant.getTime() + 30 * 24 * 3600 * 1000)

  const lignes = NOMS.map(([nom, cle], i) => {
    const a = ARCHETYPES[cle]
    const zone = ZONES[i % ZONES.length]
    const horaires = a.periodes ? { periods: a.periodes } : null
    const fenetres = parserHoraires(horaires)
    const profil = calculerProfil({ fenetres, codeEffectif: a.effectif, categorie: a.categorie })

    return {
      googlePlaceId: `demo-${String(i + 1).padStart(3, '0')}`,
      name: nom,
      formattedAddress: `${1 + Math.floor(rnd() * 90)} rue de la Démonstration, ${zone.commune}`,
      lat: zone.lat + (rnd() - 0.5) * 0.012,
      lng: zone.lng + (rnd() - 0.5) * 0.016,
      googleTypes: ['restaurant'],
      businessStatus: 'OPERATIONAL',
      inseeCode: zone.insee,
      commune: zone.commune,
      arrondissement: zone.arr,
      categorie: a.categorie,
      telephone: `04 78 ${10 + Math.floor(rnd() * 89)} ${10 + Math.floor(rnd() * 89)} ${10 + Math.floor(rnd() * 89)}`,
      siret: a.effectif ? String(10000000000000 + Math.floor(rnd() * 8999999999999)) : null,
      effectifCode: a.effectif,
      rawOpeningHours: horaires,
      hoursFetchedAt: horaires ? maintenant : null,
      hoursExpiresAt: horaires ? expiration : null,
      schedule: fenetres,
      hasHours: profil.aDesHoraires,
      openDaysCount: profil.joursOuverts,
      closedDays: profil.joursFermes,
      closedSaturday: profil.fermeSamedi,
      closedSunday: profil.fermeDimanche,
      closedWeekend: profil.fermeWeekend,
      maxConsecutiveDaysOff: profil.reposConsecutifsMax,
      splitDaysCount: profil.joursAvecCoupure,
      coupureRisk: profil.risqueCoupure,
      fiabilite: profil.fiabilite,
      motifService: profil.motifService,
      earliestOpenMin: profil.ouvertureMin,
      latestCloseMin: profil.fermetureMax,
      weeklyOpenMinutes: profil.minutesHebdo,
      explication: profil.explication,
      profileComputedAt: maintenant,
    }
  })

  await db.delete(restaurant)
  await db.insert(restaurant).values(lignes)

  console.log(`${lignes.length} etablissements de demonstration inseres`)
  const parRisque = lignes.reduce<Record<string, number>>((acc, l) => {
    acc[l.coupureRisk] = (acc[l.coupureRisk] ?? 0) + 1
    return acc
  }, {})
  console.log('repartition du risque de coupure :', parRisque)
  console.log('sans coupure ET week-end libre :',
    lignes.filter((l) => l.coupureRisk === 'aucun' && l.closedWeekend).length)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
