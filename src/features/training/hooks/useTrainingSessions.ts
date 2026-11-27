import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useTrainingBlocks, useScheduleBlocks, useTrainingDayTasks } from '../../daily/hooks/useSchedule'
import { pickNextTrainingSession, type NextTrainingSession } from '../trainingPlanModel'
import { useTrainingWeek } from './useTrainingWeek'
import { planStartHHMM } from '../components/calendar/calendarSessions'
import { fetchStravaStatus } from '../api/trainingApi'
import { syncStravaActivities, disconnectStrava, exchangeStravaCode } from '../api/stravaApi'

export function useStravaStatus() {
  return useQuery({
    queryKey: qk.training.stravaStatus(),
    queryFn:  fetchStravaStatus,
    staleTime: STALE.hour,
  })
}

// Activities live under ['strava', …] and the connection status under
// ['training', …] — invalidating only ['training'] (the old behaviour) left
// every Strava list stale after a sync, connect or disconnect.
const STRAVA_TARGETS = [qk.strava.all, qk.training.all] as const

export function useSyncStrava() {
  return useMutationWithFeedback({
    action:         'sync_strava',
    loadingMessage: 'Syncing Strava activities…',
    successMessage: (data: Awaited<ReturnType<typeof syncStravaActivities>>) => `Synced ${data.synced} activities from Strava`,
    mutationFn:     syncStravaActivities,
    invalidates:    STRAVA_TARGETS,
  })
}

export function useDisconnectStrava() {
  return useMutationWithFeedback({
    action:         'disconnect_strava',
    loadingMessage: 'Disconnecting Strava…',
    successMessage: 'Strava disconnected',
    mutationFn:     disconnectStrava,
    invalidates:    STRAVA_TARGETS,
  })
}

/** Finishes the OAuth redirect: exchanges Strava's ?code= for tokens. */
export function useConnectStrava() {
  return useMutationWithFeedback({
    action:         'connect_strava',
    logPayload:     false,   // the input is an OAuth code
    loadingMessage: 'Connecting to Strava…',
    successMessage: (r: Awaited<ReturnType<typeof exchangeStravaCode>>) => `Connected as ${r.athlete_name ?? 'Strava athlete'}`,
    errorFallback:  'Strava connection failed',
    mutationFn:     (code: string) => exchangeStravaCode(code),
    invalidates:    STRAVA_TARGETS,
  })
}

// ─── Planned sessions ────────────────────────────────────────────────────────

// Today's local date, kept current across midnight — the one shared hook.
export { useTodayStr }

export const NEXT_SESSION_LOOKAHEAD_DAYS = 30

/**
 * The next planned training session: this week's first session still to do in
 * the program's order (sessionState.planWeek — a missed one comes first, today's
 * stays next all day; owner, 27.11.2026), else the soonest one-off training block
 * or recurring training template (trainingPlanModel.pickNextTrainingSession). The
 * ONE "next session" for the Training banner and Home. A 'block' opens with
 * `{ kind: 'time-block', id }`, a 'recurring' one with
 * `{ kind: 'schedule-block', id }`.
 */
export function useNextTrainingSession(): { data: NextTrainingSession | null; isLoading: boolean } {
  const today = useTodayStr()
  const to = shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS)
  const blocksQ = useTrainingBlocks(today, to)
  const templatesQ = useScheduleBlocks()
  const dayTasksQ = useTrainingDayTasks(today, to)
  const nowHHMM = format(new Date(), 'HH:mm')
  const { week, planOf, isLoading: weekLoading } = useTrainingWeek()
  const soonest = useMemo(() => pickNextTrainingSession({
    blocks:        blocksQ.data ?? [],
    templates:     (templatesQ.data ?? []).filter(t => t.category === 'training'),
    dayTasks:      dayTasksQ.data ?? [],
    today,
    nowHHMM,
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
  }), [blocksQ.data, templatesQ.data, dayTasksQ.data, today, nowHHMM])
  const data = useMemo<NextTrainingSession | null>(() => {
    const next = week.next
    const plan = next ? planOf.get(next.key) : undefined
    if (!next || !plan) return soonest
    const startTime = planStartHHMM(plan)
    const doOn = next.doOn === next.date ? undefined : next.doOn
    if (plan.kind === 'block' && plan.timeBlock) {
      return { kind: 'block', id: plan.timeBlock.id, title: plan.title, date: next.date, startTime, taskId: plan.timeBlock.task_id ?? null, routineId: next.routineId, doOn }
    }
    if (plan.scheduleBlock) {
      return { kind: 'recurring', id: plan.scheduleBlock.id, title: plan.title, date: next.date, startTime, taskId: plan.dayTask?.id ?? null, routineId: next.routineId, doOn }
    }
    return soonest
  }, [week.next, planOf, soonest])
  return { data, isLoading: blocksQ.isLoading || templatesQ.isLoading || dayTasksQ.isLoading || weekLoading }
}
