/**
 * Appariement Google <-> SIRENE (étape 5 du pipeline).
 *
 * Google donne les horaires, SIRENE donne la tranche d'effectifs. Sans cette dernière,
 * l'inférence de coupure n'a plus de pivot : un établissement ouvert midi ET soir est
 * signalé comme coupure quelle que soit la taille de l'équipe (D4).
 *
 * Deux critères combinés — proximité sous 75 m ET similarité de nom après normalisation.
 * En dessous du seuil on laisse l'effectif VIDE : un effectif attribué au mauvais
 * établissement produit un verdict de coupure faux, que l'utilisateur ne peut pas
 * détecter. Une information manquante, elle, s'affiche comme telle.
 *
 * Gratuit et rejouable : aucun appel réseau, aucun quota consommé.
 *
 *   node --env-file=.env.local --import tsx scripts/match-sirene.ts [--dry-run] [--seuil=0.45]
 */
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { restaurant, sweepRun } from '../lib/db/schema'
import { NOM_COMMUNE } from '../lib/config'
import { calculerProfil, parserHoraires, tailleEquipe } from '../lib/horaires'
import type { Categorie, GoogleHoraires } from '../lib/horaires'
import { colonnesProfil } from '../lib/profil-colonnes'

/** Rayon d'appariement, en mètres. Au-delà, deux établissements sont voisins, pas identiques. */
const DISTANCE_MAX = 75

/**
 * Seuil de similarité trigramme. Réglable — c'est le seul nombre de ce script qui
 * demandera un calibrage sur données réelles, d'où `--seuil`.
 * Trop bas, on attribue des effectifs faux ; trop haut, on perd des appariements
 * légitimes et le filtre de coupure retombe sur son mode dégradé.
 */
const SEUIL_DEFAUT = 0.45

/** Mots vides du domaine : présents partout, donc discriminants nulle part. */
const MOTS_VIDES = [
  'restaurant', 'le', 'la', 'les', 'chez', 'aux', 'du', 'de', 'brasserie', 'bar', 'cafe',
]

/**
 * Un nom que la normalisation réduit à moins de 3 caractères ne discrimine plus rien
 * (« Le Bar » devient vide) : on préfère ne pas apparier.
 */
const LONGUEUR_NOM_MIN = 3

const METRES_PAR_DEGRE_LAT = 110574
const METRES_PAR_DEGRE_LNG = 111320

/** Au-delà de ce multiple du taux global, une commune n'est plus du bruit statistique. */
const FACTEUR_CONCENTRATION = 1.5
const NON_APPARIES_SIGNIFICATIFS = 20

const LOT = 500

/**
 * Normalisation des noms, en SQL pour que `similarity()` compare deux chaînes préparées
 * de la même façon. Écrite une fois et appliquée aux DEUX côtés : une divergence entre
 * les deux normalisations ferait chuter le taux d'appariement sans le moindre message.
 *
 * `unaccent` n'est pas installée (seule `pg_trgm` l'est), d'où le `translate` explicite.
 * Les ligatures passent avant, parce qu'elles se déplient en deux lettres.
 */
function nomNormalise(colonne: string): string {
  return `btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(replace(replace(lower(${colonne}), 'œ', 'oe'), 'æ', 'ae'),
                  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                  'aaaaaaceeeeiiiinooooouuuuyy'),
        '[^a-z0-9]+', ' ', 'g'),
      '\\y(${MOTS_VIDES.join('|')})\\y', ' ', 'g'),
    '\\s+', ' ', 'g'))`
}

interface Candidat {
  restaurant_id: string
  google_place_id: string
  siret: string
  effectif_code: string | null
  naf: string | null
  score: number
  distance: number
}

/**
 * Tous les couples plausibles, en une requête.
 *
 * Présélection par rectangle englobant sur lat/lng avant tout calcul de distance :
 * il n'y a pas de PostGIS (D12) et l'index `sirene_position` fait le travail.
 * Le rectangle est légèrement plus large que le disque de 75 m ; le filtre final sur
 * la distance réelle rattrape les coins.
 */
/**
 * `similarity()` vient de `pg_trgm`, qui s'active à la main sur Supabase (spec 08).
 * Sans ce contrôle, l'échec arrive sous la forme d'un « function similarity(text, text)
 * does not exist » au milieu d'une requête de 40 lignes — vrai, mais illisible.
 */
async function verifierPgTrgm(): Promise<void> {
  const [presente] = (await db.execute(
    sql`SELECT count(*) > 0 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`,
  )) as unknown as { ok: boolean }[]

  if (!presente?.ok) {
    throw new Error(
      "l'extension pg_trgm n'est pas installee sur cette base — l'appariement de noms en depend.\n"
      + '  Activer avec : CREATE EXTENSION IF NOT EXISTS pg_trgm;\n'
      + '  Voir .specs/technique/08-infrastructure.md',
    )
  }
}

async function chercherCandidats(seuil: number): Promise<Candidat[]> {
  const deltaLat = DISTANCE_MAX / METRES_PAR_DEGRE_LAT

  const lignes = await db.execute(sql`
    WITH google AS (
      SELECT r.id, r.google_place_id, r.lat, r.lng,
             ${sql.raw(nomNormalise('r.name'))} AS nom_norm
      FROM restaurant r
    ), registre AS (
      SELECT s.siret, s.effectif_code, s.naf, s.lat, s.lng,
             ${sql.raw(nomNormalise('s.nom'))} AS nom_norm
      FROM sirene_etablissement s
      WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
    ), candidats AS (
      SELECT g.id AS restaurant_id,
             g.google_place_id,
             s.siret,
             s.effectif_code,
             s.naf,
             similarity(g.nom_norm, s.nom_norm) AS score,
             sqrt(
               power((s.lat - g.lat) * ${METRES_PAR_DEGRE_LAT}, 2) +
               power((s.lng - g.lng) * ${METRES_PAR_DEGRE_LNG} * cos(radians(g.lat)), 2)
             ) AS distance
      FROM google g
      JOIN registre s
        ON s.lat BETWEEN g.lat - ${deltaLat} AND g.lat + ${deltaLat}
       AND s.lng BETWEEN g.lng - (${DISTANCE_MAX} / (${METRES_PAR_DEGRE_LNG} * cos(radians(g.lat))))
                     AND g.lng + (${DISTANCE_MAX} / (${METRES_PAR_DEGRE_LNG} * cos(radians(g.lat))))
      WHERE length(g.nom_norm) >= ${LONGUEUR_NOM_MIN}
        AND length(s.nom_norm) >= ${LONGUEUR_NOM_MIN}
        AND similarity(g.nom_norm, s.nom_norm) >= ${seuil}
    )
    SELECT restaurant_id::text AS restaurant_id,
           google_place_id, siret, effectif_code, naf, score, distance
    FROM candidats
    WHERE distance <= ${DISTANCE_MAX}
    ORDER BY score DESC, distance ASC
  `)

  return lignes as unknown as Candidat[]
}

/**
 * Attribution gloutonne, meilleur score d'abord : un établissement Google et un
 * enregistrement SIRENE ne servent qu'une fois. Sans cette exclusivité, un même SIRENE
 * serait consommé par plusieurs fiches Google et le compte de non-appariés — le canari —
 * serait faussé dans le sens rassurant.
 *
 * Le score prime sur la distance : à moins de 75 m, c'est le nom qui discrimine.
 */
function attribuer(candidats: Candidat[]): Map<string, Candidat> {
  const retenus = new Map<string, Candidat>()
  const siretsPris = new Set<string>()

  for (const c of candidats) {
    if (retenus.has(c.restaurant_id) || siretsPris.has(c.siret)) continue
    retenus.set(c.restaurant_id, c)
    siretsPris.add(c.siret)
  }

  return retenus
}

function parLots<T>(items: T[], taille: number): T[][] {
  const lots: T[][] = []
  for (let i = 0; i < items.length; i += taille) lots.push(items.slice(i, i + taille))
  return lots
}

/**
 * Écrit l'appariement, après avoir effacé le précédent.
 *
 * La remise à zéro est délibérée : le résultat doit dépendre du seul état courant des
 * deux tables, jamais d'une exécution passée. Un SIRENE radié ou un seuil resserré
 * doivent défaire un appariement, pas le laisser traîner.
 */
async function appliquer(retenus: Map<string, Candidat>): Promise<void> {
  const couples = [...retenus.entries()]

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE restaurant
      SET siret = NULL, naf_code = NULL, effectif_code = NULL, match_score = NULL
    `)
    await tx.execute(sql`
      UPDATE sirene_etablissement SET google_place_id = NULL WHERE google_place_id IS NOT NULL
    `)

    for (const lot of parLots(couples, LOT)) {
      // Chaque valeur est castée : dans un VALUES, un NULL sans type laisse Postgres
      // incapable de deviner la colonne.
      const valeurs = lot.map(([id, c]) => sql`(
        ${id}::uuid, ${c.siret}::text, ${c.naf}::text, ${c.effectif_code}::text, ${c.score}::real
      )`)
      await tx.execute(sql`
        UPDATE restaurant AS r
        SET siret = v.siret, naf_code = v.naf, effectif_code = v.effectif, match_score = v.score
        FROM (VALUES ${sql.join(valeurs, sql`, `)}) AS v(id, siret, naf, effectif, score)
        WHERE r.id = v.id
      `)

      const liens = lot.map(([, c]) => sql`(${c.siret}::text, ${c.google_place_id}::text)`)
      await tx.execute(sql`
        UPDATE sirene_etablissement AS s
        SET google_place_id = v.place_id
        FROM (VALUES ${sql.join(liens, sql`, `)}) AS v(siret, place_id)
        WHERE s.siret = v.siret
      `)
    }
  })
}

interface LigneResto {
  id: string
  effectifCode: string | null
  categorie: Categorie
  rawOpeningHours: unknown
}

/**
 * Recalcule les profils des seuls établissements dont l'effectif vient de changer.
 * Le verdict de coupure croise horaires ET effectif : un effectif qui bouge invalide
 * le profil calculé avant lui.
 */
async function recalculerProfils(
  lignes: LigneResto[],
  effectifs: Map<string, string | null>,
): Promise<void> {
  const maintenant = new Date()

  await db.transaction(async (tx) => {
    for (const l of lignes) {
      const fenetres = parserHoraires(l.rawOpeningHours as GoogleHoraires | null)
      const profil = calculerProfil({
        fenetres,
        codeEffectif: effectifs.get(l.id) ?? null,
        categorie: l.categorie,
      })

      await tx.update(restaurant)
        .set({ ...colonnesProfil(fenetres, profil), profileComputedAt: maintenant })
        .where(eq(restaurant.id, l.id))
    }
  })
}

const pct = (n: number, total: number): string =>
  total === 0 ? '-' : `${((n / total) * 100).toFixed(1)} %`

/** L'effectif n'est exploitable que s'il se traduit en taille d'équipe : `NN` ne dit rien. */
const effectifExploitable = (code: string | null): boolean => tailleEquipe(code) !== 'inconnu'

interface LigneSirene {
  siret: string
  code_commune: string
  geocode: boolean
}

/**
 * Le canari du balayage. Les non-appariés se répartissent normalement de façon diffuse ;
 * une commune qui décroche signale une zone que le balayage Google a manquée — c'est le
 * seul défaut qui ne se voit pas dans l'interface, puisqu'un établissement absent
 * n'affiche rien.
 *
 * On raisonne en TAUX et pas en volume : un compte brut ne ferait que classer les
 * communes par taille.
 */
function afficherCanari(registre: LigneSirene[], siretsApparies: Set<string>): number {
  const geocodes = registre.filter((s) => s.geocode)
  const sansPosition = registre.length - geocodes.length
  const nonApparies = geocodes.filter((s) => !siretsApparies.has(s.siret))
  const tauxGlobal = geocodes.length === 0 ? 0 : nonApparies.length / geocodes.length

  console.log('')
  console.log(`SIRENE non apparies : ${nonApparies.length} sur ${geocodes.length} geocodes `
    + `(${pct(nonApparies.length, geocodes.length)})`)
  if (sansPosition > 0) {
    console.log(`  + ${sansPosition} sans coordonnees, hors appariement possible `
      + `— relancer ingest:geocode si le chiffre surprend`)
  }

  const parCommune = new Map<string, { total: number; manquants: number }>()
  for (const s of geocodes) {
    const e = parCommune.get(s.code_commune) ?? { total: 0, manquants: 0 }
    e.total += 1
    if (!siretsApparies.has(s.siret)) e.manquants += 1
    parCommune.set(s.code_commune, e)
  }

  const rangs = [...parCommune.entries()]
    .map(([code, e]) => ({
      libelle: NOM_COMMUNE[code] ?? code,
      ...e,
      taux: e.total === 0 ? 0 : e.manquants / e.total,
    }))
    .sort((a, b) => b.taux - a.taux)

  console.log('  repartition par commune (taux de non-appariement) :')
  for (const r of rangs) {
    const suspect = r.manquants >= NON_APPARIES_SIGNIFICATIFS
      && r.taux > tauxGlobal * FACTEUR_CONCENTRATION
    console.log(
      `    ${r.libelle.padEnd(14)} ${String(r.manquants).padStart(5)} / ${String(r.total).padStart(5)}`
      + `  ${pct(r.manquants, r.total).padStart(7)}`
      + (suspect ? '   <-- concentration, zone probablement manquee par le balayage' : ''),
    )
  }

  return nonApparies.length
}

/**
 * Le canari se relit après coup, à côté du balayage qui l'a produit : la colonne
 * `sirene_unmatched` existe pour ça et n'était écrite par personne. Sans elle, comparer
 * deux balayages successifs suppose de retrouver la sortie console du bon soir.
 */
async function consignerCanari(nonApparies: number): Promise<void> {
  const [dernier] = await db.select({ id: sweepRun.id }).from(sweepRun)
    .orderBy(desc(sweepRun.startedAt)).limit(1)
  if (!dernier) return
  await db.update(sweepRun).set({ sireneUnmatched: nonApparies }).where(eq(sweepRun.id, dernier.id))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const seuil = lireSeuil(args)

  const restaurants = await db.select({
    id: restaurant.id,
    effectifCode: restaurant.effectifCode,
    categorie: restaurant.categorie,
    rawOpeningHours: restaurant.rawOpeningHours,
  }).from(restaurant)

  const registre = (await db.execute(sql`
    SELECT siret, code_commune, (lat IS NOT NULL AND lng IS NOT NULL) AS geocode
    FROM sirene_etablissement
  `)) as unknown as LigneSirene[]

  console.log(`etablissements Google : ${restaurants.length}`)
  console.log(`enregistrements SIRENE : ${registre.length}`
    + ` (dont ${registre.filter((s) => s.geocode).length} geocodes)`)

  // Base vide : rien à apparier, et surtout rien à effacer. On sort sans écrire.
  if (restaurants.length === 0 || registre.length === 0) {
    const manque = restaurants.length === 0
      ? 'la table restaurant est vide — lancer sweep:google avant'
      : 'la table sirene_etablissement est vide — lancer ingest:sirene puis ingest:geocode avant'
    console.log(`rien a apparier : ${manque}`)
    return
  }

  if (!registre.some((s) => s.geocode)) {
    console.log('rien a apparier : aucun enregistrement SIRENE geocode — lancer ingest:geocode avant')
    return
  }

  console.log(`seuil de similarite : ${seuil}${dryRun ? '  (--dry-run : aucune ecriture)' : ''}`)

  await verifierPgTrgm()
  const candidats = await chercherCandidats(seuil)
  const retenus = attribuer(candidats)
  const siretsApparies = new Set([...retenus.values()].map((c) => c.siret))

  const effectifsAvant = new Map(restaurants.map((r) => [r.id, r.effectifCode]))
  const effectifsApres = new Map(
    restaurants.map((r) => [r.id, retenus.get(r.id)?.effectif_code ?? null]),
  )
  const changes = restaurants.filter((r) => effectifsAvant.get(r.id) !== effectifsApres.get(r.id))

  if (!dryRun) await appliquer(retenus)

  console.log('')
  console.log(`couples candidats examines : ${candidats.length}`)
  console.log(`apparies : ${retenus.size} etablissements Google sur ${restaurants.length}`
    + `  (taux d'appariement ${pct(retenus.size, restaurants.length)})`)

  const nonApparies = afficherCanari(registre, siretsApparies)
  if (!dryRun) await consignerCanari(nonApparies)

  const exploitablesAvant = restaurants.filter((r) => effectifExploitable(effectifsAvant.get(r.id) ?? null))
  const exploitablesApres = restaurants.filter((r) => effectifExploitable(effectifsApres.get(r.id) ?? null))
  const gagnes = restaurants.filter((r) =>
    effectifExploitable(effectifsApres.get(r.id) ?? null)
    && !effectifExploitable(effectifsAvant.get(r.id) ?? null))
  const apparieSansEffectif = retenus.size - exploitablesApres.length

  console.log('')
  console.log(`effectif exploitable : ${exploitablesApres.length} etablissements`
    + `  (${pct(exploitablesApres.length, restaurants.length)} de la base)`)
  console.log(`  dont ${gagnes.length} gagnes par cet appariement`
    + ` (${exploitablesAvant.length} en avaient deja un)`)
  console.log(`  ${apparieSansEffectif} apparies mais tranche non renseignee cote SIRENE :`
    + ` ils repartent sur le repli par amplitude`)

  if (dryRun) {
    console.log('')
    console.log(`--dry-run : ${changes.length} profils auraient ete recalcules, rien n'a ete ecrit`)
    return
  }

  console.log('')
  if (changes.length === 0) {
    console.log('aucun effectif modifie : profils inchanges')
  } else {
    await recalculerProfils(changes, effectifsApres)
    console.log(`profils recalcules : ${changes.length} etablissements dont l'effectif a change`)
  }
}

function lireSeuil(args: string[]): number {
  const prefixe = '--seuil='
  const arg = args.find((a) => a.startsWith(prefixe))
  if (!arg) return SEUIL_DEFAUT

  const valeur = Number(arg.slice(prefixe.length))
  if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 1) {
    throw new Error(`--seuil attend un nombre strictement entre 0 et 1, recu "${arg}"`)
  }
  return valeur
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
