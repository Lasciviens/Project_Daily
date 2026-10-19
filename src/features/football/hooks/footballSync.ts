// The subscription (owner, 19.10.2026: "Subscribe on a team + plan it. So
// both"): a subscribed team's coming matches go into the day by themselves, and
// a planned match follows ESPN when its kick-off moves. Runs when the app opens
// or comes back to the front (at most every 30 minutes), when the Football page
// opens, and right after a subscription is turned on. What to change is
// footballModel.syncPlan's; each change is one app_football_plan call (the
// item save and its record in one transaction), then Google as for any item.
// It says what it did in one message ("Football: 2 matches added to your
// day"); nothing to do says nothing; a failure is logged once, never a toast
// on every open.
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
import { fetchMatch, fetchTeamFixtures } from '../api/espnApi'
import { fetchFollows, fetchPlans, planMatch } from '../api/footballApi'
import { movedMatchItem, newMatchItem, syncPlan, type FbMatch } from '../footballModel'

const EVERY_MS = 30 * 60_000
/** Planned matches outside every subscribed team's fixtures, re-read one by one: at most this many per run. */
const MAX_LOOKUPS = 10

let running: Promise<void> | null = null
let lastRun = 0
let logged = false

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 'es'}`

async function syncOnce(qc: QueryClient): Promise<void> {
  const [follows, plans] = await Promise.all([
    qc.fetchQuery({ queryKey: qk.football.follows(), queryFn: fetchFollows, staleTime: STALE.short }),
    qc.fetchQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: STALE.short }),
  ])
  const subscribed = new Set(follows.filter(f => f.kind === 'team' && f.subscribed).map(f => f.ref))
  const now = new Date().toISOString()
  // Plans come soonest first (fetchPlans): the nearest kick-offs are re-checked first.
  const coming = plans.filter(p => p.task_id && Date.parse(p.kickoff_at) > Date.now())
  if (!subscribed.size && !coming.length) return

  const matches: FbMatch[] = []
  for (const teamId of subscribed) {
    matches.push(...await qc.fetchQuery({ queryKey: qk.football.fixtures(teamId), queryFn: () => fetchTeamFixtures(teamId), staleTime: STALE.default }))
  }
  // A match planned by hand (or of a team no longer subscribed): its own summary.
  const known = new Set(matches.map(m => m.id))
  for (const p of coming.filter(p => !known.has(p.event_id)).slice(0, MAX_LOOKUPS)) {
    const detail = await fetchMatch(p.league, p.event_id).catch(() => null)
    if (detail) matches.push(detail.match)
  }

  const { add, move } = syncPlan(matches, subscribed, plans, now)
  let added = 0
  let moved = 0
  for (const m of add) {
    if (!m.league) continue
    const saved = await saveItemVia(qc, newMatchItem(m), (input, ctx) => planMatch(m, 'subscription', input, ctx))
    if (saved) added++
  }
  for (const { match, plan } of move) {
    const task = await fetchTaskById(plan.task_id!)
    // A closed item, or a repeat's day, is the owner's now: left as it is.
    if (!task || isClosedTask(task) || task.schedule_block_id) continue
    const slot = await qc.fetchQuery(linkedTimeBlockQuery(task.id))
    const item = movedMatchItem(itemFromRows(task, slot ?? null, null), match)
    const saved = await saveItemVia(qc, item, (input, ctx) => planMatch(match, plan.origin, input, ctx))
    if (saved) moved++
  }
  if (!added && !moved) return
  void invalidate(qc, 'taskGraph', qk.football.plans())
  const said = [added && `${plural(added, 'match')} added to your day`, moved && `${plural(moved, 'match')} moved to a new kick-off`].filter(Boolean)
  toast.info(`Football: ${said.join(' · ')}`)
}

/**
 * One run of the subscription; a second call while one runs waits for it.
 * `force` skips the 30-minute pause (the page opening, a subscription turned on).
 */
export function runFootballSync(qc: QueryClient, { force = false }: { force?: boolean } = {}): Promise<void> {
  if (running) return running
  if (!force && Date.now() - lastRun < EVERY_MS) return Promise.resolve()
  running = syncOnce(qc)
    .then(() => { lastRun = Date.now() })
    .catch(err => {
      if (logged) return
      logged = true
      logError(`Football subscription didn't run: ${(err as Error).message}`, { action: 'football_sync' })
    })
    .finally(() => { running = null })
  return running
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
