/**
 * plan:cells — calcule le plan de balayage à partir de la densité SIRENE connue,
 * et annonce ce qu'il coûterait en appels Google.
 *
 * Ce script ne consomme aucun quota, mais il DÉCIDE du quota que consommera
 * `sweep:google` : une cellule = un appel `Nearby Search`. C'est le point d'arrêt
 * du pipeline — on ne balaie pas un plan dont on n'a pas lu le coût.
 *
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts            (dry-run)
 *   node --env-file=.env.local --import tsx scripts/plan-cells.ts --write    (écrit)
 */
import { count, inArray } from 'drizzle-orm'
import {
  BALAYAGE, COMMUNES, MAILLAGE, NOM_COMMUNE, QUOTA_MENSUEL_GRATUIT,
  RATIO_GOOGLE_SIRENE, RESULTATS_MAX_NEARBY,
} from '../lib/config'
import { db } from '../lib/db/client'
import { cellule, sirene, sweepRun } from '../lib/db/schema'
import { planifierCellules } from '../lib/maillage'
import type { Cellule, Point } from '../lib/maillage'

/** Part d'établissements écartés au-delà de laquelle le géocodage est suspect. */
const SEUIL_ALERTE_ECARTES = 0.05

function lireOptions() {
  const args = process.argv.slice(2)
  const inconnues = args.filter((a) => a !== '--write' && a !== '--dry-run')
  if (inconnues.length > 0) {
    throw new Error(
      `option inconnue : ${inconnues.join(' ')} — seules --dry-run (defaut) et --write existent`,
    )
  }
  if (args.includes('--write') && args.includes('--dry-run')) {
    throw new Error('--write et --dry-run sont contradictoires : choisir l un ou l autre')
  }
  return { ecrire: args.includes('--write') }
}

/** Séparateurs de milliers en espaces ordinaires : le terminal rend mal les insécables. */
const nb = (n: number) => n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')

const ligne = (label: string, valeur: string | number, suffixe = '') =>
  console.log(`  ${label.padEnd(32)}${String(valeur).padStart(9)}${suffixe ? '  ' + suffixe : ''}`)

/** Quantile par rang le plus proche : pas d'interpolation, la valeur existe. */
function quantile(triees: number[], q: number): number {
  const i = Math.min(triees.length - 1, Math.max(0, Math.ceil(q * triees.length) - 1))
  return triees[i]
}

async function chargerPoints() {
  const [{ n: totalTable }] = await db.select({ n: count() }).from(sirene)

  const lignes = await db
    .select({
      lat: sirene.lat,
      lng: sirene.lng,
      score: sirene.geocodeScore,
      codeCommune: sirene.codeCommune,
    })
    .from(sirene)
    .where(inArray(sirene.codeCommune, [...COMMUNES]))

  const points: Point[] = []
  const parCommune = new Map<string, number>()
  let sansCoordonnees = 0
  let scoreInsuffisant = 0

  for (const l of lignes) {
    if (l.lat === null || l.lng === null) {
      sansCoordonnees++
      continue
    }
    // Un point mal géocodé déplace une cellule : mieux vaut un trou connu qu'un
    // cercle posé au mauvais endroit.
    if ((l.score ?? 0) < MAILLAGE.scoreGeocodeMin) {
      scoreInsuffisant++
      continue
    }
    points.push({ lat: l.lat, lng: l.lng })
    parCommune.set(l.codeCommune, (parCommune.get(l.codeCommune) ?? 0) + 1)
  }

  return {
    totalTable,
    enPerimetre: lignes.length,
    horsPerimetre: totalTable - lignes.length,
    sansCoordonnees,
    scoreInsuffisant,
    points,
    parCommune,
  }
}

function afficherPlan(cellules: Cellule[], nbPoints: number) {
  const rayons = cellules.map((c) => c.rayon).sort((a, b) => a - b)
  const comptes = cellules.map((c) => c.sireneCount).sort((a, b) => a - b)
  // Une cellule qui n'a pas atteint la cible a forcément été fermée par le
  // rayon. C'est la répartition qui dit laquelle des deux contraintes domine.
  const aLaCible = cellules.filter((c) => c.sireneCount >= MAILLAGE.cible).length
  const parLeRayon = cellules.length - aLaCible
  const risqueTroncature = cellules.filter(
    (c) => c.sireneCount * RATIO_GOOGLE_SIRENE >= RESULTATS_MAX_NEARBY,
  ).length
  const pct = (n: number) => `${Math.round((100 * n) / cellules.length)} %`

  console.log('\nCELLULES')
  ligne('nombre', nb(cellules.length))
  ligne('rayon median', `${Math.round(quantile(rayons, 0.5))} m`)
  ligne('rayon p95', `${Math.round(quantile(rayons, 0.95))} m`)
  ligne('rayon min / max', `${Math.round(rayons[0])} / ${Math.round(rayons[rayons.length - 1])} m`)
  ligne('points/cellule median', quantile(comptes, 0.5))
  ligne('points/cellule p95 / max', `${quantile(comptes, 0.95)} / ${comptes[comptes.length - 1]}`)
  ligne('points/cellule moyen', (nbPoints / cellules.length).toFixed(1))

  console.log('\nCE QUI FERME LES CELLULES')
  ligne(`le rayon (plafond ${MAILLAGE.rayonMax} m)`, nb(parLeRayon), pct(parLeRayon))
  ligne(`la cible de points (${MAILLAGE.cible})`, nb(aLaCible), pct(aLaCible))
  ligne(`estimees >= ${RESULTATS_MAX_NEARBY} chez Google`, nb(risqueTroncature), `ratio mesure x${RATIO_GOOGLE_SIRENE}`)
}

function afficherCout(cellules: Cellule[]) {
  const appels = cellules.length
  const marge = QUOTA_MENSUEL_GRATUIT - appels

  console.log('\nCOUT DU BALAYAGE')
  ligne('appels Nearby Search', nb(appels))
  ligne('plafond pose cote script', nb(BALAYAGE.appelsMax))
  ligne('quota mensuel gratuit', nb(QUOTA_MENSUEL_GRATUIT))
  ligne(
    'marge pour les subdivisions',
    nb(marge),
    marge > 0 ? `${Math.round((100 * marge) / appels)} % des cellules` : 'DEPASSEMENT',
  )
  return appels
}

async function ecrirePlan(cellules: Cellule[]) {
  const [run] = await db
    .insert(sweepRun)
    .values({ cellsPlanned: cellules.length })
    .returning({ id: sweepRun.id })

  await db.insert(cellule).values(
    cellules.map((c) => ({
      sweepRunId: run.id,
      lat: c.lat,
      lng: c.lng,
      rayon: c.rayon,
      sireneCount: c.sireneCount,
    })),
  )

  console.log(`\n${nb(cellules.length)} cellules ecrites, rattachees au sweep_run ${run.id}`)
  console.log('Les plans precedents ne sont pas touches : chaque execution cree son propre run.')
}

async function main() {
  const { ecrire } = lireOptions()
  const source = await chargerPoints()

  console.log(
    ecrire ? '\nPLAN DE BALAYAGE — ECRITURE EN BASE' : '\nPLAN DE BALAYAGE — DRY-RUN (aucune ecriture)',
  )

  console.log('\nPOINTS SIRENE')
  ligne('lignes en base', nb(source.totalTable))
  ligne('hors perimetre (ignorees)', nb(source.horsPerimetre))
  ligne('en perimetre', nb(source.enPerimetre))
  ligne('sans coordonnees (ecartees)', nb(source.sansCoordonnees))
  ligne(`score < ${MAILLAGE.scoreGeocodeMin} (ecartees)`, nb(source.scoreInsuffisant))
  ligne('retenues pour le maillage', nb(source.points.length))

  if (source.points.length === 0) {
    throw new Error(
      'aucun etablissement geocode en perimetre, rien a mailler.\n' +
        `  lignes dans sirene_etablissement : ${source.totalTable}\n` +
        '  lancer d abord ingest:sirene puis ingest:geocode.',
    )
  }

  // Un angle mort de géocodage est une zone jamais interrogée, et son absence ne
  // se voit nulle part dans l'interface : elle se voit ici ou jamais.
  const ecartees = source.sansCoordonnees + source.scoreInsuffisant
  const tauxEcarte = ecartees / source.enPerimetre
  if (tauxEcarte > SEUIL_ALERTE_ECARTES) {
    console.log(
      `\n! ${Math.round(100 * tauxEcarte)} % des etablissements en perimetre sont ecartes du maillage.` +
        '\n  Autant de zones potentiellement jamais interrogees. Reprendre ingest:geocode' +
        '\n  avant de balayer, sinon le trou restera invisible.',
    )
  }

  const cellules = planifierCellules(source.points, MAILLAGE)
  afficherPlan(cellules, source.points.length)

  console.log('\nPOINTS PAR COMMUNE')
  for (const [code, n] of [...source.parCommune].sort((a, b) => b[1] - a[1])) {
    ligne(NOM_COMMUNE[code] ?? code, nb(n))
  }

  const appels = afficherCout(cellules)

  if (appels > BALAYAGE.appelsMax) {
    console.log(
      `\n!!! AVERTISSEMENT — le plan demande ${nb(appels)} appels, au-dela du plafond de ` +
        `${nb(BALAYAGE.appelsMax)}.\n` +
        `    Le quota mensuel gratuit est de ${nb(QUOTA_MENSUEL_GRATUIT)} appels et les cellules\n` +
        '    tronquees se subdivisent : le balayage consommera davantage que ce chiffre.\n' +
        '    Retravailler MAILLAGE (cible, rayonMax) ou reduire le perimetre avant de balayer.',
    )
    if (ecrire) {
      throw new Error(
        'ecriture refusee : un plan au-dessus du plafond ne doit pas devenir executable.',
      )
    }
  }

  if (ecrire) await ecrirePlan(cellules)
  else console.log('\nDry-run : rien n a ete ecrit. Relancer avec --write pour enregistrer le plan.')

  process.exit(0)
}

main().catch((e) => {
  console.error(`\nplan:cells a echoue — ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
