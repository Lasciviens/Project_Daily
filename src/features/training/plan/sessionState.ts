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
import { formatDate, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { pickNextCandidate } from './nextRule'

/** How many days after its planned day a workout still completes an open
 *  plan — migration 141's training_plan_candidates (p_day - 6) — and never
 *  past its week: its first day and the next six (167, the owner's rule: the
 *  outer limit). */
export const LATE_WINDOW_DAYS = 6
/** How many days before its planned day a workout of its routine completes it
 *  (213, science.md S20: ±2 days counts as that session, "moved"). A swap —
 *  done on a day another program routine was planned — reaches 3–6 days. */
export const EARLY_WINDOW_DAYS = 2

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
  pending:  'Still open',
  done:     'Done',
  skipped:  'Skipped',
  missed:   'Missed',
}

// Missed or still open is never a warning (owner, 27.11.2026, the sessions
// proposal; science.md S21/S27: a missed session costs nothing measurable).
export const SESSION_TONE: Record<SessionState, Tone> = {
  upcoming: 'info',
  today:    'warn',
  now:      'accent',
  pending:  'neutral',
  done:     'success',
  skipped:  'neutral',
  missed:   'neutral',
}

/** The one sentence beside the status pill, or null. `routineTitle` names
 *  the routine a late workout must be ("A Lower B workout until …"). */
export function sessionNote(s: SessionStatus, routineTitle?: string | null): string | null {
  switch (s.state) {
    case 'pending':
      // Beside its "Still open" pill: until when, and what closes it.
      return `Counts until ${formatDate(s.countsUntil)} — ${routineTitle ? `${/^[aeiou]/i.test(routineTitle) ? 'an' : 'a'} ${routineTitle} workout` : 'a workout'} closes it.`
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

/** What a move out of the week did, as the database answered it (167/169):
 *  the session itself stays done or is skipped in its week; that week's
 *  session of the plan moved (or was made) on `to`, or nothing was — that
 *  week's is already done or skipped. Unknown (the read failed): only what is
 *  certain. The result line of Move and of the session's editor. */
export interface PastWeekOutcome { stayedDone: boolean; landed: boolean }
export function pastWeekMoveLine(title: string, to: string, outcome: PastWeekOutcome | null | undefined): string {
  const day = formatWeekdayDate(to)
  if (!outcome) return `Moved 7 or more days: kept in its own week · see ${day} for that week's ${title}`
  const self = outcome.stayedDone ? 'Stays done in its own week' : 'Skipped in its week'
  return outcome.landed
    ? `${self} · that week's ${title} is on ${day}`
    : `${self} · nothing planned on ${day} — that week's ${title} is already done or skipped`
}

/** Monday (yyyy-MM-dd) of the week `date` falls in — the key a skip is
 *  stored under (112: the week the session was due). */
export function weekStartOf(date: string): string {
  const back = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  return shiftDay(date, -back)
}

// ── Done on another day, still open ─────────────────────────────────────────
// A workout completes its session from 2 days before its day to the end of its
// week (213; S20 for the early side, 167's week for the late side).

const dayDiff = (from: string, to: string): number =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)

/** Days between a session's planned day and the day its workout was done:
 *  positive = late, negative = early, 0 = on its day; null when unknown. */
export function doneShift(planDate: string, workoutDate: string | null | undefined): number | null {
  return workoutDate ? dayDiff(planDate, workoutDate) : null
}

/** "Done", "Done · 1 day late", "Done · 2 days early" — with the workout's
 *  day when given: "Done 26.11.2026 · 2 days late" (owner, 27.11.2026: "this
 *  was done on 26.11"). */
export function doneWord(shift: number | null, workoutDate?: string | null): string {
  const done = workoutDate && shift ? `${SESSION_LABEL.done} ${formatDate(workoutDate)}` : SESSION_LABEL.done
  if (!shift) return done
  const n = Math.abs(shift)
  return `${done} · ${n} ${n === 1 ? 'day' : 'days'} ${shift > 0 ? 'late' : 'early'}`
}

/** "+1d" / "−2d" — the shift on a This week chip; '' on its day. */
export function shiftShort(shift: number | null): string {
  return shift ? `${shift > 0 ? '+' : '−'}${Math.abs(shift)}d` : ''
}

/** "Still open — counts until 03.12.2026". */
export function stillOpenLine(countsUntil: string | null): string {
  return countsUntil ? `Still open — counts until ${formatDate(countsUntil)}` : 'Still open'
}

// ── Coming back after a break (science.md S27–S29) ─────────────────────────

/** The note for the next session after `days` without training: none up to 14
 *  days (S27), lighter first sessions for 15–28 (S28), a comeback week after
 *  28 (S29). null when there is nothing to say (or no training at all yet). */
export function gapNote(days: number | null): string | null {
  if (days == null || days <= 14) return null
  if (days <= 28) return 'First 1–2 sessions: same weights, stop 2 reps earlier'
  return 'Comeback week: half the sets, a little lighter — losses come back within a few weeks'
}

// ── This week (owner, 27.11.2026: "Missed sessions, sessions I did but in
//    different days.. What I actually should do") ─────────────────────────────
// One model for the This week strip (Next, Log, Daily's Training card) and
// "Today's call". It reads the sessions as they are stored — owner: "One
// truth! Thats the rule. So if its moved it is moved! It has to stick to the
// real data!" — never a day of its own. Next is the first session still to do:
// one whose day has come first, in the program's order (the weekly schedule's
// day order, S22 — a missed one before today's, S23; today's stays next all
// day), then the later ones by day. Moving the rest of the cycle is the owner's
// choice (owner: "It should be an option not must"): `shiftOffer` says when to
// offer it — a session's day passed undone, or one done early — and the owner's
// tap moves the sessions in the data (213's training_shift_sessions).

export type WeekMark = 'done' | 'next' | 'open' | 'skipped'

export interface WeekSessionInput {
  /** Unique per session (its plan id and day). */
  key: string
  /** Its routine's title, else the plan's. */
  title: string
  /** The routine it trains, when known — its place in the program's order. */
  routineId: string | null
  /** The day it is planned for (yyyy-MM-dd). */
  date: string
  status: SessionStatus
  /** The local day of the workout that completed it, when read. */
  workoutDate?: string | null
  /** Another routine's workout done on its day while it stayed to do — a swap
   *  (213: that workout completed its own session); its title. */
  insteadTitle?: string | null
  /** Its task (the database's id) — what a move names. */
  taskId?: string | null
}

export interface WeekSession extends WeekSessionInput {
  mark: WeekMark
  /** Done: its workout's day minus its planned day. */
  shift: number | null
  /** Still to do, its day passed, and a later session of the week already done (S21). */
  skippedOver: boolean
}

/** Moving the rest of the cycle, offered — never done by itself. `days` > 0:
 *  later (a session's day passed undone); < 0: earlier (one done early). */
export interface ShiftOffer {
  days: number
  /** The session the move starts from (its task is what the database is given). */
  anchor: WeekSession
  /** The sessions of the week that would move, in day order. */
  moving: WeekSession[]
}

export interface TrainingWeek {
  monday: string
  sunday: string
  /** In the program's order (last week's still open first). */
  sessions: WeekSession[]
  next: WeekSession | null
  offer: ShiftOffer | null
}

const STILL_TO_DO: ReadonlySet<SessionState> = new Set(['upcoming', 'today', 'now', 'pending', 'missed'])
/** A move takes the anchor's day and the six after it (213's cycle). */
const CYCLE_DAYS = 6

/** The week of `today`'s sessions. `sessions`: the plans of the week (Monday
 *  to Sunday) and any still open from last week; `order`: routine ids in the
 *  weekly schedule's day order; `program`: the current program's routines (only
 *  their sessions move); `trainedToday`: a workout is already logged today. */
export function planWeek(input: {
  sessions: readonly WeekSessionInput[]
  order: readonly string[]
  program?: readonly string[]
  today: string
  monday: string
  trainedToday: boolean
}): TrainingWeek {
  const { order, today, monday, trainedToday } = input
  const sunday = shiftDay(monday, 6)
  const seq = (s: WeekSessionInput) => { const i = s.routineId ? order.indexOf(s.routineId) : -1; return i < 0 ? order.length : i }
  const byOrder = (a: WeekSessionInput, b: WeekSessionInput) => seq(a) - seq(b) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key)

  // Last week's sessions still open in their week (167) come along.
  const carriedIn = input.sessions.filter(s => s.date < monday && s.status.state === 'pending').sort(byOrder)
  const own = input.sessions.filter(s => s.date >= monday && s.date <= sunday).sort(byOrder)
  const all = [...carriedIn, ...own]
  const toDo = (s: WeekSessionInput) => STILL_TO_DO.has(s.status.state)
  // The one "next" rule (plan/nextRule.ts, mirrored into phone-gateway and push-send).
  const nextIn = today > sunday ? null
    : pickNextCandidate(all.map(s => ({ s, title: s.title, routineId: s.routineId, date: s.date, toDo: toDo(s), countsUntil: s.status.countsUntil ?? (s.date >= today ? s.date : null) })), order, today)?.s ?? null

  const doneSeqAfter = (s: WeekSessionInput) => all.some(o => o !== s && o.status.state === 'done' && seq(o) > seq(s) && o.date >= monday)
  const sessions: WeekSession[] = all.map(s => ({
    ...s,
    mark: s === nextIn ? 'next' : toDo(s) ? 'open' : s.status.state === 'done' ? 'done' : 'skipped',
    shift: s.status.state === 'done' && s.status.doneBy === 'workout' ? doneShift(s.date, s.workoutDate) : null,
    skippedOver: toDo(s) && s.date < today && doneSeqAfter(s),
  }))
  const next = sessions.find(s => s.mark === 'next') ?? null
  return { monday, sunday, sessions, next, offer: shiftOfferOf(sessions, { today, trainedToday, program: input.program }) }
}

/** When to offer moving the rest of the cycle (the database checks the same: training_shift_sessions).
 *  Later: the first program session still to do whose day has passed — not one a later session already passed
 *  over — lands today (tomorrow when today is trained); earlier: a session done today by a workout, days early, with
 *  sessions still to do after it that land today or later. A day a session would land on that holds a done one, or
 *  one that isn't moving, means no offer (never two in one day). */
function shiftOfferOf(sessions: readonly WeekSession[], ctx: { today: string; trainedToday: boolean; program?: readonly string[] }): ShiftOffer | null {
  const inProgram = (s: WeekSession) => !!s.taskId && !!s.routineId && (!ctx.program || ctx.program.includes(s.routineId))
  const toDo = (s: WeekSession) => STILL_TO_DO.has(s.status.state)
  const fits = (moving: WeekSession[], days: number, anchor: WeekSession) => moving.every(m => {
    const to = shiftDay(m.date, days)
    return !sessions.some(o => o !== anchor && !moving.includes(o) && o.date === to && o.status.state !== 'skipped')
  })
  const missed = sessions.filter(s => inProgram(s) && toDo(s) && s.date < ctx.today && !s.skippedOver)
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  if (missed) {
    const days = dayDiff(missed.date, ctx.trainedToday ? shiftDay(ctx.today, 1) : ctx.today)
    const end = shiftDay(missed.date, CYCLE_DAYS)
    const moving = sessions.filter(s => inProgram(s) && toDo(s) && s.date >= missed.date && s.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (days >= 1 && days <= 14 && fits(moving, days, missed)) return { days, anchor: missed, moving }
  }
  const early = sessions.find(s => inProgram(s) && s.status.state === 'done' && s.workoutDate === ctx.today && (s.shift ?? 0) < 0)
  if (early && early.shift != null && early.shift >= -6) {
    const end = shiftDay(early.date, CYCLE_DAYS)
    const moving = sessions.filter(s => inProgram(s) && toDo(s) && s.date > early.date && s.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (moving.length > 0 && moving.every(m => shiftDay(m.date, early.shift!) >= ctx.today) && fits(moving, early.shift, early)) {
      return { days: early.shift, anchor: early, moving }
    }
  }
  return null
}

const dayWord = (n: number) => (Math.abs(n) === 1 ? 'one day' : `${Math.abs(n)} days`)

/** The offer's question and its button's word and description (a short button, THEME: 1–2 words, the full text
 *  in its tooltip and accessible name). */
export function shiftOfferWords(o: ShiftOffer): { question: string; button: string; tip: string } {
  if (o.days > 0) {
    const rest = o.moving.length > 1 ? ' and the rest' : ''
    return {
      question: `${o.anchor.title} wasn't done on ${formatWeekdayDate(o.anchor.date)} — move it${rest} ${dayWord(o.days)} later?`,
      button: 'Move',
      tip: `Move ${o.moving.map(m => m.title).join(', ')} ${dayWord(o.days)} later`,
    }
  }
  return {
    question: `${o.anchor.title} done ${dayWord(o.days).replace('one day', 'a day')} early — pull the rest ${dayWord(o.days)} earlier?`,
    button: 'Pull',
    tip: `Pull ${o.moving.map(m => m.title).join(', ')} ${dayWord(o.days)} earlier`,
  }
}

/** The result line of a move, from what the database answered: "Moved Lower A, Upper B, Lower B one day later". */
export function shiftResultLine(titles: readonly string[], days: number): string {
  if (titles.length === 0) return 'Nothing moved'
  return `Moved ${titles.join(', ')} ${dayWord(days)} ${days > 0 ? 'later' : 'earlier'}`
}

/** A This week chip's short word (after its title): "2d late", "1d early", "next", "swapped", "skipped". */
export function weekChipWord(s: WeekSession): string {
  if (s.mark === 'done') return s.shift ? `${Math.abs(s.shift)}d ${s.shift > 0 ? 'late' : 'early'}` : ''
  if (s.mark === 'skipped') return 'skipped'
  if (s.insteadTitle) return 'swapped'
  return s.mark === 'next' ? 'next' : ''
}

/** A This week chip's words: its status in a few words (the chip's tooltip and accessible name). */
export function weekSessionWord(s: WeekSession): string {
  if (s.mark === 'done') return doneWord(s.shift, s.workoutDate)
  if (s.mark === 'skipped') return s.status.skipReason ? `Skipped: ${s.status.skipReason.trim()}` : SESSION_LABEL.skipped
  const parts = [
    s.mark === 'next' ? 'Next' : null,
    s.insteadTitle ? `Did ${s.insteadTitle} instead` : null,
    s.skippedOver ? 'Skipped over — do it next, don\'t double up' : null,
    s.status.state === 'pending' ? stillOpenLine(s.status.countsUntil) : s.mark === 'next' ? null : SESSION_LABEL[s.status.state],
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Today's call — one plain line at the top of Next, starting with a verb. It
 *  reads the stored days and leaves the day and time to the session's header
 *  under it: "Do Upper B today.", "Do Lower A next — it's still open until
 *  30.11.2026.", "Rest today — Upper B is next.". null when the week has no
 *  sessions. */
export function todaysCall(week: TrainingWeek, today: string): string | null {
  if (week.sessions.length === 0) return null
  const next = week.next
  if (!next) return 'Rest — this week\'s sessions are done.'
  if (next.date < today) {
    return next.status.countsUntil
      ? `Do ${next.title} next — it's still open until ${formatDate(next.status.countsUntil)}.`
      : `Do ${next.title} next.`
  }
  if (next.date === today) return `Do ${next.title} today.`
  return `Rest today — ${next.title} is next.`
}
