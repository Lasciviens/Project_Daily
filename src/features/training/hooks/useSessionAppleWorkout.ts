import { useMemo } from 'react'
import { formatLocalDate, localDayOf } from '../../../shared/utils/dateUtils'
import { useHealthWorkoutSummaries } from '../../health/hooks/useHealthExport'
import { appleWorkoutOfSession } from '../workoutHealthMatch'

/** The Apple Health workout that is this Hevy session (211's link — the database's; before 211 the overlap rule,
 *  workoutHealthMatch), from that day's workout summaries. Shared by the session popup's stats row and its Apple
 *  Watch section — one read. Call it only for a session with a start and an end. */
export function useSessionAppleWorkout(hevyId: string, startTime: string, endTime: string) {
  // A watch workout started a little before a session that began just after
  // midnight sits on the previous local day — look 30 minutes back so it is
  // still fetched (the query filters by start_time).
  const startMs = new Date(startTime).getTime()
  const fromDay = (Number.isFinite(startMs) ? formatLocalDate(new Date(startMs - 30 * 60_000)) : null) ?? ''
  const toDay = localDayOf(endTime) ?? fromDay
  const summaries = useHealthWorkoutSummaries(fromDay, toDay < fromDay ? fromDay : toDay)
  // keepPreviousData would show another day's workouts for a moment.
  const loading = summaries.isLoading || summaries.isPlaceholderData
  const match = useMemo(
    () => (loading ? null : appleWorkoutOfSession(hevyId, { start_time: startTime, end_time: endTime }, summaries.data ?? [])),
    [loading, hevyId, startTime, endTime, summaries.data],
  )
  return { match, isLoading: loading, isError: summaries.isError }
}
