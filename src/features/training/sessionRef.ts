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

import { matchDaySessions, planStartHHMM, planWorkoutScore } from './components/calendar/calendarSessions'
import { planStatus, type PlanStatus } from './trainingPlanModel'
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import { formatDurationMinutes } from '../../shared/utils/formatDuration'
import type { CalendarPlanItem } from './components/calendar/calendarModel'
import type { HevyWorkout } from './types.hevy'

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

export const SESSION_STATUS_LABEL: Record<PlanStatus, string> = {
  done:     'Done',
  today:    'Today',
  upcoming: 'Upcoming',
  missed:   'Missed',
}

type DayWorkout = Pick<HevyWorkout, 'id' | 'title' | 'routine_id' | 'start_time'>

export type ResolvedSession =
  /** A logged workout, with the plans it covered on its day. */
  | { kind: 'workout'; workoutId: string; plans: CalendarPlanItem[]; openedFromPlan: boolean }
  /** A plan nothing covered. `offSchedule`: the plan's row exists but it no
   *  longer falls on that day (a template whose weekdays were changed). */
  | { kind: 'plan'; plan: CalendarPlanItem; status: PlanStatus; offSchedule: boolean }
  /** The plan is gone (deleted) — nothing to show. */
  | { kind: 'missing' }

/**
 * What the popup shows. `plans` / `workouts` are EVERY plan and workout on
 * `date` (pairing needs them all — a workout can belong to another plan that
 * day). `planRow` is the requested plan built from its own loaded row, used
 * when it isn't among the day's plans; null/undefined = the row is gone.
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
}): ResolvedSession {
  const { workoutId, plan, date, todayStr, plans, workouts, hasActivity, planRow } = input
  const day = matchDaySessions({ date, todayStr, plans, workouts: workouts as HevyWorkout[], hasActivity })

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
  if (planRow) return { kind: 'plan', plan: planRow, status: planStatus(date, todayStr, hasActivity), offSchedule: true }
  return { kind: 'missing' }
}

// ─── Labels ─────────────────────────────────────────────────────────────────

/** "Mon 29.09.2026 · 16:30 · 51m". */
export function sessionWhenLabel(date: string, startHHMM: string | null, minutes: number | null, _todayStr?: string): string {
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
 *  this session (routine or name), "Planned weekly for 18:00" for a recurring
 *  slot, and "In place of ⟳ Upper B · 17:30" when a different session was
 *  done on a planned day. null without plans. */
export function coveredPlanNote(plans: readonly CalendarPlanItem[], workout: DayWorkout): string | null {
  if (plans.length === 0) return null
  return plans.map(p => {
    if (planWorkoutScore(p, workout) === 0) return `In place of ${planLabel(p)}`
    const t = planStartHHMM(p)
    return `Planned${p.kind === 'recurring' ? ' weekly' : ''}${t ? ` for ${t}` : ''}`
  }).join(' · ')
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon, Wed, Fri" (Monday first) / "every day" — a template's weekdays. */
export function weekdaysLabel(days: readonly number[]): string {
  const set = new Set(days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))
  if (set.size === 7) return 'every day'
  return [1, 2, 3, 4, 5, 6, 0].filter(d => set.has(d)).map(d => WEEKDAY_SHORT[d]).join(', ')
}
