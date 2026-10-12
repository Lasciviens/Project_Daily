// THE status of one planned training session, and what can be done with it.
// Pure: type-only imports plus other pure modules
// (scripts/verify-training-session.cjs).
//
// Before this (owner, 12.10.2026: "the same modal does one thing on one page
// and another thing on another page") seven places decided a plan's status
// on their own: the session popup and the Log calendar (any workout or Strava
// activity that day = done, else missed by date alone), Daily's Training card,
// the task list (task status), the Missed-sessions card, the Hevy list and
// the database. A Sunday plan whose task was still open — and which a
// Monday workout would still close (141's six-day window) — showed "Missed"
// in the popup and "open" in the task list. Now every view asks this module.
//
// The task, when the plan has one, is the truth: done is done (by its linked
// workout, else by hand), cancelled is skipped (its skip carries the reason,
// migration 142). A plan with no task (a day of a weekly plan nobody acted
// on yet) is read from what happened that day: a paired workout, a Strava
// activity, a skip of that routine's week.

import type { TaskStatus } from '../../todo/types'
import type { Tone } from '../../../shared/ui/Tone'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'

/** How many days after its planned day a workout still completes an open
 *  plan — migration 141's training_plan_candidates (p_day - 6). */
export const LATE_WINDOW_DAYS = 6

export type SessionState =
  | 'upcoming'   // planned for a later day
  | 'today'      // planned for today, not logged yet
  | 'now'        // today, inside its planned time
  | 'pending'    // past, still open, and a workout within LATE_WINDOW_DAYS still completes it
  | 'done'
  | 'skipped'
  | 'missed'

export type DoneBy = 'workout' | 'hand' | 'activity'

export interface SessionFacts {
  /** The day the session is planned for (yyyy-MM-dd). */
  date: string
  /** 'HH:MM' it starts, when it has a time. */
  startHHMM?: string | null
  /** Planned length in minutes. */
  minutes?: number | null
  /** The plan's task status; null/undefined = the plan has no task. */
  taskStatus?: TaskStatus | null
  /** tasks.hevy_workout_id — the workout the database linked to it (141). */
  taskWorkoutId?: string | null
  /** tasks.hevy_routine_id — only a plan with a routine can be completed by
   *  a LATER workout (141 pairs a late workout by its routine). */
  taskRoutineId?: string | null
  /** A workout on the planned day that the day's pairing gave a plan with
   *  NO task (a plan with a task is done only through its task: 141 links
   *  the workout and closes it). */
  dayWorkoutId?: string | null
  /** A Strava activity on the planned day. */
  activityOnDay?: boolean
  /** The reason of the skip that covers this plan (its task's, or — for a
   *  plan with no task — its routine's week); undefined when not skipped. */
  skipReason?: string | null
  /** Whether a skip covers this plan (a skip's reason can't be empty). */
  skipped?: boolean
  today: string
  /** 'HH:MM' now — only needed to tell 'now' from 'today'. */
  nowHHMM?: string
}

export interface SessionStatus {
  state: SessionState
  doneBy: DoneBy | null
  /** The workout that did it, when known. */
  workoutId: string | null
  /** 'pending': the last day a workout still completes it. */
  countsUntil: string | null
  skipReason: string | null
  /** Still to do: done / move / skip apply. */
  open: boolean
}

const OPEN_TASK: ReadonlySet<TaskStatus> = new Set(['open', 'in_progress', 'waiting'])

function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const toMinutes = (hhmm: string | null | undefined): number | null => {
  if (!hhmm) return null
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

const status = (state: SessionState, extra: Partial<SessionStatus> = {}): SessionStatus => ({
  state, doneBy: null, workoutId: null, countsUntil: null, skipReason: null,
  open: state === 'upcoming' || state === 'today' || state === 'now' || state === 'pending' || state === 'missed',
  ...extra,
})

export function sessionStatus(f: SessionFacts): SessionStatus {
  const task = f.taskStatus ?? null
  if (task === 'done') {
    const workoutId = f.taskWorkoutId ?? f.dayWorkoutId ?? null
    return status('done', { doneBy: workoutId ? 'workout' : 'hand', workoutId })
  }
  if (task === 'cancelled') return status('skipped', { skipReason: f.skipReason ?? null })
  // A plan with no task is covered by a workout that day; one with a task is
  // done only through its task (the database links the workout and closes
  // it, 141) — so the task row, the calendar and the popup never disagree.
  if (task === null && f.dayWorkoutId) return status('done', { doneBy: 'workout', workoutId: f.dayWorkoutId })
  if (task === null && (f.skipped || f.skipReason)) return status('skipped', { skipReason: f.skipReason ?? null })
  // Strava only stands in for a plan with no task: an open task is the
  // truth, and only a workout or a tick closes it.
  if (task === null && f.activityOnDay && f.date <= f.today) return status('done', { doneBy: 'activity' })

  if (f.date > f.today) return status('upcoming')
  if (f.date === f.today) {
    const start = toMinutes(f.startHHMM)
    const now = toMinutes(f.nowHHMM)
    if (start != null && now != null && now >= start && now < start + Math.max(1, f.minutes ?? 60)) return status('now')
    return status('today')
  }
  // Only a plan with a routine can still be closed by a later workout.
  const until = shiftDay(f.date, LATE_WINDOW_DAYS)
  if (task !== null && OPEN_TASK.has(task) && f.taskRoutineId && f.today <= until) return status('pending', { countsUntil: until })
  return status('missed')
}

// ── Words and colours (every view uses these) ──────────────────────────────

export const SESSION_LABEL: Record<SessionState, string> = {
  upcoming: 'Upcoming',
  today:    'Today',
  now:      'Now',
  pending:  'Not logged yet',
  done:     'Done',
  skipped:  'Skipped',
  missed:   'Missed',
}

export const SESSION_TONE: Record<SessionState, Tone> = {
  upcoming: 'info',
  today:    'warn',
  now:      'accent',
  pending:  'warn',
  done:     'success',
  skipped:  'neutral',
  missed:   'danger',
}

/** The one sentence beside the status pill, or null. `routineTitle` names
 *  the routine a late workout must be ("A Lower B workout until …"). */
export function sessionNote(s: SessionStatus, routineTitle?: string | null): string | null {
  switch (s.state) {
    case 'pending':
      return `${routineTitle ? `A ${routineTitle} workout` : 'A workout'} until ${formatWeekdayDate(s.countsUntil)} still counts.`
    case 'done':
      return s.doneBy === 'hand' ? 'Marked done by hand.' : s.doneBy === 'activity' ? 'A Strava activity covered that day.' : null
    case 'skipped':
      return s.skipReason ? `Skipped: ${s.skipReason.trim()}` : null
    case 'missed':
      return 'Nothing was logged.'
    default:
      return null
  }
}

// ── What can be done with it ────────────────────────────────────────────────

export type SessionAction = 'done' | 'move' | 'skip' | 'reopen' | 'undoSkip' | 'edit' | 'delete'

/**
 * The actions a session offers, in display order. `hasTask`: the plan has a
 * task. `weekly`: a day of a weekly plan nobody acted on yet (no row of its
 * own — acting on it first makes it a plan of its own; the weekly plan's own
 * edit/delete are separate menu items). Done by a workout can't be reopened
 * here: the workout would close it again on the next sync.
 */
export function sessionActions(s: SessionStatus, plan: { hasTask: boolean; weekly: boolean }): SessionAction[] {
  if (s.state === 'skipped') return plan.hasTask ? ['undoSkip', 'edit', 'delete'] : ['undoSkip']
  if (s.state === 'done') {
    if (!plan.hasTask) return plan.weekly ? [] : ['delete']
    return s.doneBy === 'hand' ? ['reopen', 'edit', 'delete'] : ['edit', 'delete']
  }
  return plan.weekly ? ['done', 'move', 'skip'] : ['done', 'move', 'skip', 'edit', 'delete']
}

/** Monday (yyyy-MM-dd) of the week `date` falls in — the key a skip is
 *  stored under (112: the week the session was due). */
export function weekStartOf(date: string): string {
  const back = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  return shiftDay(date, -back)
}
