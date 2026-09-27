import { useMemo } from 'react'
import { useHevyWorkoutsRange, useRecentHevyWorkouts } from '../../training/hooks/useHevyWorkouts'
import { useStravaActivities } from '../../training/hooks/useStravaActivities'
import { useTodayStr } from '../../training/hooks/useTrainingSessions'
import { localDayBoundsIso, workoutLocalDay } from '../../training/workoutDates'
import { mondayOf, sessionsThisWeek, type DatedSession } from '../../training/progressAggregate'
import { localDayOf } from '../../../shared/utils/dateUtils'
import type { HevyWorkout } from '../../training/types.hevy'

// hevy_created_at is the SYNC time, not when the workout happened — every
// date here prefers start_time (workoutDates.ts).
const workoutAt = (w: HevyWorkout) => w.start_time ?? w.hevy_created_at

export interface WeekTrainingStats {
  /** Hevy workouts + Strava activities since Monday. */
  sessions: number
  hevySessions: number
  stravaSessions: number
  /** Minutes trained this week (Hevy start→end + Strava moving time). */
  minutes: number
  km: number
  lastWorkout: HevyWorkout | null
  lastWorkoutAt: string | null
  hasData: boolean
  isLoading: boolean
}

/**
 * This week's training at a glance, for Home and Daily. The week is read as
 * a date RANGE (Monday → today, local days) rather than "the latest 50", and
 * sessions are counted with the same sessionsThisWeek rule Progress uses, so
 * Home and Training agree on "N sessions this week". The last workout comes
 * from the shared recent-workouts read (already newest-first at the source).
 */
export function useWeekTrainingStats(): WeekTrainingStats {
  const today = useTodayStr()
  const weekStart = mondayOf(today)
  const bounds = useMemo(() => localDayBoundsIso(weekStart, today), [weekStart, today])
  const week = useHevyWorkoutsRange(weekStart, today)
  const recent = useRecentHevyWorkouts()
  const strava = useStravaActivities({ from: bounds.fromISO, to: bounds.toISO, limit: 100 })

  return useMemo(() => {
    const workouts = week.data ?? []
    const activities = strava.data ?? []
    const hevyDated: DatedSession[] = workouts.map(w => ({ id: `h:${w.id}`, date: workoutLocalDay(w) }))
    const stravaDated: DatedSession[] = activities
      .map(a => ({ id: `s:${a.id}`, date: localDayOf(a.start_date) ?? '' }))
      .filter(s => s.date)
    const hevySessions = sessionsThisWeek(hevyDated, today)
    const stravaSessions = sessionsThisWeek(stravaDated, today)

    const hevyMin = workouts.reduce((sum, w) => {
      if (!w.start_time || !w.end_time) return sum
      return sum + Math.max(0, new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60_000
    }, 0)
    const stravaMin = activities.reduce((sum, a) => sum + (a.duration_seconds ?? 0) / 60, 0)
    const km = activities.reduce((sum, a) => sum + (a.distance_meters ?? 0) / 1000, 0)

    const lastWorkout = recent.data?.[0] ?? workouts[0] ?? null

    return {
      sessions: hevySessions + stravaSessions,
      hevySessions,
      stravaSessions,
      minutes: Math.round(hevyMin + stravaMin),
      km: Math.round(km * 10) / 10,
      lastWorkout,
      lastWorkoutAt: lastWorkout ? workoutAt(lastWorkout) : null,
      hasData: (recent.data?.length ?? 0) > 0 || workouts.length > 0 || activities.length > 0,
      isLoading: week.isLoading || recent.isLoading || strava.isLoading,
    }
  }, [week.data, recent.data, strava.data, week.isLoading, recent.isLoading, strava.isLoading, today])
}
