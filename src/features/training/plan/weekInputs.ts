// The week's sessions as THE status reads them (sessionState.planWeek), from the rows every view already reads: the
// plans by day (calendarPlans.buildPlansByDate), the workouts, the skips and the routine a plan trains. Pure — one
// builder for the This week strip (useTrainingWeek) and the coach's MISSED line (coachData), so the two never
// disagree (scripts/verify-training-session.cjs).

import { matchDaySessions, planRoutineId, planStartHHMM } from '../components/calendar/calendarSessions'
import { planWeek, sessionStatus, type TrainingWeek, type WeekSessionInput } from './sessionState'
import { workoutLocalDay } from '../workoutDates'
import { trainingProgramOrder } from './nextRule'
import type { CalendarPlanItem } from '../components/calendar/calendarModel'
import type { SkipRecord } from './skippedRoutines'
import type { HevyWorkout } from '../types.hevy'

type WorkoutRow = Pick<HevyWorkout, 'id' | 'title' | 'routine_id' | 'start_time' | 'hevy_created_at'>
/** The routine a plan with no routine id of its own trains (usePlanContext.routineOf: matchRoutineToPlan). */
type RoutineOf = (plan: { title: string; date: string; startHHMM?: string | null }) => string | null

function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday (yyyy-MM-dd) of the week `date` is in. */
export function mondayOfDay(date: string): string {
  return shiftDay(date, -((new Date(`${date}T12:00:00`).getDay() + 6) % 7))
}

/** The program's order (nextRule.trainingProgramOrder, the one copy the server functions mirror). */
export function programOrder(templates: Parameters<typeof trainingProgramOrder>[0], routineOf: RoutineOf, monday: string): string[] {
  return trainingProgramOrder(templates, (title, startHHMM) => routineOf({ title, date: monday, startHHMM }))
}

/** The week of `date` (Monday to Sunday, with last week's sessions still open): `plansByDate` and `workouts` must
 *  cover Monday − 7 to Sunday. `planOf`: the plan behind each session's key (what a chip opens). */
export function buildTrainingWeek(input: {
  date: string
  today: string
  plansByDate: ReadonlyMap<string, readonly CalendarPlanItem[]>
  workouts: readonly WorkoutRow[]
  skips: readonly SkipRecord[]
  routineOf: RoutineOf
  titleOf: ReadonlyMap<string, string>
  templates: Parameters<typeof programOrder>[0]
  program?: readonly string[]
}): { week: TrainingWeek; planOf: Map<string, CalendarPlanItem> } {
  const { today, plansByDate, workouts, skips, routineOf, titleOf } = input
  const monday = mondayOfDay(input.date)
  const sunday = shiftDay(monday, 6)
  const from = shiftDay(monday, -7)
  const ofPlan = (p: CalendarPlanItem, d: string) => planRoutineId(p) ?? routineOf({ title: p.title, date: d, startHHMM: planStartHHMM(p) })
  const dayOfWorkout = new Map(workouts.map(w => [w.id, workoutLocalDay(w) || null]))

  const inputs: WeekSessionInput[] = []
  const planOf = new Map<string, CalendarPlanItem>()
  for (let d = from; d <= sunday; d = shiftDay(d, 1)) {
    const dayPlans = plansByDate.get(d) ?? []
    if (dayPlans.length === 0) continue
    const dayWorkouts = workouts.filter(w => workoutLocalDay(w) === d) as HevyWorkout[]
    const day = matchDaySessions({ date: d, todayStr: today, plans: dayPlans, workouts: dayWorkouts, hasActivity: false, skips, routineOf: ofPlan })
    const add = (plan: CalendarPlanItem, rest: Pick<WeekSessionInput, 'status' | 'workoutDate' | 'insteadTitle'>) => {
      const routineId = ofPlan(plan, d)
      const key = `${plan.id}@${d}`
      planOf.set(key, plan)
      const taskId = plan.timeBlock?.task_id ?? plan.dayTask?.id ?? null
      inputs.push({ key, title: (routineId && titleOf.get(routineId)) || plan.title, routineId, date: d, taskId, ...rest })
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
  const trainedToday = workouts.some(w => workoutLocalDay(w) === today)
  const order = programOrder(input.templates, routineOf, monday)
  return { week: planWeek({ sessions: inputs, order, program: input.program, today, monday, trainedToday }), planOf }
}

/** The coach's MISSED line (213: from the plan's week, the strip's own reading — never a rhythm of its own): this
 *  week's sessions whose day passed and are still to do, and the ones skipped. */
export interface WeekMissed { title: string; date: string; state: 'open' | 'skipped'; countsUntil: string | null; reason: string | null; skippedOver: boolean }
export function weekMissed(week: TrainingWeek, today: string): WeekMissed[] {
  return week.sessions
    .filter(s => s.date < today && (s.mark === 'skipped' || ((s.mark === 'open' || s.mark === 'next') && s.status.open)))
    .map(s => ({
      title: s.title, date: s.date, state: s.mark === 'skipped' ? 'skipped' as const : 'open' as const,
      countsUntil: s.mark === 'skipped' ? null : s.status.countsUntil, reason: s.mark === 'skipped' ? s.status.skipReason : null,
      skippedOver: s.skippedOver,
    }))
}
