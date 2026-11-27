// One training session — a logged Hevy workout, or a planned session (a
// one-off training block, or one occurrence of a recurring template) —
// resolved from what the `training-session` popup was asked to open. Pure:
// type-only imports plus other pure modules (scripts/verify-training-log.cjs).
//
// Every entry point (Log, Next, Daily's agenda and Training card, Home) opens
// the SAME popup with ids only. A plan that a workout already covered opens
// as that workout ("Planned as ⟳ Lower A"), by the one pairing rule the
// calendar uses (calendarSessions.matchDaySessions) — so tapping a done plan
// shows what was lifted, never the plan's schedule form. Changing the plan is
// a deliberate second step (the popup's ⋯ menu).

import { matchDaySessions, planStartHHMM, planTaskOf, planWorkoutScore } from './components/calendar/calendarSessions'
import { doneShift, doneWord, sessionStatus, SESSION_LABEL, type SessionState, type SessionStatus } from './plan/sessionState'
import { formatDate, formatWeekdayDate } from '../../shared/utils/dateFormat'
import { repeatSummary } from '../daily/recurrence'
import { formatDurationMinutes } from '../../shared/utils/formatDuration'
import type { CalendarPlanItem } from './components/calendar/calendarModel'
import type { HevyWorkout } from './types.hevy'
import type { PlanTarget } from './api/trainingPlanApi'
import type { ItemScreenRequest } from '../../shared/components/plan-modal/PlanEntityModals'

/** The item screen's request for a planned session (owner's answer 2, the popup's Edit tab): its task (a repeat's day
 *  opens as This day | All days), its block, or the weekly plan on that day, This day picked (this one session; All
 *  days is the whole schedule) — the same kinds the popups open. */
export function sessionItemRequest(target: PlanTarget): ItemScreenRequest {
  if (target.kind === 'task') return { kind: 'task', id: target.taskId }
  if (target.kind === 'block') return { kind: 'time-block', id: target.blockId }
  return { kind: 'schedule-block', id: target.templateId, occurrenceDate: target.date, startScope: 'day', defaults: { date: target.date } }
}

/** A planned session by id. A recurring occurrence has no row of its own, so
 *  the day it falls on is part of its identity. */
export interface SessionPlanRef {
  kind: 'block' | 'recurring'
  /** time_blocks id ('block') or schedule_blocks id ('recurring'). */
  id: string
  /** The day it falls on (yyyy-MM-dd). A block's own date wins when loaded. */
  date: string
}

/** The id a plan carries on a calendar day: a one-off block's own id, a
 *  recurring occurrence's '<template id>__<date>'. */
export function planItemId(ref: SessionPlanRef): string {
  return ref.kind === 'recurring' ? `${ref.id}__${ref.date}` : ref.id
}

/** The request ref for a calendar plan entry that falls on `date`. */
export function planRefOf(item: CalendarPlanItem, date: string): SessionPlanRef | null {
  if (item.kind === 'recurring') return item.scheduleBlock ? { kind: 'recurring', id: item.scheduleBlock.id, date } : null
  return item.timeBlock ? { kind: 'block', id: item.timeBlock.id, date: item.timeBlock.date } : null
}

/**
 * What a planned-training task opens as (migration 141): its workout once
 * one is linked, else its block on the calendar, else nothing to anchor to
 * (null — the popup shows the task's routine and offers to set a time).
 */
export function sessionForTask(
  task: { hevy_workout_id?: string | null },
  block: { id: string; date: string } | null,
): { workoutId: string } | { plan: SessionPlanRef } | null {
  if (task.hevy_workout_id) return { workoutId: task.hevy_workout_id }
  if (block) return { plan: { kind: 'block', id: block.id, date: block.date } }
  return null
}

type DayWorkout = Pick<HevyWorkout, 'id' | 'title' | 'routine_id' | 'start_time'>

export type ResolvedSession =
  /** A logged workout, with the plans it covered on its day. */
  | { kind: 'workout'; workoutId: string; plans: CalendarPlanItem[]; openedFromPlan: boolean }
  /** A plan nothing covered. `offSchedule`: the plan's row exists but it no
   *  longer falls on that day (a template whose weekdays were changed). */
  | { kind: 'plan'; plan: CalendarPlanItem; status: SessionState; offSchedule: boolean }
  /** The plan is gone (deleted) — nothing to show. */
  | { kind: 'missing' }

/**
 * What the popup shows. `plans` / `workouts` are EVERY plan and workout on
 * `date` (pairing needs them all — a workout can belong to another plan that
 * day). `planRow` is the requested plan built from its own loaded row, used
 * when it isn't among the day's plans; null/undefined = the row is gone.
 * `routineOf`: the routine a plan with none of its own trains (a weekly plan,
 * by its title — the calendar's own, usePlanContext), so another routine's
 * workout never stands in for it (167).
 */
export function resolveTrainingSession(input: {
  workoutId?: string | null
  plan?: SessionPlanRef | null
  date: string
  todayStr: string
  plans: readonly CalendarPlanItem[]
  workouts: readonly DayWorkout[]
  hasActivity: boolean
  planRow?: CalendarPlanItem | null
  routineOf?: (plan: CalendarPlanItem, date: string) => string | null
}): ResolvedSession {
  const { workoutId, plan, date, todayStr, plans, workouts, hasActivity, planRow, routineOf } = input
  const day = matchDaySessions({ date, todayStr, plans, workouts: workouts as HevyWorkout[], hasActivity, routineOf })

  if (workoutId) {
    const session = day.sessions.find(s => s.workout.id === workoutId)
    return { kind: 'workout', workoutId, plans: session?.plans ?? [], openedFromPlan: false }
  }
  if (!plan) return { kind: 'missing' }

  const id = planItemId(plan)
  const covering = day.sessions.find(s => s.plans.some(p => p.id === id))
  if (covering) return { kind: 'workout', workoutId: covering.workout.id, plans: covering.plans, openedFromPlan: true }
  const open = day.openPlans.find(o => o.plan.id === id)
  if (open) return { kind: 'plan', plan: open.plan, status: open.status, offSchedule: false }
  if (planRow) {
    const task = planTaskOf(planRow)
    const status = sessionStatus({
      date, taskStatus: task ? task.status : null, taskMissed: task?.missed ?? false, taskRoutineId: task?.routineId ?? null,
      taskWorkoutId: task?.workoutId ?? null, firstDate: task?.firstDate ?? null, activityOnDay: hasActivity, today: todayStr,
    }).state
    return { kind: 'plan', plan: planRow, status, offSchedule: true }
  }
  return { kind: 'missing' }
}

// ─── Labels ─────────────────────────────────────────────────────────────────

/** "Mon 29.09.2026 · 16:30 · 51m". */
export function sessionWhenLabel(date: string, startHHMM: string | null, minutes: number | null): string {
  const day = formatWeekdayDate(date)
  return [day, startHHMM, minutes != null && minutes > 0 ? formatDurationMinutes(minutes) : null].filter(Boolean).join(' · ')
}

/** Planned length in minutes: a block's own duration, a template's start →
 *  end (across midnight when it ends earlier than it starts). */
export function planMinutes(p: CalendarPlanItem): number | null {
  if (p.kind === 'block') return p.timeBlock?.duration_minutes ?? null
  const s = p.scheduleBlock
  if (!s?.start_time || !s.end_time) return null
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  let mins = toMin(s.end_time) - toMin(s.start_time)
  if (mins <= 0) mins += 24 * 60
  return Number.isFinite(mins) ? mins : null
}

/** "⟳ Lower A · 16:30" — a plan's name with its time. */
export function planLabel(p: CalendarPlanItem): string {
  const t = planStartHHMM(p)
  return `${p.kind === 'recurring' ? '⟳ ' : ''}${p.title}${t ? ` · ${t}` : ''}`
}

/** What a workout's plans say under it: "Planned for 18:00" when the plan is
 *  this session (routine or name), "Planned every week on Mon, 18:00" for a
 *  repeating plan (its own repeat, recurrence.repeatSummary — it may be
 *  monthly or every N weeks), and "In place of ⟳ Upper B · 17:30" when a
 *  different session was done on a planned day. A plan of an earlier day this
 *  workout closed (`elsewhere`, plansClosedBy) reads "Planned for 24.11.2026
 *  16:45". null without plans. */
export function coveredPlanNote(plans: readonly CalendarPlanItem[], workout: DayWorkout, elsewhere: readonly PlanOnDay[] = []): string | null {
  if (plans.length === 0 && elsewhere.length === 0) return null
  return [
    ...plans.map(p => {
      if (planWorkoutScore(p, workout) === 0) return `In place of ${planLabel(p)}`
      const t = planStartHHMM(p)
      if (p.kind === 'recurring' && p.scheduleBlock) {
        const summary = repeatSummary(p.scheduleBlock)
        return `Planned ${summary.charAt(0).toLowerCase()}${summary.slice(1)}${t ? `, ${t}` : ''}`
      }
      return `Planned${t ? ` for ${t}` : ''}`
    }),
    ...elsewhere.map(plannedOnNote),
  ].join(' · ')
}

// ─── A plan closed by a workout on another day ──────────────────────────────
// A late workout completes its week's open plan (141/167; 211's
// hevy_workout_completes_plan): the plan's day then reads done, but nothing was
// trained on it. Owner, 27.11.2026, on a Log day showing "⟳ Lower A … 16:45 ·
// Done" beside that day's Upper A: "2 training on one day?" — "this was done on
// 26.11". Every view (the Log, Daily's row and Training card, the session popup)
// says it with these words: the plan's day "Done 26.11.2026" (a tap opens that
// workout), the workout's day "Planned for 24.11.2026 16:45".

/** A plan with the day it falls on. */
export interface PlanOnDay { plan: CalendarPlanItem; date: string }

/** The workout that closed a plan on another day than the plan's own, that
 *  workout's local day, and how many days from the plan's (+ late, − early). */
export interface DoneElsewhere { workoutId: string; date: string; shift: number }

/** The workout that closed this plan when it was done on another day, else null
 *  (not done by a workout, or done on its own day). `workoutDay`: the workout's
 *  local day by id, or null when it isn't among what was read — then it is null
 *  too (treated as not elsewhere), so a view doesn't flip once the day loads. */
export function doneElsewhere(
  status: Pick<SessionStatus, 'state' | 'doneBy' | 'workoutId'>,
  planDate: string,
  workoutDay: (workoutId: string) => string | null | undefined,
): DoneElsewhere | null {
  if (status.state !== 'done' || status.doneBy !== 'workout' || !status.workoutId) return null
  const date = workoutDay(status.workoutId) ?? null
  return date == null || date === planDate ? null : { workoutId: status.workoutId, date, shift: doneShift(planDate, date) ?? 0 }
}

/** The status word of a plan: "Done 26.11.2026 · 2 days late" when a workout
 *  on another day closed it (sessionState.doneWord), else THE status word
 *  (SESSION_LABEL). */
export function planStateWord(state: SessionState, elsewhere: DoneElsewhere | null): string {
  return state === 'done' && elsewhere?.date ? doneWord(elsewhere.shift, elsewhere.date) : SESSION_LABEL[state]
}

/** "Planned for 24.11.2026 16:45" — a plan of another day that a workout closed. */
export function plannedOnNote({ plan, date }: PlanOnDay): string {
  const t = planStartHHMM(plan)
  return `Planned for ${formatDate(date)}${t ? ` ${t}` : ''}`
}

/** The plans of OTHER days than `day` that this workout closed (their task's
 *  workout, 141) — oldest first. */
export function plansClosedBy(workoutId: string, plansByDate: ReadonlyMap<string, readonly CalendarPlanItem[]>, day: string): PlanOnDay[] {
  const out: PlanOnDay[] = []
  for (const [date, plans] of plansByDate) {
    if (date === day) continue
    for (const plan of plans) if (planTaskOf(plan)?.workoutId === workoutId) out.push({ plan, date })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.plan.id.localeCompare(b.plan.id))
}

