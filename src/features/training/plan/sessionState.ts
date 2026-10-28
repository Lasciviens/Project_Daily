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
import { OPEN_STATUSES } from '../../todo/taskRules'
import type { Tone } from '../../../shared/ui/Tone'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'

/** How many days after its planned day a workout still completes an open
 *  plan — migration 141's training_plan_candidates (p_day - 6) — and never
 *  past its week: its first day and the next six (167). */
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
  /** The task is a repeat's day closed because it passed unticked (156:
   *  cancelled + closed_reason 'missed') — not a skip: read as a past open
   *  plan (a late workout still completes it). */
  taskMissed?: boolean
  /** Its task's first day (167, tasks.first_plan_date): its week is that day
   *  and the next six; a moved session's late workout counts only inside it. */
  firstDate?: string | null
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
  /** A skipped session (its task cancelled) whose week is over — its first
   *  day + 7 is today or earlier (167): reopened, the hourly job would skip it
   *  again ("Not done within 7 days"), so its skip can't be undone. */
  weekOver: boolean
}

const OPEN_TASK: ReadonlySet<TaskStatus> = new Set(OPEN_STATUSES)

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
  weekOver: false,
  ...extra,
})

export function sessionStatus(f: SessionFacts): SessionStatus {
  // A day closed as missed (156) was never skipped: it reads as a past plan
  // still open (Not logged yet while a late workout can complete it, then Missed).
  const task = f.taskStatus === 'cancelled' && f.taskMissed ? 'open' : f.taskStatus ?? null
  if (task === 'done') {
    const workoutId = f.taskWorkoutId ?? f.dayWorkoutId ?? null
    return status('done', { doneBy: workoutId ? 'workout' : 'hand', workoutId })
  }
  if (task === 'cancelled') return status('skipped', { skipReason: f.skipReason ?? null, weekOver: weekIsOver(f.firstDate ?? f.date, f.today) })
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
  // Only a plan with a routine can still be closed by a later workout, and
  // only inside its week (167): after it the database skips it.
  const lastOfDay = shiftDay(f.date, LATE_WINDOW_DAYS)
  const lastOfWeek = f.firstDate ? shiftDay(f.firstDate, LATE_WINDOW_DAYS) : lastOfDay
  const until = lastOfWeek < lastOfDay ? lastOfWeek : lastOfDay
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
  // A skipped session moved to today or later inside its week is to do again (167).
  // After its week, Undo skip would only reopen it until the hourly job skips
  // it again; Move plans it in the week of the new day (training_move_past_week).
  if (s.state === 'skipped') return !plan.hasTask ? ['undoSkip'] : s.weekOver ? ['move', 'edit', 'delete'] : ['undoSkip', 'move', 'edit', 'delete']
  if (s.state === 'done') {
    if (!plan.hasTask) return plan.weekly ? [] : ['delete']
    return s.doneBy === 'hand' ? ['reopen', 'edit', 'delete'] : ['edit', 'delete']
  }
  return plan.weekly ? ['done', 'move', 'skip'] : ['done', 'move', 'skip', 'edit', 'delete']
}

/** A session's week is over on `today`: its first day + 7 is today or earlier
 *  (167: the hourly job skips one still to do then — training_weeks_close) —
 *  the same day from which a move leaves its week. */
export function weekIsOver(firstDay: string | null | undefined, today: string): boolean {
  return movesPastWeek(firstDay, today)
}

/** A session's week is its first day and the next six (167). A move to a day
 *  7 or more days after its first day skips it there, and that week's session
 *  of the same plan moves to the day instead (the database does it,
 *  training_move_past_week). True when `to` is such a day. */
export function movesPastWeek(firstDay: string | null | undefined, to: string): boolean {
  return !!firstDay && to >= shiftDay(firstDay, 7)
}

/** What such a move did — the result line of Move and of the session's editor. */
export function pastWeekMoveLine(title: string, to: string): string {
  return `Skipped in its week · that week's ${title} moved to ${formatWeekdayDate(to)}`
}

/** Monday (yyyy-MM-dd) of the week `date` falls in — the key a skip is
 *  stored under (112: the week the session was due). */
export function weekStartOf(date: string): string {
  const back = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  return shiftDay(date, -back)
}
