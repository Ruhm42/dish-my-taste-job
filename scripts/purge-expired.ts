/**
 * Clears the opening hours whose 30-day retention has passed (D45).
 *
 *   node --env-file=.env.local --import tsx scripts/purge-expired.ts            (dry run)
 *   node --env-file=.env.local --import tsx scripts/purge-expired.ts --write    (clears)
 *
 * No Google call: it only ever removes. Dry run by default all the same, because what it
 * removes cannot be rebuilt without spending a sweep.
 *
 * Runs every day from .github/workflows/purge.yml. See lib/purge.ts for what is cleared and
 * what is kept.
 */
import { countToPurge, purgeExpiredHours } from '../lib/purge'
import { db } from '../lib/db/client'
import { errorReason } from '../lib/error-reason'

function parseArgs(args: string[]): { write: boolean } {
  const unknown = args.filter((a) => a !== '--write' && a !== '--dry-run')
  if (unknown.length > 0) {
    throw new Error(
      `unknown option: ${unknown.join(' ')} — only --dry-run (default) and --write exist`,
    )
  }
  if (args.includes('--write') && args.includes('--dry-run')) {
    throw new Error('--write and --dry-run contradict each other: pick one')
  }
  return { write: args.includes('--write') }
}

async function main() {
  const { write } = parseArgs(process.argv.slice(2))

  if (!write) {
    const n = await countToPurge(db)
    console.log(`${n} record(s) past their expiry still hold opening hours`)
    console.log('dry run: nothing written — pass --write to clear them')
    return
  }

  const n = await purgeExpiredHours(db)
  console.log(`${n} record(s) cleared of their expired opening hours`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\npurge:expired failed — ${errorReason(e)}`)
    process.exit(1)
  })
