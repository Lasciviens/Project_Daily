// One entry per real session on a calendar day — pure and import-free apart
// from type-only imports and the (also pure) title/plan helpers
// (scripts/verify-training-log.cjs).
//
// A planned session and the Hevy workout that fulfilled it used to render as
// two identical rows ("⟳ Lower A" planned + done, and "Lower A · 51m"), and
// tapping the plan opened the schedule editor. Now a plan that a workout
// covers folds into that workout's entry ("planned · done"); only plans
// nothing covers stay separate — missed (past), today or upcoming.

import { normalizeTitle } from '../../plan/nextSession'
import { sessionStatus, type SessionState, type SessionStatus } from '../../plan/sessionState'
import type { SkipRecord } from '../../plan/skippedRoutines'
import { planFacts } from '../../plan/planFacts'
import type { HevyWorkout } from '../../types.hevy'
import type { CalendarPlanItem } from './calendarModel'

export interface DaySession {
  workout: HevyWorkout
  /** The plans this workout covers (usually one; two when the same session
   *  was planned twice — a one-off block and a recurring slot). */
  plans: CalendarPlanItem[]
}

export interface OpenPlan {
  plan: CalendarPlanItem
  /** THE status of the plan (plan/sessionState): its task's (done, skipped,
   *  not logged yet), else the day's (a Strava activity, its routine's skip),
   *  else its date. Never done by a workout that day — that plan would be a
   *  session above. */
  status: SessionState
  session: SessionStatus
}

export interface DaySessions {
  sessions: DaySession[]
  openPlans: OpenPlan[]
}

type WorkoutLike = Pick<HevyWorkout, 'id' | 'title' | 'routine_id' | 'start_time'>

/** The routine a one-off block was planned from (Routines → "Plan routine"
 *  stamps source_type 'training_session' + the routine id). A recurring
 *  template carries only a title. */
export function planRoutineId(p: CalendarPlanItem): string | null {
  const b = p.timeBlock
  return b?.source_type === 'training_session' && b.source_id ? b.source_id : null
}

/** 'HH:MM' the plan starts, or null when it has no time. */
export function planStartHHMM(p: CalendarPlanItem): string | null {
  const t = p.kind === 'recurring' ? p.scheduleBlock?.start_time : p.timeBlock?.start_time
  return t ? t.slice(0, 5) : null
}

/** Local 'HH:MM' the workout started, or null. */
export function workoutStartHHMM(w: Pick<HevyWorkout, 'start_time'>): string | null {
  if (!w.start_time) return null
  const d = new Date(w.start_time)
  if (isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function timeGap(p: CalendarPlanItem, w: WorkoutLike): number {
  const a = minutesOf(planStartHHMM(p))
  const b = minutesOf(workoutStartHHMM(w))
  return a == null || b == null ? Number.POSITIVE_INFINITY : Math.abs(a - b)
}

/** How surely a workout is the planned session: 4 = the workout the
 *  database linked to the plan's task (141), 3 = planned from this workout's
 *  routine, 2 = same title, 1 = one title contains the other ("Push day —
 *  heavy" ⊃ "Push day"), 0 = nothing in common. A plan with a task follows
 *  its task: its linked workout only; a skipped or still-open one pairs with
 *  nothing (the database didn't link a workout to it); one ticked done by
 *  hand may show the day's workout. */
export function planWorkoutScore(p: CalendarPlanItem, w: WorkoutLike): number {
  const block = p.timeBlock
  if (block?.task_id) {
    if (block.task_workout_id) return block.task_workout_id === w.id ? 4 : 0
    if (block.task_status !== 'done') return 0
  }
  const rid = planRoutineId(p)
  if (rid && w.routine_id && rid === w.routine_id) return 3
  const a = normalizeTitle(p.title)
  const b = normalizeTitle(w.title)
  if (!a || !b) return 0
  if (a === b) return 2
  const contains = (outer: string, inner: string) => inner.length >= 3 && (` ${outer} `).includes(` ${inner} `)
  return contains(a, b) || contains(b, a) ? 1 : 0
}

/** Pairs a day's plans with its Hevy workouts:
 *  1. strongest evidence first (routine id > same title > contained title),
 *     nearest start time breaking ties, one plan per workout;
 *  2. a leftover plan that is clearly the SAME session as an already paired
 *     workout (routine or exact title) joins it — the session was planned twice;
 *  3. a leftover plan and a leftover workout on the same (past or current)
 *     day pair by nearest start time: a workout on a planned day covers the
 *     plan, as the calendar always counted it — the entry then says which
 *     plan it replaced;
 *  4. what is left stays a plan: done only when a Strava activity covered
 *     the day, else today / upcoming / missed. */
export function matchDaySessions(input: {
  date: string
  todayStr: string
  plans: readonly CalendarPlanItem[]
  workouts: readonly HevyWorkout[]
  hasActivity: boolean
  /** Skips (training_skips) — a skipped plan reads "Skipped". */
  skips?: readonly SkipRecord[]
  /** 'HH:MM' now, for "Now" on today's plan. */
  nowHHMM?: string
  /** The routine a plan trains when its own row doesn't say (a weekly plan,
   *  matched by its title — usePlanContext), for its routine-week skip. */
  routineOf?: (plan: CalendarPlanItem, date: string) => string | null
}): DaySessions {
  const { date, todayStr, plans, workouts, hasActivity, skips = [], nowHHMM, routineOf } = input
  const planOf = new Map<number, number>()   // plan index → workout index
  const takenWorkouts = new Set<number>()

  const pairs: { p: number; w: number; score: number; gap: number }[] = []
  plans.forEach((plan, p) => workouts.forEach((wo, w) => {
    const score = planWorkoutScore(plan, wo)
    if (score > 0) pairs.push({ p, w, score, gap: timeGap(plan, wo) })
  }))
  pairs.sort((a, b) => b.score - a.score || a.gap - b.gap || a.p - b.p || a.w - b.w)
  for (const pr of pairs) {
    if (planOf.has(pr.p) || takenWorkouts.has(pr.w)) continue
    planOf.set(pr.p, pr.w)
    takenWorkouts.add(pr.w)
  }

  // 2. The same session planned twice.
  for (const pr of pairs) {
    if (planOf.has(pr.p) || pr.score < 2 || !takenWorkouts.has(pr.w)) continue
    planOf.set(pr.p, pr.w)
  }

  // 3. Same-day cover, nearest start first — for a plan with no task (or one
  //    ticked done by hand): a plan with a task is covered only through it
  //    (step 1's link). A future day can't have a workout yet, but the guard
  //    keeps a clock-skewed row from marking one.
  if (date <= todayStr) {
    const left: { p: number; w: number; gap: number }[] = []
    plans.forEach((plan, p) => {
      if (planOf.has(p)) return
      const b = plan.timeBlock
      if (b?.task_id && (b.task_status !== 'done' || b.task_workout_id)) return
      workouts.forEach((wo, w) => { if (!takenWorkouts.has(w)) left.push({ p, w, gap: timeGap(plan, wo) }) })
    })
    left.sort((a, b) => a.gap - b.gap || a.p - b.p || a.w - b.w)
    for (const pr of left) {
      if (planOf.has(pr.p) || takenWorkouts.has(pr.w)) continue
      planOf.set(pr.p, pr.w)
      takenWorkouts.add(pr.w)
    }
  }

  const sessions: DaySession[] = workouts.map(workout => ({ workout, plans: [] }))
  plans.forEach((plan, p) => {
    const w = planOf.get(p)
    if (w != null) sessions[w].plans.push(plan)
  })
  const byStart = (a: string | null, b: string | null) => (a ?? '99:99').localeCompare(b ?? '99:99')
  sessions.sort((a, b) => byStart(workoutStartHHMM(a.workout), workoutStartHHMM(b.workout)) || a.workout.id.localeCompare(b.workout.id))

  // THE status, from the same facts every view builds (plan/planFacts).
  const statusOf = (plan: CalendarPlanItem): SessionStatus => {
    const b = plan.timeBlock
    return sessionStatus(planFacts({
      date, startHHMM: planStartHHMM(plan),
      taskId: b?.task_id ?? null, taskStatus: b?.task_status ?? null,
      taskWorkoutId: b?.task_workout_id ?? null, taskRoutineId: b?.task_routine_id ?? null,
      routineId: planRoutineId(plan) ?? routineOf?.(plan, date) ?? null,
    }, { today: todayStr, nowHHMM, skips, hasActivity }))
  }
  const openPlans: OpenPlan[] = plans
    .filter((_, p) => !planOf.has(p))
    .map(plan => { const session = statusOf(plan); return { plan, status: session.state, session } })
    .sort((a, b) => byStart(planStartHHMM(a.plan), planStartHHMM(b.plan)) || a.plan.id.localeCompare(b.plan.id))

  return { sessions, openPlans }
}
