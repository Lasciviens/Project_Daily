// The subscription (owner, 19.10.2026: "Subscribe on a team + plan it. So
// both"): a subscribed team's coming matches go into the day by themselves, and
// a planned match follows ESPN when its kick-off moves. Runs when the app opens
// or comes back to the front (at most every 30 minutes), when the Football page
// opens (unless it ran in the last 5 minutes), and right after Subscribe is
// turned on (always — after a run already going). What to change is
// footballModel.syncPlan's; each addition or move is one app_football_plan call
// (the item save and its record in one transaction), then Google as for any
// item. Each match is tried on its own: one failure never stops the rest. It
// says what it did in one message ("Football: 2 matches added to your day ·
// 1 couldn't be added"); nothing to do says nothing (unless Subscribe asked);
// failures go to Developer → Errors.
import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { invalidate, qk, STALE } from '../../../shared/query'
import { logError } from '../../../shared/utils/logError'
import { linkedTimeBlockQuery } from '../../daily/hooks/useSchedule'
import { itemFromRows } from '../../items/itemRules'
import { saveItemVia } from '../../items/useItems'
import { fetchTaskById } from '../../todo/api/tasksApi'
import { isClosedTask } from '../../todo/taskRules'
import { fetchFollows, fetchPlans, planMatch, updatePlanKickoff } from '../api/footballApi'
import { involves, itemAtKickoff, movedMatchItem, newMatchItem, syncPlan, type FbMatch } from '../footballModel'
import type { FootballFollow } from '../types'
import { matchQuery, teamFixturesQuery } from './espnQueries'

const EVERY_MS = 30 * 60_000
/** Planned matches outside every subscribed team's fixtures, re-read one by one: at most this many per run. */
const MAX_LOOKUPS = 10

export interface SyncResult { added: number; moved: number; failed: number; unread: number }
export interface SyncOptions {
  /** Skip the run when the last one ended less than this long ago (default 30 minutes; 0 = always). */
  within?: number
  /** Say "nothing new" too (Subscribe asked for this run). */
  sayNothing?: boolean
}

let running: Promise<SyncResult | null> | null = null
let lastRun = 0

const matches = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`

async function syncOnce(qc: QueryClient): Promise<SyncResult> {
  const [follows, plans] = await Promise.all([
    qc.fetchQuery({ queryKey: qk.football.follows(), queryFn: fetchFollows, staleTime: 0 }),
    qc.fetchQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: 0 }),
  ])
  const result: SyncResult = { added: 0, moved: 0, failed: 0, unread: 0 }
  const subscribed = new Set(follows.filter(f => f.kind === 'team' && f.subscribed).map(f => f.ref))
  // Plans come soonest first (fetchPlans): the nearest kick-offs are re-checked first.
  const coming = plans.filter(p => p.task_id && Date.parse(p.kickoff_at) > Date.now())
  if (!subscribed.size && !coming.length) return result
  const fail = (what: string, err: unknown) => {
    logError(`Football subscription: ${what}: ${(err as Error).message}`, { action: 'football_sync' })
  }

  const found: FbMatch[] = []
  for (const teamId of subscribed) {
    try {
      found.push(...await qc.fetchQuery({ ...teamFixturesQuery(teamId), staleTime: STALE.default }))
    } catch (err) {
      result.unread++
      fail(`team ${teamId}'s fixtures couldn't be read`, err)
    }
  }
  // A match planned by hand (or of a team no longer subscribed): its own summary, cached like the popup's.
  const known = new Set(found.map(m => m.id))
  for (const p of coming.filter(p => !known.has(p.event_id)).slice(0, MAX_LOOKUPS)) {
    try {
      const detail = await qc.fetchQuery({ ...matchQuery(p.league, p.event_id), staleTime: STALE.default })
      if (detail) found.push(detail.match)
    } catch (err) {
      result.unread++
      fail(`match ${p.event_id} couldn't be read`, err)
    }
  }

  const { add, move } = syncPlan(found, subscribed, plans, new Date().toISOString())
  // Subscribed now (the cache Unsubscribe updates): a team unsubscribed while this run goes gets nothing more.
  const stillSubscribed = () => new Set((qc.getQueryData<FootballFollow[]>(qk.football.follows()) ?? follows)
    .filter(f => f.kind === 'team' && f.subscribed).map(f => f.ref))
  for (const m of add) {
    if (!m.league || !involves(m, stillSubscribed())) continue
    try {
      if (await saveItemVia(qc, newMatchItem(m), (input, ctx) => planMatch(m, 'subscription', input, ctx))) result.added++
    } catch (err) {
      result.failed++
      fail(`match ${m.id} couldn't be added`, err)
    }
  }
  for (const { match, plan } of move) {
    try {
      const task = await fetchTaskById(plan.task_id!)
      // A closed item, or a repeat's day, is the owner's now: left as it is.
      if (!task || isClosedTask(task) || task.schedule_block_id) continue
      const slot = await qc.fetchQuery(linkedTimeBlockQuery(task.id))
      const item = itemFromRows(task, slot ?? null, null)
      if (itemAtKickoff(item, plan)) {
        if (await saveItemVia(qc, movedMatchItem(item, match), (input, ctx) => planMatch(match, plan.origin, input, ctx))) result.moved++
      } else {
        // The owner moved it (a replay later on): only the record learns the new kick-off.
        await updatePlanKickoff(plan.id, match.kickoff, match.timeValid)
      }
    } catch (err) {
      result.failed++
      fail(`match ${match.id} couldn't be moved`, err)
    }
  }
  if (result.added || result.moved) void invalidate(qc, 'taskGraph', qk.football.plans())
  return result
}

function say(r: SyncResult, sayNothing: boolean) {
  const done = [r.added && `${matches(r.added)} added to your day`, r.moved && `${matches(r.moved)} moved to a new kick-off`].filter(Boolean)
  if (r.failed) {
    toast.warning(`Football: ${[...done, `${matches(r.failed)} couldn't be put in your day (Developer → Errors)`].join(' · ')}`)
  } else if (done.length) {
    toast.info(`Football: ${done.join(' · ')}`)
  } else if (sayNothing) {
    toast.info(r.unread ? 'Football: ESPN didn\'t answer — the matches will be added on the next try' : 'Football: no new match with a fixed kick-off for your day yet')
  }
}

/**
 * One run of the subscription. A call while one runs waits for it — and with
 * `within: 0` (Subscribe) runs again after it, since that run may have read the
 * follows before the change.
 */
export function runFootballSync(qc: QueryClient, opts: SyncOptions = {}): Promise<SyncResult | null> {
  const within = opts.within ?? EVERY_MS
  if (running) return within === 0 ? running.then(() => runFootballSync(qc, opts)) : running
  if (Date.now() - lastRun < within) return Promise.resolve(null)
  running = syncOnce(qc)
    .then(r => { say(r, !!opts.sayNothing); return r })
    .catch(err => {
      logError(`Football subscription didn't run: ${(err as Error).message}`, { action: 'football_sync' })
      if (opts.sayNothing) toast.warning('Football: your matches couldn\'t be added right now — the next try is when the app opens')
      return null
    })
    .finally(() => { lastRun = Date.now(); running = null })
  return running
}

/** Resolves once a run going now has finished (nothing to wait for: at once). */
export function footballSyncSettled(): Promise<void> {
  return running ? running.then(() => undefined) : Promise.resolve()
}

/** The subscription when the app opens or comes back to the front (useAppBootstrap). */
export function useFootballSyncOnOpen() {
  const qc = useQueryClient()
  useEffect(() => {
    const run = () => { if (document.visibilityState === 'visible') void runFootballSync(qc) }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [qc])
}
