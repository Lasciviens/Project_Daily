// Football's reads and actions (docs/features/football.md). ESPN's answers are
// cached by TanStack Query and never stored; follows and plans are the
// owner's rows (163). Every action says its result.
import { useMemo } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useEntityModal } from '../../../shared/modals'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { qk, STALE } from '../../../shared/query'
import { fetchRoster, fetchStandings, fetchTeam, searchFootball } from '../api/espnApi'
import { createFollow, fetchFollows, fetchPlans, recordPlan, setSubscribed } from '../api/footballApi'
import { buildAgenda, leagueMonths, MATCH_CATEGORY, matchItem, type FbMatch } from '../footballModel'
import type { FootballFollow, NewFollowInput } from '../types'
import { ESPN, LIVE_EVERY, leagueMonthQuery, matchQuery, needsLive, teamFixturesQuery, teamResultsQuery } from './espnQueries'
import { runFootballSync } from './footballSync'

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
  return useQuery({
    queryKey: qk.football.standings(league ?? ''), queryFn: () => fetchStandings(league!), enabled: !!league,
    staleTime: STALE.long, ...ESPN,
  })
}

export function useTeamInfo(league: string | null, teamId: string | null) {
  return useQuery({
    queryKey: qk.football.team(league ?? '', teamId ?? ''), queryFn: () => fetchTeam(league!, teamId!), enabled: !!league && !!teamId,
    staleTime: STALE.long, ...ESPN,
  })
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

/** Unfollow asks, then "Galatasaray unfollowed · Undo"; matches already in the day stay. */
export function useUnfollow() {
  const del = useRowsDelete({ table: 'football_follows', action: 'football_unfollow', invalidates: [qk.football.follows()], cache: qk.football.follows() })
  return {
    busy: del.busy,
    run: (f: FootballFollow) => del.run([f.id], {
      title: `Unfollow ${f.name}?`,
      message: f.subscribed ? 'Its matches already in your day stay there.' : undefined,
      confirmLabel: 'Unfollow',
      done: `${f.name} unfollowed`,
    }),
  }
}

/** A team's coming matches into the day (or no more); turning it on puts them there at once. */
export function useSetSubscribed() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'football_subscribe',
    // The subscription's own run follows at once and says what it added.
    successMessage: f => (f.subscribed ? `Subscribed to ${f.name}` : `Unsubscribed from ${f.name} · matches already in your day stay`),
    mutationFn: ({ follow, on }: { follow: FootballFollow; on: boolean }) => setSubscribed(follow.id, on),
    onSuccess: f => {
      putRowsInCache(qc, qk.football.follows(), [f])
      if (f.subscribed) void runFootballSync(qc, { within: 0, sayNothing: true })
    },
    invalidates: [qk.football.follows()],
  })
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
  const modal = useEntityModal()
  const record = useRecordPlan()
  return (m: FbMatch) => {
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
