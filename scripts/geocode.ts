/**
 * Géocodage des adresses SIRENE via la Base Adresse Nationale.
 *
 * SIRENE donne des adresses, jamais des coordonnées. Or c'est la position qui
 * pilote le maillage du balayage, donc le seul poste coûteux du projet.
 * La BAN est gratuite et sans clé : aucune raison d'y mettre du Google.
 *
 * Reprise : seules les lignes sans `lat` sont envoyées. Une interruption se
 * rejoue sans redemander ce qui est déjà connu.
 */
import { and, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { sirene } from '../lib/db/schema'
import { BAN_CSV, MAILLAGE } from '../lib/config'

/** La BAN accepte de gros fichiers, mais c'est un service public : on reste raisonnable. */
const TAILLE_LOT = 2000
const PAUSE_MS = 1000
const TENTATIVES_MAX = 3

interface Ligne {
  siret: string
  adresse: string
  codePostal: string | null
}

interface Resultat {
  siret: string
  lat: number
  lng: number
  score: number
}

/**
 * SIRENE remplace par « [ND] » les champs des etablissements non diffusibles.
 * Ce n'est pas une adresse incomplete : il n'y a rien a chercher, et les
 * renvoyer a la BAN a chaque execution ne ferait que gonfler les non-trouvees.
 */
const ADRESSE_CHERCHABLE = sql`coalesce(${sirene.adresse}, '') <> '' and ${sirene.adresse} not like '%[ND]%'`
const ADRESSE_ABSENTE = sql`coalesce(${sirene.adresse}, '') = '' or ${sirene.adresse} like '%[ND]%'`

function champCsv(valeur: string | null): string {
  return `"${(valeur ?? '').replace(/"/g, '""')}"`
}

/** Un « [ND] » envoyé tel quel ferait chercher cette chaîne à la BAN. Mieux vaut un champ vide. */
function sansNd(valeur: string | null): string | null {
  return valeur?.includes('[ND]') ? null : valeur
}

function versCsv(lignes: Ligne[]): string {
  const corps = lignes.map((l) =>
    [champCsv(l.siret), champCsv(sansNd(l.adresse)), champCsv(sansNd(l.codePostal))].join(','),
  )
  return ['siret,adresse,code_postal', ...corps].join('\n')
}

/** Analyseur CSV minimal, mais qui gère les guillemets : les raisons sociales en contiennent. */
function lireCsv(texte: string, separateur: string): string[][] {
  const lignes: string[][] = []
  let ligne: string[] = []
  let champ = ''
  let entreGuillemets = false

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c !== '"') champ += c
      else if (texte[i + 1] === '"') { champ += '"'; i++ }
      else entreGuillemets = false
    } else if (c === '"') entreGuillemets = true
    else if (c === separateur) { ligne.push(champ); champ = '' }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = '' }
    else if (c !== '\r') champ += c
  }
  if (champ !== '' || ligne.length > 0) { ligne.push(champ); lignes.push(ligne) }
  return lignes
}

async function appelerBan(lot: Ligne[]): Promise<string> {
  const fichier = new Blob([versCsv(lot)], { type: 'text/csv' })

  for (let tentative = 1; ; tentative++) {
    const formulaire = new FormData()
    formulaire.append('data', fichier, 'adresses.csv')
    formulaire.append('columns', 'adresse')
    formulaire.append('postcode', 'code_postal')

    try {
      const reponse = await fetch(BAN_CSV, {
        method: 'POST',
        body: formulaire,
        signal: AbortSignal.timeout(180_000),
      })
      if (reponse.ok) return await reponse.text()

      const detail = (await reponse.text()).slice(0, 500)
      if (tentative >= TENTATIVES_MAX) {
        throw new Error(`BAN a repondu ${reponse.status} apres ${tentative} tentatives : ${detail}`)
      }
      console.warn(`  BAN ${reponse.status}, nouvelle tentative (${tentative}/${TENTATIVES_MAX})`)
    } catch (e) {
      if (tentative >= TENTATIVES_MAX) throw e
      console.warn(`  echec reseau (${(e as Error).message}), nouvelle tentative (${tentative}/${TENTATIVES_MAX})`)
    }
    await pause(PAUSE_MS * 5 * tentative)
  }
}

function extraireResultats(csv: string): Resultat[] {
  const separateur = (csv.split('\n', 1)[0].match(/;/g)?.length ?? 0) >
    (csv.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const lignes = lireCsv(csv, separateur)
  if (lignes.length === 0) throw new Error('BAN a renvoye un fichier vide')

  const entete = lignes[0]
  const col = (nom: string) => {
    const i = entete.indexOf(nom)
    if (i < 0) throw new Error(`colonne "${nom}" absente de la reponse BAN — entete : ${entete.join('|')}`)
    return i
  }
  const iSiret = col('siret')
  const iLat = col('latitude')
  const iLng = col('longitude')
  const iScore = col('result_score')

  const resultats: Resultat[] = []
  for (const ligne of lignes.slice(1)) {
    if (ligne.length <= iScore) continue // ligne tronquée : rien à en tirer
    const lat = Number(ligne[iLat])
    const lng = Number(ligne[iLng])
    // Adresse non trouvée : latitude vide. Ce n'est pas une erreur, la ligne repassera.
    if (!ligne[iLat] || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    resultats.push({ siret: ligne[iSiret], lat, lng, score: Number(ligne[iScore]) || 0 })
  }
  return resultats
}

/** Un seul aller-retour par lot : 2 000 UPDATE unitaires ne se justifient pas. */
async function ecrire(resultats: Resultat[]): Promise<void> {
  if (resultats.length === 0) return
  const valeurs = resultats.map((r) =>
    sql`(${r.siret}::text, ${r.lat}::double precision, ${r.lng}::double precision, ${r.score}::real)`,
  )
  await db.execute(sql`
    update ${sirene} as s
       set lat = v.lat, lng = v.lng, geocode_score = v.score
      from (values ${sql.join(valeurs, sql`, `)}) as v(siret, lat, lng, score)
     where s.siret = v.siret
  `)
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  // Un registre vide n'est pas « rien à faire » : c'est le script précédent qui manque.
  if (await db.$count(sirene) === 0) {
    throw new Error('table sirene_etablissement vide — lancer ingest:sirene avant le geocodage')
  }

  const sansAdresse = await db.$count(sirene, and(isNull(sirene.lat), ADRESSE_ABSENTE))

  const aTraiter = await db
    .select({ siret: sirene.siret, adresse: sirene.adresse, codePostal: sirene.codePostal })
    .from(sirene)
    .where(and(isNull(sirene.lat), ADRESSE_CHERCHABLE))

  if (sansAdresse > 0) {
    console.log(`${sansAdresse} etablissements sans adresse exploitable (non diffusibles) :`)
    console.log('  ingeocodables par nature, ils ne serviront pas au maillage')
  }
  if (aTraiter.length === 0) {
    console.log('rien a geocoder — toutes les lignes SIRENE avec adresse ont deja un point')
    return
  }

  const nbLots = Math.ceil(aTraiter.length / TAILLE_LOT)
  console.log(`${aTraiter.length} adresses a geocoder, ${nbLots} lot(s) de ${TAILLE_LOT}`)

  let geocodees = 0
  let fiables = 0

  for (let i = 0; i < nbLots; i++) {
    const lot = aTraiter.slice(i * TAILLE_LOT, (i + 1) * TAILLE_LOT) as Ligne[]
    const resultats = extraireResultats(await appelerBan(lot))
    await ecrire(resultats)

    geocodees += resultats.length
    fiables += resultats.filter((r) => r.score >= MAILLAGE.scoreGeocodeMin).length
    console.log(`  lot ${i + 1}/${nbLots} : ${resultats.length}/${lot.length} positionnees`)

    if (i < nbLots - 1) await pause(PAUSE_MS)
  }

  const pct = (n: number) => `${((n / aTraiter.length) * 100).toFixed(1)} %`
  console.log(`\nadresses traitees   : ${aTraiter.length}`)
  console.log(`geocodees           : ${geocodees} (${pct(geocodees)})`)
  console.log(`score >= ${MAILLAGE.scoreGeocodeMin}        : ${fiables} (${pct(fiables)}) — seules celles-ci serviront au maillage`)

  const faibles = geocodees - fiables
  if (faibles > 0) {
    console.log(`score faible        : ${faibles} — points conserves, ecartes du maillage`)
  }
  if (geocodees < aTraiter.length) {
    console.log(`non trouvees        : ${aTraiter.length - geocodees} — relancer le script les representera`)
  }

  // Après une reprise, les chiffres ci-dessus ne couvrent que le reliquat.
  // C'est ce total qui se compare aux ~90 % attendus.
  const total = await db.$count(sirene)
  const exploitables = await db.$count(sirene, gte(sirene.geocodeScore, MAILLAGE.scoreGeocodeMin))
  console.log(`\nregistre complet    : ${exploitables}/${total} exploitables pour le maillage ` +
    `(${((exploitables / total) * 100).toFixed(1)} %)`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
