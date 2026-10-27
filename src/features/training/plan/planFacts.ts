// The facts THE status (sessionState) is computed from, built the same way
// for every view — the session popup, the Log calendar, Daily's agenda and
// Training card. Pure (scripts/verify-training-session.cjs).
//
// Each view used to feed sessionStatus what it happened to have loaded: the
// agenda and the Training card no skips and no Strava, the calendar the
// routine only from a block's source, the popup a title match — so one
// weekly day read skipped in the popup and missed on the Training card
// (owner review, 12.10.2026).

import type { TaskStatus } from '../../todo/types'
import type { SessionFacts } from './sessionState'
import { skipForPlan, type SkipRecord } from './skippedRoutines'

export interface PlanRowFacts {
  /** The day it is planned for (yyyy-MM-dd). */
  date: string
  startHHMM?: string | null
  minutes?: number | null
  /** Its task, when it has one (a block's task_id, or the task itself). */
  taskId?: string | null
  taskStatus?: TaskStatus | null
  taskWorkoutId?: string | null
  taskRoutineId?: string | null
  /** A repeat's day closed as missed (156: closed_reason 'missed') — not a skip. */
  taskMissed?: boolean
  /** Its task's first day (167): a late workout counts only inside its week. */
  firstDate?: string | null
  /** The routine its own row names (a block's training_session source) or a
   *  title match finds (usePlanContext.routineOf) — for a plan with no task. */
  routineId?: string | null
}

export interface PlanDayContext {
  today: string
  nowHHMM?: string
  skips: readonly SkipRecord[]
  /** A Strava activity on the plan's day. */
  hasActivity?: boolean
  /** The workout the day's pairing gave a plan with no task. */
  dayWorkoutId?: string | null
}

/** One plan's facts — its task first, then its routine's week skip, the day's
 *  workout and Strava (sessionState decides what each one counts for). */
export function planFacts(row: PlanRowFacts, ctx: PlanDayContext): SessionFacts & { skipId: string | null; routineId: string | null } {
  const taskStatus = row.taskId ? row.taskStatus ?? 'open' : null
  const routineId = row.taskRoutineId ?? row.routineId ?? null
  const skip = skipForPlan(ctx.skips, { taskId: row.taskId ?? null, taskCancelled: taskStatus === 'cancelled' && !row.taskMissed, routineId, date: row.date })
  return {
    date: row.date,
    startHHMM: row.startHHMM ?? null,
    minutes: row.minutes ?? null,
    taskStatus,
    taskWorkoutId: row.taskWorkoutId ?? null,
    taskRoutineId: row.taskRoutineId ?? null,
    taskMissed: !!row.taskMissed,
    firstDate: row.firstDate ?? null,
    dayWorkoutId: taskStatus === null ? ctx.dayWorkoutId ?? null : null,
    activityOnDay: !!ctx.hasActivity,
    skipReason: skip?.reason ?? null,
    skipped: !!skip,
    today: ctx.today,
    nowHHMM: ctx.nowHHMM,
    skipId: !row.taskId ? skip?.id ?? null : null,
    routineId,
  }
}
