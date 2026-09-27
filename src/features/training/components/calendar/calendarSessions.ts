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
import { planStatus, type PlanStatus } from '../../trainingPlanModel'
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
  /** Never 'done' via a Hevy workout (that plan would be a session) — only
   *  via a Strava activity that day. */
  status: PlanStatus
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

/** How surely a workout is the planned session: 3 = planned from this
 *  workout's routine, 2 = same title, 1 = one title contains the other
 *  ("Push day — heavy" ⊃ "Push day"), 0 = nothing in common. */
export function planWorkoutScore(p: CalendarPlanItem, w: WorkoutLike): number {
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
}): DaySessions {
  const { date, todayStr, plans, workouts, hasActivity } = input
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

  // 3. Same-day cover, nearest start first. A future day can't have a
  //    workout yet, but the guard keeps a clock-skewed row from marking one.
  if (date <= todayStr) {
    const left: { p: number; w: number; gap: number }[] = []
    plans.forEach((plan, p) => {
      if (planOf.has(p)) return
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

  const status = planStatus(date, todayStr, hasActivity)
  const openPlans: OpenPlan[] = plans
    .filter((_, p) => !planOf.has(p))
    .map(plan => ({ plan, status }))
    .sort((a, b) => byStart(planStartHHMM(a.plan), planStartHHMM(b.plan)) || a.plan.id.localeCompare(b.plan.id))

  return { sessions, openPlans }
}

/** "planned · done" when the workout is the plan by name or routine, else
 *  "Planned: <plan title>" so a swapped session says what it replaced. */
export function sessionPlanNote(s: DaySession): string | null {
  if (s.plans.length === 0) return null
  const other = s.plans.find(p => planWorkoutScore(p, s.workout) === 0)
  return other ? `Planned: ${other.title}` : 'Planned · done'
}
