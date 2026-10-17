/**
 * The line a live cycle leaves on its GitHub Actions run, green or red (D39 rule 4).
 *
 * A notice and not a warning: what it reports is there every month — the backlog, the
 * truncations waiting their turn, the cover against the ceiling, the freshness ahead — and a
 * warning every month is the monthly red one notch lower.
 */
export interface CycleFacts {
  backlog: number
  awaiting: number
  robustCost: number
  knownCost: number
  ceiling: number
  forecast: number
  horizon: Date
}

/** GitHub reads `%`, CR and LF in a workflow command's data as its own syntax. */
function escape(data: string): string {
  return data.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

/** Null outside GitHub Actions: a run by hand prints its summary, which already says it all. */
export function cycleNotice(
  facts: CycleFacts, env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.GITHUB_ACTIONS !== 'true') return null
  const message =
    `forecast ${(100 * facts.forecast).toFixed(1)}% of the records with hours usable at ` +
    `${facts.horizon.toISOString().slice(0, 16)}Z, the worst hour before the next pass · ` +
    `cover ${facts.robustCost} cells robust, ${facts.knownCost} known records, for ${facts.ceiling} calls a month · ` +
    `discovery backlog ${facts.backlog} cells · ${facts.awaiting} truncations waiting for their recovery`
  return `::notice title=Refresh cycle::${escape(message)}`
}
