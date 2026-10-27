// Football's reads and actions (docs/features/football.md). ESPN's answers are
// cached by TanStack Query and never stored; follows and plans are the
// owner's rows (163). Every action says its result.
import { useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { confirmDelete, useEntityModal } from '../../../shared/modals'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { qk, STALE } from '../../../shared/query'
import { logError } from '../../../shared/utils/logError'
import { rowsOf, type DeletedRows } from '../../../shared/utils/deletedRows'
import { fetchTasksByIds } from '../../todo/api/tasksApi'
import { useDeleteTask } from '../../todo/hooks/useTodos'
import { isClosedTask } from '../../todo/taskRules'
import { fetchRoster, searchFootball } from '../api/espnApi'
import { createFollow, fetchFollows, fetchPlans, recordPlan, setFavourite, setSubscribed } from '../api/footballApi'
import { buildAgenda, leagueMonths, MATCH_CATEGORY, matchItem, subscriptionLeavers, type FbMatch } from '../footballModel'
import type { FootballFollow, FootballPlan, NewFollowInput } from '../types'
import {
  ESPN, LIVE_EVERY, leagueMonthQuery, matchQuery, needsLive, standingsQuery, teamFixturesQuery, teamInfoQuery, teamResultsQuery,
} from './espnQueries'
import { footballSyncSettled, runFootballSync } from './footballSync'

// ─── The owner's rows ────────────────────────────────────────────────────────

export function useFollows() {
  return useQuery({ queryKey: qk.football.follows(), queryFn: fetchFollows, staleTime: STALE.short })
}

export function usePlans() {
  return useQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: STALE.short })
}

/** The plan of each match in the day, by ESPN event id (only plans whose item still exists). */
export function usePlannedTasks(): Map<string, string> {
  const { data } = usePlans()
  return useMemo(() => new Map((data ?? []).filter(p => p.task_id).map(p => [p.event_id, p.task_id!])), [data])
}

// ─── ESPN ────────────────────────────────────────────────────────────────────

export function useTeamResults(teamId: string | null) {
  return useQuery({ ...teamResultsQuery(teamId ?? ''), enabled: !!teamId })
}

export function useTeamFixtures(teamId: string | null) {
  return useQuery({ ...teamFixturesQuery(teamId ?? ''), enabled: !!teamId })
}

export function useStandings(league: string | null) {
  return useQuery({ ...standingsQuery(league ?? ''), enabled: !!league })
}

export function useTeamInfo(league: string | null, teamId: string | null) {
  return useQuery({ ...teamInfoQuery(league ?? '', teamId ?? ''), enabled: !!league && !!teamId })
}

export function useRoster(league: string | null, teamId: string | null) {
  return useQuery({
    queryKey: qk.football.roster(league ?? '', teamId ?? ''), queryFn: () => fetchRoster(league!, teamId!), enabled: !!league && !!teamId,
    staleTime: STALE.long, ...ESPN,
  })
}

/** A match's popup; read every minute while it is being played. */
export function useMatchDetail(league: string | null, eventId: string | null) {
  return useQuery({
    ...matchQuery(league ?? '', eventId ?? ''), enabled: !!league && !!eventId,
    refetchInterval: q => (q.state.data && needsLive(q.state.data.match) ? LIVE_EVERY : false),
  })
}

export function useFootballSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: qk.football.search(q.toLowerCase()), queryFn: () => searchFootball(q), enabled: q.length >= 2,
    staleTime: STALE.long, ...ESPN,
  })
}

/**
 * Every followed team's fixtures and results and every followed tournament's
 * months, as one agenda (live, coming by day, results). Read again every
 * minute while a match is live. `failed` names what couldn't be read; the rest
 * still shows.
 */
export function useFootballAgenda(follows: readonly FootballFollow[], now: string) {
  const teams = follows.filter(f => f.kind === 'team').map(f => f.ref)
  const leagues = follows.filter(f => f.kind === 'league').map(f => f.ref)
  const months = leagueMonths(now)
  const sources = [
    ...teams.flatMap(id => [{ q: teamFixturesQuery(id), name: nameOf(follows, 'team', id) }, { q: teamResultsQuery(id), name: nameOf(follows, 'team', id) }]),
    ...leagues.flatMap(slug => months.map(m => ({ q: leagueMonthQuery(slug, m), name: nameOf(follows, 'league', slug) }))),
  ]
  const results = useQueries({
    queries: sources.map(s => ({
      ...s.q,
      refetchInterval: (q: { state: { data?: FbMatch[] } }) => (q.state.data?.some(m => needsLive(m)) ? LIVE_EVERY : false),
    })),
  })
  const stamp = results.map(r => r.dataUpdatedAt).join(',')
  const agenda = useMemo(
    () => buildAgenda(results.flatMap(r => r.data ?? []), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the answers' times say when anything changed
    [stamp, now],
  )
  const failed = [...new Set(sources.filter((_, i) => results[i].isError).map(s => s.name))]
  return {
    agenda,
    loading: results.some(r => r.isLoading),
    failed,
    retry: () => { for (const r of results) if (r.isError) void r.refetch() },
  }
}

const nameOf = (follows: readonly FootballFollow[], kind: 'team' | 'league', ref: string) =>
  follows.find(f => f.kind === kind && f.ref === ref)?.name ?? ref

// ─── Actions ─────────────────────────────────────────────────────────────────

export function useFollow() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'football_follow',
    successMessage: f => `Following ${f.name}`,
    mutationFn: ({ input, sortOrder }: { input: NewFollowInput; sortOrder: number }) => createFollow(input, sortOrder),
    onSuccess: f => qc.setQueryData<FootballFollow[]>(qk.football.follows(), list => (list && !list.some(x => x.id === f.id) ? [...list, f] : list)),
    invalidates: [qk.football.follows()],
  })
}

/** A team's coming matches into the day (Subscribe), or no more when nothing of it is in the day (Unsubscribe — useStopSubscription decides). */
export function useSetSubscribed() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'football_subscribe',
    // The subscription's own run follows at once and says what it added.
    successMessage: f => (f.subscribed ? `Subscribed to ${f.name}` : `Unsubscribed from ${f.name}`),
    mutationFn: ({ follow, on }: { follow: FootballFollow; on: boolean }) => setSubscribed(follow.id, on),
    onSuccess: f => {
      putRowsInCache(qc, qk.football.follows(), [f])
      if (f.subscribed) void runFootballSync(qc, { within: 0, sayNothing: true })
    },
    invalidates: [qk.football.follows()],
  })
}

/** A followed team starred as a favourite, or no more (168): the Personal page's Football card shows each favourite. */
export function useSetFavourite() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'football_favourite',
    successMessage: f => (f.favourite ? `${f.name} is a favourite` : `${f.name} is no longer a favourite`),
    mutationFn: ({ follow, on }: { follow: FootballFollow; on: boolean }) => setFavourite(follow.id, on),
    onSuccess: f => putRowsInCache(qc, qk.football.follows(), [f]),
    invalidates: [qk.football.follows()],
  })
}

const matchCount = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`

/** ESPN didn't give the team's fixtures (as opposed to the app's own rows failing to load). */
class FixturesUnread extends Error {}

/** The coming matches a team's subscription put in the day that are still to do. */
async function leavingMatches(qc: QueryClient, f: FootballFollow): Promise<FootballPlan[]> {
  const [fixtures, plans, follows] = await Promise.all([
    qc.fetchQuery(teamFixturesQuery(f.ref)).catch((err: Error) => { throw new FixturesUnread(err.message) }),
    qc.fetchQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: 0 }),
    qc.fetchQuery({ queryKey: qk.football.follows(), queryFn: fetchFollows, staleTime: 0 }),
  ])
  const others = new Set(follows.filter(x => x.kind === 'team' && x.subscribed && x.id !== f.id).map(x => x.ref))
  const leaving = subscriptionLeavers(f.ref, fixtures, plans, others, new Date().toISOString())
  const open = new Set((await fetchTasksByIds(leaving.map(p => p.task_id!))).filter(t => !isClosedTask(t)).map(t => t.id))
  return leaving.filter(p => open.has(p.task_id!))
}

interface StopSnapshot { tasks: DeletedRows | null; plans: DeletedRows | null; follow: DeletedRows | null }

/**
 * Unsubscribe, and Unfollow (owner, 25.10.2026: "When unsubscribed from a team
 * it does not remove the events.. Now I have duplicates"): the coming matches
 * the team's subscription put in your day leave it — their Google Calendar
 * events too, through THE task delete — and so do their records, so
 * subscribing again adds them again. It asks first, then "Unsubscribed from
 * Galatasaray · 5 matches removed from your day · Undo"; Undo puts back the
 * items, records, the follow and the subscription. Matches you planned
 * yourself (Plan it) and done ones stay. With nothing to remove, Unsubscribe
 * just turns it off and Unfollow asks as any delete.
 */
export function useStopSubscription() {
  const qc = useQueryClient()
  const tasks = useDeleteTask()
  const plans = useRowsDelete({ table: 'football_plans', action: 'football_unsubscribe_plans', invalidates: [qk.football.plans()], cache: qk.football.plans() })
  const follows = useRowsDelete({ table: 'football_follows', action: 'football_unfollow', invalidates: [qk.football.follows()], cache: qk.football.follows() })
  const setSub = useSetSubscribed()
  const toggle = useMutationWithFeedback({
    action: 'football_subscribe',
    silent: 'the unsubscribe question reports it',
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setSubscribed(id, on),
    onSuccess: f => putRowsInCache(qc, qk.football.follows(), [f]),
    invalidates: [qk.football.follows()],
  })
  const [reading, setReading] = useState(false)

  async function stop(f: FootballFollow, unfollow: boolean) {
    let leaving: FootballPlan[] = []
    if (f.subscribed) {
      setReading(true)
      try {
        // A run of the subscription still saving (Subscribe a moment ago) finishes first, so its matches are counted too.
        await footballSyncSettled()
        leaving = await leavingMatches(qc, f)
      } catch (err) {
        logError(`Football: ${f.name}'s matches couldn't be read to stop the subscription: ${(err as Error).message}`, { action: 'football_unsubscribe' })
        toast.warning(err instanceof FixturesUnread
          ? `${f.name}'s fixtures couldn't be read from ESPN, so nothing changed — try again`
          : `Your football matches couldn't be read, so nothing changed — try again`)
        return
      } finally {
        setReading(false)
      }
    }
    if (!leaving.length) {
      if (unfollow) {
        await follows.run([f.id], { title: `Unfollow ${f.name}?`, confirmLabel: 'Unfollow', done: `${f.name} unfollowed` })
      } else {
        setSub.mutate({ follow: f, on: false })
      }
      return
    }
    const removed = `${matchCount(leaving.length)} removed from your day`
    await confirmDelete<StopSnapshot>({
      title: unfollow ? `Unfollow ${f.name}?` : `Unsubscribe from ${f.name}?`,
      message: `Its ${matchCount(leaving.length)} coming up ${leaving.length === 1 ? 'leaves' : 'leave'} your day (and Google Calendar). Matches you planned yourself stay.`,
      confirmLabel: unfollow ? 'Unfollow' : 'Unsubscribe',
      remove: async () => {
        // Off first, so no run of the subscription adds them back meanwhile.
        await toggle.mutateAsync({ id: f.id, on: false })
        let t: DeletedRows | null
        try {
          t = await tasks.remove.mutateAsync(leaving.map(p => p.task_id!))
        } catch (err) {
          // Nothing left the day (the delete said why): the subscription goes back on.
          await toggle.mutateAsync({ id: f.id, on: true }).catch(() => undefined)
          throw err
        }
        // From here the matches are out: a step that fails says so, and Undo is still offered.
        // A record left only means that match isn't added again.
        const p = await plans.remove.mutateAsync(leaving.map(x => x.id)).catch(() => null)
        const fl = unfollow ? await follows.remove.mutateAsync([f.id]).catch(() => null) : null
        return { tasks: t, plans: p, follow: fl }
      },
      isEmpty: () => false,
      restore: async s => {
        if (s.follow) await follows.restore.mutateAsync(s.follow)
        // The records first: the items put back link them again (144).
        if (s.plans) await plans.restore.mutateAsync(s.plans)
        let answer
        try {
          answer = s.tasks ? await tasks.restore.mutateAsync(s.tasks) : undefined
        } catch (err) {
          // Records without their items would keep the subscription from ever adding those matches again.
          if (s.plans) await plans.remove.mutateAsync(rowsOf<FootballPlan>(s.plans, 'football_plans').map(x => x.id)).catch(() => null)
          throw err
        }
        await toggle.mutateAsync({ id: f.id, on: true })
        return answer
      },
      done: s => (unfollow && s.follow ? `${f.name} unfollowed · ${removed}` : `Unsubscribed from ${f.name} · ${removed}`),
    })
  }

  return {
    busy: reading || toggle.isPending || setSub.isPending || tasks.busy || plans.busy || follows.busy,
    unsubscribe: (f: FootballFollow) => stop(f, false),
    unfollow: (f: FootballFollow) => stop(f, true),
  }
}

/** After "Plan it" saved the item through the Add sheet (which says "Added …"): the match's record. */
export function useRecordPlan() {
  return useMutationWithFeedback({
    action: 'football_record_plan',
    silent: 'the Add sheet says the item was added',
    mutationFn: ({ match, taskId }: { match: FbMatch; taskId: string }) => recordPlan(match, taskId),
    invalidates: [qk.football.plans()],
  })
}

/**
 * "Plan it": the Add sheet (useEntityModal → the one item save), prefilled
 * with the match — its title, Norway's day and kick-off, two hours, the
 * competition and stadium as notes. Once saved, the match's record follows
 * ESPN (a moved kick-off moves the item; footballSync).
 */
export function usePlanIt() {
  const qc = useQueryClient()
  const modal = useEntityModal()
  const record = useRecordPlan()
  return async (m: FbMatch) => {
    // A list read a moment ago may not know a match the subscription just added:
    // the records are read again, and a match already in the day opens its item.
    const plans = await qc.fetchQuery({ queryKey: qk.football.plans(), queryFn: fetchPlans, staleTime: 0 }).catch(() => null)
    const taskId = plans?.find(p => p.event_id === m.id && p.task_id)?.task_id
    if (taskId) {
      toast.info('Already in your day')
      modal.open({ kind: 'task', id: taskId })
      return
    }
    const mi = matchItem(m)
    modal.open({
      kind: 'task',
      defaults: {
        title: mi.title, notes: mi.notes ?? undefined, date: mi.date, dueDate: mi.date, domain: 'personal', category: MATCH_CATEGORY,
        ...(mi.time ? { startTime: mi.time, duration: mi.durationMinutes ?? undefined, scheduled: true } : {}),
      },
      onSaved: r => { if (r.taskId) record.mutate({ match: m, taskId: r.taskId }) },
    })
  }
}
