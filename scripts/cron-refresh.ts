/**
 * cron:refresh — étape 7 du pipeline : le rafraîchissement mensuel.
 *
 * Enchaîne `plan:cells`, `sweep:google`, `match:sirene` et `compute:profiles`.
 * `ingest:sirene` et `ingest:geocode` n'y sont pas : le registre d'entreprises évolue
 * lentement, une réexécution trimestrielle suffit (spec 06).
 *
 * C'est ce script que déclenche .github/workflows/balayage.yml le 1er du mois. Le calage
 * au 1er garantit que le remplacement précède l'expiration des 30 jours des CGU (D7).
 *
 * IL CONSOMME DU QUOTA, par `sweep:google` interposé : `--dry-run` est donc son mode par
 * défaut, et `--go` la seule façon de dépenser. En dry-run il n'exécute QUE les deux
 * étapes qui savent ne rien écrire — le plan et le balayage à blanc.
 *
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts        # rien n'est dépensé
 *   node --env-file=.env.local --import tsx scripts/cron-refresh.ts --go   # dépense réellement
 *
 * Chaque étape garde ses propres garde-fous : ils sont dans les scripts, pas ici. En
 * particulier, `sweep:google` refuse de rejouer un balayage réussi depuis moins de
 * BALAYAGE.joursEntreBalayages jours — un déclenchement manuel en cours de mois ne
 * dépensera rien.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DOSSIER_SCRIPTS = dirname(fileURLToPath(import.meta.url))

interface Etape {
  nom: string
  fichier: string
  /** Arguments en mode réel. */
  args: string[]
  /**
   * Arguments en dry-run, ou `null` si l'étape n'a pas de mode sans écriture : elle est
   * alors sautée. On ne fait pas semblant d'apparier sur une base qu'on n'a pas balayée.
   */
  argsDryRun: string[] | null
}

const ETAPES: Etape[] = [
  // Seule étape jouable à blanc, et la seule qui compte pour le budget : le nombre de
  // cellules qu'elle annonce EST le nombre d'appels que le balayage consommera.
  { nom: 'plan:cells', fichier: 'plan-cells.ts', args: ['--write'], argsDryRun: [] },
  // Le dry-run de `sweep` lit le plan en base ; en dry-run le plan n'y est justement pas
  // écrit. L'appeler quand même le ferait échouer sur « aucune cellule à faire », un échec
  // qui ne dirait rien du balayage réel.
  { nom: 'sweep:google', fichier: 'sweep.ts', args: ['--go'], argsDryRun: null },
  { nom: 'match:sirene', fichier: 'match-sirene.ts', args: [], argsDryRun: null },
  { nom: 'compute:profiles', fichier: 'compute-profiles.ts', args: [], argsDryRun: null },
]

/**
 * Chaque étape tourne dans son propre processus : c'est ce qui garantit qu'elle applique
 * bien ses garde-fous et son code de sortie, au lieu d'être court-circuitée par un appel
 * de fonction depuis ici. `--import tsx` et pas `npm run` : les scripts de package.json
 * embarquent `--env-file=.env.local`, qui n'existe pas en CI.
 */
function lancer(etape: Etape, args: string[]): void {
  const chemin = join(DOSSIER_SCRIPTS, etape.fichier)
  console.log(`\n=== ${etape.nom} ${args.join(' ')} ===\n`)

  const resultat = spawnSync(process.execPath, ['--import', 'tsx', chemin, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  if (resultat.error) {
    throw new Error(`${etape.nom} n'a pas pu démarrer : ${resultat.error.message}`)
  }
  if (resultat.signal) {
    throw new Error(`${etape.nom} a été interrompu par le signal ${resultat.signal}`)
  }
  if (resultat.status !== 0) {
    // Le cycle s'arrête net. Enchaîner sur `match:sirene` après un balayage incomplet
    // apparierait une base amputée et afficherait un canari rassurant pour de mauvaises
    // raisons — exactement le défaut qui ne se voit pas dans l'interface.
    throw new Error(`${etape.nom} a échoué (code ${resultat.status}) — cycle interrompu`)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const inconnus = args.filter((a) => !['--go', '--dry-run'].includes(a))
  if (inconnus.length > 0) {
    console.error(`Options inconnues : ${inconnus.join(' ')}. Attendu : --go, --dry-run`)
    process.exit(1)
  }
  const go = args.includes('--go')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL manquante — voir .specs/technique/08-infrastructure.md')
    process.exit(1)
  }
  // Vérifiée ici plutôt qu'au milieu du cycle : découvrir la clé absente APRÈS avoir
  // écrit un plan laisserait des cellules « a_faire » derrière soi.
  if (go && !process.env.GOOGLE_PLACES_API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY manquante — voir .specs/technique/08-infrastructure.md')
    process.exit(1)
  }

  console.log(go
    ? 'RAFRAÎCHISSEMENT MENSUEL — MODE RÉEL, le balayage va dépenser du quota Google'
    : 'RAFRAÎCHISSEMENT MENSUEL — DRY-RUN, aucun appel émis, rien écrit (ajouter --go pour dépenser)')

  const debut = Date.now()

  for (const etape of ETAPES) {
    const args_ = go ? etape.args : etape.argsDryRun
    if (args_ === null) {
      console.log(`\n=== ${etape.nom} — non jouée en dry-run ===`)
      continue
    }
    lancer(etape, args_)
  }

  const minutes = ((Date.now() - debut) / 60_000).toFixed(1)
  console.log(go
    ? `\nCycle mensuel terminé en ${minutes} min. À contrôler : console de facturation ` +
      '(consommation Enterprise ≈ nombre de cellules, RIEN sur le palier Atmosphere), ' +
      'troncatures non résolues, taux de non-appariement SIRENE.'
    : `\nDry-run terminé en ${minutes} min. Rien n'a été dépensé ni écrit.\n` +
      "Le nombre de cellules annoncé ci-dessus est le nombre d'appels que --go consommerait.")
}

try {
  main()
  process.exit(0)
} catch (e) {
  console.error(`\nCYCLE MENSUEL EN ÉCHEC — ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
