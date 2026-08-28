/**
 * Recalcule le profil de rythme de TOUS les établissements à partir des horaires brutes
 * déjà stockées.
 *
 *   node --env-file=.env.local --import tsx scripts/compute-profiles.ts [--verifier]
 *
 * AUCUN appel réseau. C'est le script qu'on rejoue à volonté quand on ajuste les règles
 * d'inférence, sans redépenser un centime de quota Google — d'où l'absence de `--dry-run` :
 * il n'y a rien à protéger ici.
 *
 * `--verifier` n'écrit rien : il compare le profil recalculé au profil stocké et liste les
 * divergences. C'est ce qui permet de mesurer l'effet d'un changement de règle AVANT de
 * l'appliquer à la base.
 *
 * Voir .specs/technique/05-inference-des-horaires.md et 06-pipeline-ingestion.md (étape 6).
 */
import { eq } from 'drizzle-orm'
import { deduireCategorie } from '../lib/categorie'
import { calculerProfil, parserHoraires } from '../lib/horaires'
import type { Categorie, Fenetre, Fiabilite, GoogleHoraires, Profil, RisqueCoupure } from '../lib/horaires'
import { colonnesProfil } from '../lib/profil-colonnes'
import { db } from '../lib/db/client'
import { restaurant } from '../lib/db/schema'

type Ligne = typeof restaurant.$inferSelect

const ORDRE_RISQUE: RisqueCoupure[] = ['aucun', 'faible', 'moyen', 'eleve', 'inconnu']
const ORDRE_FIABILITE: Fiabilite[] = ['confirme', 'probable', 'a_verifier']

/** Nombre d'établissements détaillés dans le rapport de divergences avant repli sur un total. */
const MAX_DETAIL = 40

/** Les mises à jour partent par lots : 6 000 UPDATE d'affilée sur une connexion, c'est long. */
const TAILLE_LOT = 100

interface Recalcul {
  ligne: Ligne
  categorie: Categorie
  fenetres: Fenetre[]
  profil: Profil
}

/**
 * `autre` veut dire « aucun indice », pas « c'est autre chose » : une déduction muette ne
 * doit jamais effacer une catégorie déjà connue.
 */
function choisirCategorie(ligne: Ligne): Categorie {
  const deduite = deduireCategorie({
    types: ligne.googleTypes,
    naf: ligne.nafCode,
    nom: ligne.name,
  })
  return deduite === 'autre' ? ligne.categorie : deduite
}

function recalculer(ligne: Ligne): Recalcul {
  const fenetres = parserHoraires(ligne.rawOpeningHours as GoogleHoraires | null)
  const categorie = choisirCategorie(ligne)
  const profil = calculerProfil({ fenetres, codeEffectif: ligne.effectifCode, categorie })
  return { ligne, categorie, fenetres, profil }
}

/**
 * Les colonnes que ce script possède. Tout le reste de la ligne lui est étranger.
 * `categorie` s'ajoute au tronc commun : elle n'est pas dérivée du profil, mais elle
 * lui sert d'entrée — la stocker autrement que ce qui a servi au calcul afficherait
 * un verdict sous une étiquette qui le contredit.
 */
function colonnesEcrites(r: Recalcul) {
  return { categorie: r.categorie, ...colonnesProfil(r.fenetres, r.profil) }
}

interface Divergence {
  colonne: string
  avant: unknown
  apres: unknown
}

/**
 * Forme canonique pour la comparaison. Le tri des clés n'est pas cosmétique : Postgres
 * relit un `jsonb` dans SON ordre de clés, pas celui de l'écriture — `schedule` reviendrait
 * divergent à chaque exécution alors que rien n'a bougé.
 */
function canonique(valeur: unknown): string {
  const trier = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(trier)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(o).sort().map((cle) => [cle, trier(o[cle])]))
    }
    return v
  }
  return JSON.stringify(trier(valeur ?? null))
}

function divergences(r: Recalcul): Divergence[] {
  const stocke = r.ligne as unknown as Record<string, unknown>
  const trouvees: Divergence[] = []

  for (const [colonne, apres] of Object.entries(colonnesEcrites(r))) {
    const avant = stocke[colonne]
    if (canonique(avant) !== canonique(apres)) trouvees.push({ colonne, avant, apres })
  }
  return trouvees
}

// ─────────────────────────────────────────────────────────────
// Affichage
// ─────────────────────────────────────────────────────────────

function bref(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '∅'
  const texte = typeof valeur === 'string' ? valeur : canonique(valeur)
  return texte.length > 70 ? `${texte.slice(0, 67)}…` : texte
}

function afficherRepartition(titre: string, valeurs: string[], ordre: string[]): void {
  const total = valeurs.length
  const compte = new Map<string, number>()
  for (const v of valeurs) compte.set(v, (compte.get(v) ?? 0) + 1)

  const cles = [...ordre.filter((c) => compte.has(c)), ...[...compte.keys()].filter((c) => !ordre.includes(c))]

  console.log(`\n${titre}`)
  for (const cle of cles) {
    const n = compte.get(cle) ?? 0
    const part = total ? ((n / total) * 100).toFixed(1).replace('.', ',') : '0,0'
    console.log(`  ${cle.padEnd(12)} ${String(n).padStart(5)}  (${part.padStart(5)} %)`)
  }
}

function afficherTransitions(titre: string, transitions: Map<string, number>): void {
  if (transitions.size === 0) return
  console.log(`\n${titre}`)
  for (const [passage, n] of [...transitions].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${passage.padEnd(26)} ${String(n).padStart(5)}`)
  }
}

/**
 * Le contrôle qualité de l'inférence : ces trois chiffres se lisent après chaque
 * exécution. Voir « Contrôles après exécution » dans 06-pipeline-ingestion.md.
 */
function afficherControleQualite(recalculs: Recalcul[]): void {
  afficherRepartition(
    'repartition du risque de coupure :',
    recalculs.map((r) => r.profil.risqueCoupure),
    ORDRE_RISQUE,
  )
  afficherRepartition(
    'repartition de la fiabilite :',
    recalculs.map((r) => r.profil.fiabilite),
    ORDRE_FIABILITE,
  )

  const sansHoraires = recalculs.filter((r) => !r.profil.aDesHoraires).length
  const part = recalculs.length ? ((sansHoraires / recalculs.length) * 100).toFixed(1).replace('.', ',') : '0,0'
  console.log(`\netablissements sans horaires : ${sansHoraires} sur ${recalculs.length} (${part} %)`)
}

// ─────────────────────────────────────────────────────────────
// Modes
// ─────────────────────────────────────────────────────────────

function verifier(recalculs: Recalcul[]): void {
  const parColonne = new Map<string, number>()
  const transitionsRisque = new Map<string, number>()
  const transitionsFiabilite = new Map<string, number>()
  const divergents: { r: Recalcul; d: Divergence[] }[] = []

  for (const r of recalculs) {
    const d = divergences(r)
    if (d.length === 0) continue
    divergents.push({ r, d })

    for (const { colonne, avant, apres } of d) {
      parColonne.set(colonne, (parColonne.get(colonne) ?? 0) + 1)
      const cle = `${String(avant)} -> ${String(apres)}`
      if (colonne === 'coupureRisk') transitionsRisque.set(cle, (transitionsRisque.get(cle) ?? 0) + 1)
      if (colonne === 'fiabilite') transitionsFiabilite.set(cle, (transitionsFiabilite.get(cle) ?? 0) + 1)
    }
  }

  console.log(`\n--verifier : aucune ecriture en base.`)
  console.log(`${divergents.length} etablissement(s) divergent(s) sur ${recalculs.length}`)

  for (const { r, d } of divergents.slice(0, MAX_DETAIL)) {
    console.log(`\n  ${r.ligne.name} [${r.ligne.googlePlaceId}]`)
    for (const { colonne, avant, apres } of d) {
      console.log(`    ${colonne} : ${bref(avant)}  ->  ${bref(apres)}`)
    }
  }
  if (divergents.length > MAX_DETAIL) {
    console.log(`\n  … et ${divergents.length - MAX_DETAIL} autre(s) etablissement(s) non detaille(s)`)
  }

  if (parColonne.size > 0) {
    console.log('\ndivergences par colonne :')
    for (const [colonne, n] of [...parColonne].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${colonne.padEnd(24)} ${String(n).padStart(5)}`)
    }
  }
  afficherTransitions('transitions du risque de coupure :', transitionsRisque)
  afficherTransitions('transitions de la fiabilite :', transitionsFiabilite)
}

async function ecrire(recalculs: Recalcul[]): Promise<void> {
  const modifies = recalculs.filter((r) => divergences(r).length > 0).length
  const maintenant = new Date()

  // On réécrit TOUTES les lignes, y compris inchangées : `profile_computed_at` doit dater
  // le dernier calcul, pas la dernière modification — sinon on ne sait plus si une ligne
  // a été passée au crible ou simplement oubliée.
  for (let i = 0; i < recalculs.length; i += TAILLE_LOT) {
    const lot = recalculs.slice(i, i + TAILLE_LOT)
    await Promise.all(
      lot.map((r) =>
        db
          .update(restaurant)
          .set({ ...colonnesEcrites(r), profileComputedAt: maintenant })
          .where(eq(restaurant.id, r.ligne.id)),
      ),
    )
  }

  console.log(`\n${recalculs.length} profil(s) ecrit(s), dont ${modifies} reellement modifie(s)`)
}

// ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const modeVerification = args.includes('--verifier')
  const inconnus = args.filter((a) => a !== '--verifier')
  if (inconnus.length > 0) {
    console.error(`Option inconnue : ${inconnus.join(', ')}`)
    console.error('Usage : node --env-file=.env.local --import tsx scripts/compute-profiles.ts [--verifier]')
    process.exit(1)
  }

  const lignes = await db.select().from(restaurant)
  console.log(`${lignes.length} etablissement(s) lu(s)`)
  if (lignes.length === 0) {
    console.error('Base vide — lancer `npm run seed` ou le pipeline d ingestion avant.')
    process.exit(1)
  }

  // On calcule TOUT avant d'écrire quoi que ce soit : une horaire brute malformée doit
  // faire échouer le script en entier, pas laisser la base à moitié recalculée.
  const recalculs: Recalcul[] = []
  const echecs: string[] = []
  for (const ligne of lignes) {
    try {
      recalculs.push(recalculer(ligne))
    } catch (e) {
      echecs.push(`  ${ligne.name} [${ligne.googlePlaceId}] : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (echecs.length > 0) {
    console.error(`\n${echecs.length} etablissement(s) impossible(s) a traiter — rien n a ete ecrit :`)
    console.error(echecs.join('\n'))
    process.exit(1)
  }

  if (modeVerification) verifier(recalculs)
  else await ecrire(recalculs)

  afficherControleQualite(recalculs)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
