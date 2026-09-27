import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useTrainingBlocks, useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { pickNextTrainingSession, type NextTrainingSession } from '../trainingPlanModel'
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
    loadingMessage: 'Connecting to Strava…',
    successMessage: (r: Awaited<ReturnType<typeof exchangeStravaCode>>) => `Connected as ${r.athlete_name ?? 'Strava athlete'}`,
    errorFallback:  'Strava connection failed',
    mutationFn:     (code: string) => exchangeStravaCode(code),
    invalidates:    STRAVA_TARGETS,
  })
}

// ─── Planned sessions ────────────────────────────────────────────────────────

/** Today's local date, kept current across midnight (focus, visibility and a
 *  one-minute tick) — a PWA left open overnight otherwise keeps yesterday. */
export function useTodayStr(): string {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const check = () => setToday(prev => (prev === todayStr() ? prev : todayStr()))
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    const id = setInterval(check, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      clearInterval(id)
    }
  }, [])
  return today
}

export const NEXT_SESSION_LOOKAHEAD_DAYS = 30

/**
 * The next planned training session: one-off training blocks AND recurring
 * training templates (trainingPlanModel.pickNextTrainingSession). The ONE
 * "next session" for the Training banner and Home. A 'block' opens with
 * `{ kind: 'time-block', id }`, a 'recurring' one with
 * `{ kind: 'schedule-block', id }`.
 */
export function useNextTrainingSession(): { data: NextTrainingSession | null; isLoading: boolean } {
  const today = useTodayStr()
  const to = shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS)
  const blocksQ = useTrainingBlocks(today, to)
  const templatesQ = useScheduleBlocks()
  const nowHHMM = format(new Date(), 'HH:mm')
  const data = useMemo(() => pickNextTrainingSession({
    blocks:        blocksQ.data ?? [],
    templates:     (templatesQ.data ?? []).filter(t => t.category === 'training'),
    today,
    nowHHMM,
    lookaheadDays: NEXT_SESSION_LOOKAHEAD_DAYS,
  }), [blocksQ.data, templatesQ.data, today, nowHHMM])
  return { data, isLoading: blocksQ.isLoading || templatesQ.isLoading }
}
