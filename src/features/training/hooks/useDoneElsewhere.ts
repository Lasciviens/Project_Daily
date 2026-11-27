import { useMemo } from 'react'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { doneElsewhere, type DoneElsewhere } from '../sessionRef'
import { workoutLocalDay } from '../workoutDates'
import type { SessionStatus } from '../plan/sessionState'
import { useHevyWorkoutsRange } from './useHevyWorkouts'

// Its own module: sessionRef (and the calendar's pairing it carries) stays out of every page that only reads workouts.

/** A plan a workout on ANOTHER day closed (sessionRef.doneElsewhere: "Done 26.11.2026", a tap opens that workout).
 *  Reads the workouts around the plan's day — a workout closes a plan only inside its week (167) — and only when a
 *  workout did it. For views that read one day (Daily); the Log calendar has its weeks' workouts already (dayDataFor). */
export function useDoneElsewhere(status: Pick<SessionStatus, 'state' | 'doneBy' | 'workoutId'> | null, planDate: string): DoneElsewhere | null {
  const byWorkout = status?.state === 'done' && status.doneBy === 'workout' && !!status.workoutId
  const q = useHevyWorkoutsRange(shiftDateStr(planDate, -6), shiftDateStr(planDate, 6), { enabled: byWorkout })
  const workouts = q.data
  const state = status?.state
  const doneBy = status?.doneBy
  const workoutId = status?.workoutId
  return useMemo(() => {
    if (!state) return null
    return doneElsewhere({ state, doneBy: doneBy ?? null, workoutId: workoutId ?? null }, planDate, id => {
      const w = workouts?.find(x => x.id === id)
      return w ? workoutLocalDay(w) || null : null
    })
  }, [state, doneBy, workoutId, planDate, workouts])
}
