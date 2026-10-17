/**
 * simulate:passes — the two-pass cycle played month after month on the database's own cells
 * and records, without a call and without a write (D38).
 *
 * It is how D38's ceilings are calibrated and how its acceptance criterion is checked: over
 * twelve months, with GitHub's delays drawn at random, the worst hour keeps
 * CYCLE.freshnessTarget of the records with hours, no Pacific month spends more than
 * SWEEP.maxCallsPerPeriod, and no first half more than CYCLE.firstPassCeiling. Each pass
 * picks its cells with `planPass`, the very function the sweep uses.
 *
 * What it assumes: a call returns every record inside its cell's reach, as it did last time;
 * the plan and the records stay as they are; a call takes two seconds — 900 calls took half an
 * hour on 1 October. Discovery and empty-cell replays spend, and find nothing.
 *
 *   node --env-file=.env.local --import tsx scripts/simulate-passes.ts
 *   node --env-file=.env.local --import tsx scripts/simulate-passes.ts --months=12 --seed=3
 *   node --env-file=.env.local --import tsx scripts/simulate-passes.ts --first-pass-ceiling=500
 *   node --env-file=.env.local --import tsx scripts/simulate-passes.ts --replay-before=2026-10-01
 *
 * `--replay-before` checks D36's other claim instead: a robust cover drawn from what was known
 * before a date contains what appeared on it.
 */
import { loadCoverInputs } from '../lib/db/cover-inputs'
import { CONTAINMENT_TOLERANCE_METERS, CYCLE, HOURS_TTL_DAYS, SWEEP } from '../lib/config'
import {
  buildCoverIndex, contains, emptyReplays, planPass, reachOf, selectCover,
} from '../lib/coverage'
import { monthKey, nextScheduledPass, passCeiling } from '../lib/quota'

const HOUR_MS = 3_600_000
const TTL_MS = HOURS_TTL_DAYS * 24 * HOUR_MS
/** 900 calls stamped the base between 15:54 and 16:24 UTC on 1 October. */
const MS_PER_CALL = 2_000

function option(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

/** Deterministic, so a run can be replayed: the delays are the only thing drawn. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

async function load() {
  const inputs = await loadCoverInputs()
  if (!inputs) throw new Error('no plan in the database: run plan:cells, or db:pull a copy of production')
  return inputs
}

async function replay(before: Date): Promise<boolean> {
  const { cells, records, sirene } = await load()
  const dayAfter = new Date(before.getTime() + 24 * HOUR_MS)
  const known = records.filter((r) => r.firstSeenAt && r.firstSeenAt < before)
  const appeared = records.filter((r) => r.firstSeenAt && r.firstSeenAt >= before && r.firstSeenAt < dayAfter)
  const index = buildCoverIndex(cells, known, sirene)
  const context = { now: before, nextPass: before, ceiling: Number.POSITIVE_INFINITY, untiered: true }
  const reachCircle = (c: (typeof cells)[number]) => ({ lat: c.lat, lng: c.lng, radius: reachOf(c) ?? 0 })

  console.log(`REPLAY — covers drawn from the ${known.length} records first seen before ${before.toISOString().slice(0, 10)}`)
  console.log('The cells are read as they stand today: their reach before that date is not kept.\n')
  let missedByRobust: typeof appeared = []
  for (const robust of [false, true]) {
    const plan = selectCover(index, { ...context, robust })
    const missed = appeared.filter((p) => !plan.picks.some(({ cell: c }) => contains(reachCircle(c), p)))
    if (robust) missedByRobust = missed
    console.log(`${robust ? 'robust cover       ' : 'known-records cover'} : ${plan.picks.length} cells, ` +
      `contains ${appeared.length - missed.length} of the ${appeared.length} places that appeared that day`)
  }
  // Where each miss is: past every reach, nothing could have caught it; inside one, the cover
  // had no SIRENE point or known record there to make it pick that cell.
  for (const p of missedByRobust) {
    const reaching = cells.filter((c) => reachOf(c) !== null && contains(reachCircle(c), p))
    const where = reaching.length === 0
      ? 'past the reach of every queried cell'
      : `inside the reach of ${reaching.length} queried cell(s) ` +
        `(${reaching.map((c) => `depth ${c.depth}`).join(', ')}), none of them in the cover: no SIRENE ` +
        'point or known record there asked for one'
    console.log(`  missed: ${p.lat.toFixed(5)},${p.lng.toFixed(5)}, ${where}`)
  }
  return missedByRobust.length <= 1
}

async function simulate(): Promise<boolean> {
  const months = Number(option('months') ?? 12)
  const seed = Number(option('seed') ?? 1)
  const firstPassCeiling = Number(option('first-pass-ceiling') ?? CYCLE.firstPassCeiling)
  const now = new Date()
  const from = option('from') ? new Date(option('from')!) : nextScheduledPass(now, CYCLE.scheduleDays, CYCLE.scheduleHourUtc)
  const until = new Date(from)
  until.setUTCMonth(until.getUTCMonth() + months)

  const { cells, records, sirene } = await load()
  const index = buildCoverIndex(cells, records, sirene)
  const hours = index.items.map((item, i) => (item.kind === 'record' ? i : -1)).filter((i) => i >= 0)
  const emptyLast = new Map(index.empty.map((c) => [c.id, c.queriedAt]))
  let discoveryLeft = cells.filter((c) => c.status === 'pending' || c.status === 'failed').length
  const random = seeded(seed)
  const ceilings = { first: firstPassCeiling, full: SWEEP.maxCallsPerPeriod, secondPassDay: CYCLE.secondPassDay }

  console.log(`SIMULATION — ${months} months from ${iso(from.getTime())} UTC, seed ${seed}, ` +
    `first pass ceiling ${firstPassCeiling}`)
  console.log(`cells ${cells.length}, cover candidates ${index.candidates.length}, empty ${index.empty.length}, ` +
    `records with hours ${index.hoursTotal}\n`)
  console.log('pass (UTC)          cover   calls  spent   robust  forecast  fresh after')

  const freshAt = (t: number) => hours.filter((i) => index.items[i].due! > t).length / index.hoursTotal
  const spent = new Map<string, number>()
  const firstHalf = new Map<string, number>()
  let worst = { fresh: 1, at: 0 }
  let minForecast = 1
  let emptyReplayed = 0
  let discovered = 0
  let sum = 0
  let samples = 0
  let measureFrom = 0

  for (let scheduled = from; scheduled < until;
    scheduled = nextScheduledPass(scheduled, CYCLE.scheduleDays, CYCLE.scheduleHourUtc)) {
    const start = scheduled.getTime() + random() * CYCLE.maxScheduleDelayHours * HOUR_MS
    for (let t = Math.ceil(measureFrom / HOUR_MS) * HOUR_MS; measureFrom && t < start; t += HOUR_MS) {
      const fresh = freshAt(t)
      sum += fresh
      samples++
      if (fresh < worst.fresh) worst = { fresh, at: t }
    }

    const startDate = new Date(start)
    const period = monthKey(startDate)
    const before = spent.get(period) ?? 0
    const ceiling = Math.max(0, passCeiling(startDate, ceilings) - before)
    const nextPass = nextScheduledPass(scheduled, CYCLE.scheduleDays, CYCLE.scheduleHourUtc)
    const replays = emptyReplays(
      index.empty.map((c) => ({ id: c.id, queriedAt: emptyLast.get(c.id) ?? null })),
      startDate, passCeiling(startDate, ceilings) === SWEEP.maxCallsPerPeriod,
    ).slice(0, ceiling)
    const plan = planPass(index, { now: startDate, nextPass, ceiling: ceiling - replays.length })
    minForecast = Math.min(minForecast, plan.chosen.forecast)

    let t = start
    for (const c of replays) {
      t += MS_PER_CALL
      emptyLast.set(c.id, new Date(t))
    }
    emptyReplayed += replays.length
    for (const { slot } of plan.chosen.picks) {
      t += MS_PER_CALL
      for (const i of index.members[slot]) index.items[i].due = t + TTL_MS
    }
    let calls = replays.length + plan.chosen.picks.length
    const discovery = Math.min(discoveryLeft, ceiling - calls)
    discoveryLeft -= discovery
    discovered += discovery
    calls += discovery
    measureFrom = t + discovery * MS_PER_CALL

    spent.set(period, before + calls)
    if (ceiling > 0 && passCeiling(startDate, ceilings) === firstPassCeiling) firstHalf.set(period, before + calls)
    console.log(`${iso(start)}    ${String(plan.chosen.picks.length).padStart(5)}   ${String(calls).padStart(5)}  ` +
      `${String(before + calls).padStart(5)}   ${plan.chosen.robust ? 'yes' : 'no '}     ${pct(plan.chosen.forecast).padStart(6)}` +
      `    ${pct(freshAt(measureFrom)).padStart(6)}`)
  }

  const maxSpent = Math.max(...spent.values())
  const maxFirstHalf = Math.max(0, ...firstHalf.values())
  console.log('')
  console.log(`WORST HOUR          : ${pct(worst.fresh)} of the records with hours, ${iso(worst.at)} UTC`)
  console.log(`mean                : ${pct(sum / samples)}`)
  console.log(`lowest forecast     : ${pct(minForecast)}  (D39 fails a pass under ${pct(CYCLE.freshnessFloor)})`)
  console.log(`most in one period  : ${maxSpent} / ${SWEEP.maxCallsPerPeriod}`)
  console.log(`most by the 16th    : ${maxFirstHalf} / ${firstPassCeiling}`)
  console.log(`empty-cell replays  : ${emptyReplayed}  (reserve ${CYCLE.emptyReplayReserve} on the 16th)`)
  console.log(`discovery calls     : ${discovered}`)
  console.log(`containment         : each cell's reach, ${CONTAINMENT_TOLERANCE_METERS * 1000} mm tolerance`)

  const failures = [
    worst.fresh < CYCLE.freshnessTarget && `the worst hour ${pct(worst.fresh)} is under ${pct(CYCLE.freshnessTarget)}`,
    maxSpent > SWEEP.maxCallsPerPeriod && `a period spent ${maxSpent}`,
    maxFirstHalf > firstPassCeiling && `a first half spent ${maxFirstHalf}`,
  ].filter(Boolean)
  for (const f of failures) console.error(`! ${f}`)
  return failures.length === 0
}

async function main() {
  const before = option('replay-before')
  const ok = before ? await replay(new Date(before)) : await simulate()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(`\nsimulate:passes failed — ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
