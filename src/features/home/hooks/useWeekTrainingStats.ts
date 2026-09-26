import { useMemo } from 'react'
import { startOfWeek } from 'date-fns'
import { useHevyWorkouts } from '../../training/hooks/useHevyWorkouts'
import { useStravaActivities } from '../../training/hooks/useStravaActivities'
import type { HevyWorkout } from '../../training/types.hevy'

// hevy_created_at is the SYNC time, not when the workout happened — every
// date here prefers start_time (the same fix fetchHevyPRs got).
const workoutDate = (w: HevyWorkout) => w.start_time ?? w.hevy_created_at

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
 * This week's training at a glance, for Home and Daily. Uses the same
 * `useHevyWorkouts({ limit: 50 })` key everywhere so the list is fetched once.
 */
export function useWeekTrainingStats(): WeekTrainingStats {
  const hevy = useHevyWorkouts({ limit: 50 })
  const strava = useStravaActivities({ limit: 20 })

  return useMemo(() => {
    const workouts = hevy.data ?? []
    const activities = strava.data ?? []
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime()
    const since = (iso: string | null) => !!iso && new Date(iso).getTime() >= weekStart

    const weekWorkouts = workouts.filter(w => since(workoutDate(w)))
    const weekStrava = activities.filter(a => since(a.start_date))

    const hevyMin = weekWorkouts.reduce((sum, w) => {
      if (!w.start_time || !w.end_time) return sum
      return sum + Math.max(0, new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60_000
    }, 0)
    const stravaMin = weekStrava.reduce((sum, a) => sum + (a.duration_seconds ?? 0) / 60, 0)
    const km = weekStrava.reduce((sum, a) => sum + (a.distance_meters ?? 0) / 1000, 0)

    const lastWorkout = [...workouts].sort((a, b) => workoutDate(b).localeCompare(workoutDate(a)))[0] ?? null

    return {
      sessions: weekWorkouts.length + weekStrava.length,
      hevySessions: weekWorkouts.length,
      stravaSessions: weekStrava.length,
      minutes: Math.round(hevyMin + stravaMin),
      km: Math.round(km * 10) / 10,
      lastWorkout,
      lastWorkoutAt: lastWorkout ? workoutDate(lastWorkout) : null,
      hasData: workouts.length > 0 || activities.length > 0,
      isLoading: hevy.isLoading || strava.isLoading,
    }
  }, [hevy.data, strava.data, hevy.isLoading, strava.isLoading])
}
