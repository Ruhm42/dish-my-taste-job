/**
 * Étape 1 du pipeline : charge le registre SIRENE dans la table `sirene`.
 *
 * Le fichier stock fait 2,2 Go et on n'en garde que ~6 000 lignes. DuckDB lit le
 * Parquet à distance en ne rapatriant que les colonnes et les blocs utiles : on
 * évite le téléchargement complet, l'extraction prend quelques secondes.
 *
 * Gratuit, sans compte ni clé (D13). Rejouable autant de fois que nécessaire.
 */
import { DuckDBInstance } from '@duckdb/node-api'
import { sql } from 'drizzle-orm'
import { CODES_NAF, COMMUNES, NOM_COMMUNE, SIRENE_PARQUET } from '../lib/config'
import { db } from '../lib/db/client'
import { sirene } from '../lib/db/schema'

/**
 * En deçà de ce volume, le filtre ou l'URL du fichier stock a changé : la mesure
 * du 2026-08-28 donne 6 129 établissements sur le périmètre (D16). Charger 200
 * lignes sans broncher produirait un maillage amputé que rien ne signalerait.
 */
const MINIMUM_ATTENDU = 3000

/**
 * Postgres plafonne à 65 535 paramètres liés par requête, soit 9 colonnes × 7 281
 * lignes ici. 1 000 laisse la marge nécessaire pour ajouter une colonne un jour.
 */
const TAILLE_LOT = 1000

interface LigneSirene {
  siret: string
  siren: string | null
  nom: string | null
  naf: string | null
  effectifCode: string | null
  codeCommune: string
  commune: string | null
  adresse: string | null
  codePostal: string | null
}

/**
 * '[ND]' est la marque SIRENE des établissements non diffusibles — 282 lignes du
 * périmètre, dont l'adresse vaut littéralement '[ND] [ND] [ND]'. La garder
 * enverrait cette chaîne au géocodeur et la donnerait comme nom à l'appariement :
 * mieux vaut vide que faux.
 */
function texte(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null
  const nettoye = String(valeur).trim()
  return nettoye === '' || nettoye === '[ND]' ? null : nettoye
}

async function extraireDeSirene(): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:')
  const connexion = await instance.connect()
  try {
    // httpfs donne à DuckDB la lecture HTTP par plages d'octets : sans elle, pas
    // de Parquet distant.
    await connexion.run('INSTALL httpfs')
    await connexion.run('LOAD httpfs')

    const requete = `
      SELECT siret, siren, codeCommuneEtablissement, libelleCommuneEtablissement,
             activitePrincipaleEtablissement, trancheEffectifsEtablissement,
             enseigne1Etablissement, denominationUsuelleEtablissement,
             numeroVoieEtablissement, typeVoieEtablissement, libelleVoieEtablissement,
             codePostalEtablissement
      FROM read_parquet('${SIRENE_PARQUET}')
      WHERE codeCommuneEtablissement IN (${COMMUNES.map(() => '?').join(', ')})
        AND etatAdministratifEtablissement = 'A'
        AND activitePrincipaleEtablissement IN (${CODES_NAF.map(() => '?').join(', ')})
    `
    const resultat = await connexion.runAndReadAll(requete, [...COMMUNES, ...CODES_NAF])
    return resultat.getRowObjectsJS()
  } finally {
    connexion.closeSync()
    instance.closeSync()
  }
}

function convertir(brut: Record<string, unknown>): LigneSirene {
  const siret = texte(brut.siret)
  const codeCommune = texte(brut.codeCommuneEtablissement)
  if (!siret || !codeCommune) {
    throw new Error(`Ligne SIRENE sans siret ou sans code commune : ${JSON.stringify(brut)}`)
  }

  const effectif = texte(brut.trancheEffectifsEtablissement)

  return {
    siret,
    siren: texte(brut.siren),
    // L'enseigne est le nom d'exploitation, celui affiché sur la devanture et donc
    // celui que Google connaît. La dénomination usuelle n'est qu'un repli.
    nom: texte(brut.enseigne1Etablissement) ?? texte(brut.denominationUsuelleEtablissement),
    naf: texte(brut.activitePrincipaleEtablissement),
    // 'NN' est le code SIRENE de « non renseigné » — 65,2 % des cas. On le ramène
    // à NULL pour que les consommateurs n'aient pas à connaître cette sentinelle.
    effectifCode: effectif === 'NN' ? null : effectif,
    codeCommune,
    // Le libellé SIRENE des arrondissements ('LYON 1') diffère de celui affiché
    // dans l'application ('Lyon 1er') : on aligne sur ce dernier.
    commune: NOM_COMMUNE[codeCommune] ?? texte(brut.libelleCommuneEtablissement),
    adresse: texte([
      brut.numeroVoieEtablissement,
      brut.typeVoieEtablissement,
      brut.libelleVoieEtablissement,
    ].map(texte).filter(Boolean).join(' ')),
    codePostal: texte(brut.codePostalEtablissement),
  }
}

async function main() {
  console.log(`Extraction SIRENE : ${COMMUNES.length} communes, ${CODES_NAF.length} codes d'activité`)
  const debut = Date.now()

  const bruts = await extraireDeSirene()
  console.log(`${bruts.length} lignes extraites en ${((Date.now() - debut) / 1000).toFixed(1)} s`)

  if (bruts.length < MINIMUM_ATTENDU) {
    throw new Error(
      `Volume aberrant : ${bruts.length} lignes, ${MINIMUM_ATTENDU} attendues au minimum. ` +
      "Le filtre ou l'URL du fichier stock a changé — vérifier SIRENE_PARQUET, COMMUNES " +
      'et CODES_NAF dans lib/config.ts avant de rejouer. Rien n\'a été écrit en base.',
    )
  }

  const lignes = bruts.map(convertir)

  // Les SIRET déjà présents distinguent insertion et mise à jour, que l'upsert ne
  // renvoie pas.
  const dejaEnBase = new Set(
    (await db.select({ siret: sirene.siret }).from(sirene)).map((l) => l.siret),
  )

  for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
    await db.insert(sirene).values(lignes.slice(i, i + TAILLE_LOT)).onConflictDoUpdate({
      target: sirene.siret,
      // lat, lng et geocodeScore sont volontairement absents : le géocodage BAN
      // est une étape séparée et longue, on ne la sacrifie pas à un réimport.
      // googlePlaceId l'est pour la même raison, côté appariement.
      set: {
        siren: sql`excluded.siren`,
        nom: sql`excluded.nom`,
        naf: sql`excluded.naf`,
        effectifCode: sql`excluded.effectif_code`,
        codeCommune: sql`excluded.code_commune`,
        commune: sql`excluded.commune`,
        adresse: sql`excluded.adresse`,
        codePostal: sql`excluded.code_postal`,
        importeLe: sql`now()`,
      },
    })
  }

  const inserees = lignes.filter((l) => !dejaEnBase.has(l.siret)).length
  console.log(`${inserees} insérées, ${lignes.length - inserees} mises à jour`)

  const parCommune = new Map<string, number>()
  for (const l of lignes) parCommune.set(l.codeCommune, (parCommune.get(l.codeCommune) ?? 0) + 1)
  console.log('\nRépartition par commune :')
  for (const [code, nombre] of [...parCommune].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(NOM_COMMUNE[code] ?? code).padEnd(14)} ${String(nombre).padStart(5)}`)
  }

  const sansEffectif = lignes.filter((l) => !l.effectifCode).length
  const sansNom = lignes.filter((l) => !l.nom).length
  const sansAdresse = lignes.filter((l) => !l.adresse).length
  console.log(
    `\nEffectif non renseigné : ${sansEffectif} (${(100 * sansEffectif / lignes.length).toFixed(1)} %)` +
    ` · sans nom : ${sansNom} · sans adresse : ${sansAdresse}`,
  )

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
