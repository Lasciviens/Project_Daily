import { useMemo } from 'react'
import { mondayOfStr, shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useHevyWorkoutsRange } from './useHevyWorkouts'
import { useHevyRoutines } from './useHevyRoutines'
import { useTrainingPlansByDate } from './useTrainingPlans'
import { usePlanContext } from './usePlanContext'
import { matchDaySessions, planRoutineId, planStartHHMM } from '../components/calendar/calendarSessions'
import { planWeek, sessionStatus, type TrainingWeek, type WeekSessionInput } from '../plan/sessionState'
import { workoutLocalDay } from '../workoutDates'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'

export interface TrainingWeekView {
  week: TrainingWeek
  /** The plan behind each session (by its key) — what a chip opens. */
  planOf: ReadonlyMap<string, CalendarPlanItem>
  isLoading: boolean
  isError: boolean
}

const MON_FIRST = (d: number) => (d + 6) % 7

/**
 * The week of `date` (Monday to Sunday) as THE status reads it (plan/sessionState → planWeek): every planned session
 * with its status, the day its workout was done, a swap on its day, and the one still open from last week. The
 * program's order is the weekly schedule's day order (S22). One read for every way in — the This week strip on Next,
 * Log and Daily's Training card, and "next" (useNextTrainingSession).
 */
export function useTrainingWeek(date?: string): TrainingWeekView {
  const today = useTodayStr()
  const monday = mondayOfStr(date ?? today)
  const sunday = shiftDateStr(monday, 6)
  const from = shiftDateStr(monday, -7)
  const plans = useTrainingPlansByDate(from, sunday)
  const workoutsQ = useHevyWorkoutsRange(from, sunday)
  const templatesQ = useScheduleBlocks()
  const routinesQ = useHevyRoutines()
  const { skips, routineOf } = usePlanContext()
  const workouts = workoutsQ.data
  const templates = templatesQ.data
  const routines = routinesQ.data

  return useMemo(() => {
    const titleOf = new Map((routines ?? []).map(r => [r.id, r.title]))
    const ofPlan = (p: CalendarPlanItem, d: string) => planRoutineId(p) ?? routineOf({ title: p.title, date: d, startHHMM: planStartHHMM(p) })
    const dayOfWorkout = new Map((workouts ?? []).map(w => [w.id, workoutLocalDay(w) || null]))

    const inputs: WeekSessionInput[] = []
    const planOf = new Map<string, CalendarPlanItem>()
    for (let d = from; d <= sunday; d = shiftDateStr(d, 1)) {
      const dayPlans = plans.data.get(d) ?? []
      if (dayPlans.length === 0) continue
      const dayWorkouts = (workouts ?? []).filter(w => workoutLocalDay(w) === d)
      const day = matchDaySessions({ date: d, todayStr: today, plans: dayPlans, workouts: dayWorkouts, hasActivity: false, skips, routineOf: ofPlan })
      const add = (plan: CalendarPlanItem, input: Omit<WeekSessionInput, 'key' | 'title' | 'routineId' | 'date'>) => {
        const routineId = ofPlan(plan, d)
        const key = `${plan.id}@${d}`
        planOf.set(key, plan)
        inputs.push({ key, title: (routineId && titleOf.get(routineId)) || plan.title, routineId, date: d, ...input })
      }
      for (const s of day.sessions) {
        for (const plan of s.plans) add(plan, { status: sessionStatus({ date: d, taskStatus: 'done', taskWorkoutId: s.workout.id, today }), workoutDate: d })
      }
      // A workout of another routine that day that covered none of its plans: it was done instead (a swap, 213).
      const loose = day.sessions.filter(s => s.plans.length === 0 && s.workout.routine_id)
      for (const o of day.openPlans) {
        const routineId = ofPlan(o.plan, d)
        const instead = o.session.open && d <= today ? loose.find(s => s.workout.routine_id !== routineId) : undefined
        add(o.plan, {
          status: o.session,
          workoutDate: o.session.workoutId ? dayOfWorkout.get(o.session.workoutId) ?? null : null,
          insteadTitle: instead ? titleOf.get(instead.workout.routine_id!) ?? instead.workout.title ?? null : null,
        })
      }
    }

    // The program's order: the weekly schedule's training plans by their first weekday (Monday first), then time.
    const order: string[] = []
    for (const t of (templates ?? []).filter(x => x.category === 'training')
      .map(x => ({ x, first: Math.min(...(x.days_of_week ?? []).map(MON_FIRST)) }))
      .sort((a, b) => a.first - b.first || (a.x.start_time ?? '').localeCompare(b.x.start_time ?? ''))) {
      const id = routineOf({ title: t.x.title, date: monday, startHHMM: t.x.start_time?.slice(0, 5) ?? null })
      if (id && !order.includes(id)) order.push(id)
    }

    const trainedToday = (workouts ?? []).some(w => workoutLocalDay(w) === today)
    return {
      week: planWeek({ sessions: inputs, order, today, monday, trainedToday }),
      planOf,
      isLoading: plans.isLoading || workoutsQ.isLoading || templatesQ.isLoading || routinesQ.isLoading,
      isError: plans.isError || workoutsQ.isError,
    }
  }, [plans.data, plans.isLoading, plans.isError, workouts, workoutsQ.isLoading, workoutsQ.isError, templates, templatesQ.isLoading,
    routines, routinesQ.isLoading, skips, routineOf, today, monday, sunday, from])
}
