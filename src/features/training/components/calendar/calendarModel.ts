import { localDayOf } from '../../../../shared/utils/dateUtils'
import type { Tone } from '../../../../shared/ui'
import { workoutLocalDay } from '../../workoutDates'
import type { SkipRecord } from '../../plan/skippedRoutines'
import type { HevyWorkout, StravaActivity } from '../../types.hevy'
import type { TimeBlock, ScheduleBlock } from '../../../daily/types'
import type { TrainingDayTask } from '../../../daily/api/scheduleApi'
import { matchDaySessions, type DaySession, type OpenPlan } from './calendarSessions'
import { doneElsewhere, plansClosedBy } from '../../sessionRef'

// Training calendar data model — the plan/workout/activity shape of one day.

// A calendar "plan" entry is either a real one-off time_blocks row, or a
// PROJECTED occurrence of a recurring schedule_blocks template (e.g. "every
// Mon/Wed/Fri 16:30"), never projected before the template's effective_from
// (projectRecurringBlocksForDay). A recurring occurrence has no row of its
// own, so it carries the REAL schedule_blocks row (its id is
// '<template id>__<date>', see calendarPlans.ts).
export interface CalendarPlanItem {
  id:    string
  title: string
  kind:  'block' | 'recurring'
  timeBlock?:     TimeBlock
  scheduleBlock?: ScheduleBlock
  /** A projected day that is its repeat's task on its day (156, no slot):
   *  the plan reads as that task says — done, skipped, missed. */
  dayTask?:       TrainingDayTask
}

// A plan a workout covers folds into that workout's entry (calendarSessions);
// a plan left open has THE status of plan/sessionState (SESSION_TONE).
export const WORKOUT_TONE: Tone = 'success'

// Strava stores its UTC start; the day is the LOCAL day it started on.
export function activityDay(a: StravaActivity): string | null {
  return localDayOf(a.start_date)
}

/** Minutes, or null when unknown or zero (a 0-minute workout used to
 *  render a stray "0"). */
export function getWorkoutDuration(w: HevyWorkout): number | null {
  if (!w.start_time || !w.end_time) return null
  const mins = Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60_000)
  return mins > 0 ? mins : null
}

export interface DayData {
  date: Date
  activities: StravaActivity[]
  /** One per Hevy workout, carrying the plans it covered. */
  sessions: DaySession[]
  /** Plans no workout covered. */
  openPlans: OpenPlan[]
}

export function dayDataFor(dateStr: string, date: Date, workouts: HevyWorkout[], activities: StravaActivity[], plansByDate: Map<string, CalendarPlanItem[]>, todayStr: string, skips: readonly SkipRecord[] = [], routineOf?: (plan: CalendarPlanItem, date: string) => string | null): DayData {
  const dayActivities = activities.filter(a => activityDay(a) === dateStr)
  const { sessions, openPlans } = matchDaySessions({
    date: dateStr,
    todayStr,
    plans: plansByDate.get(dateStr) ?? [],
    workouts: workouts.filter(w => workoutLocalDay(w) === dateStr),
    hasActivity: dayActivities.length > 0,
    skips,
    routineOf,
  })
  // A late workout closes its week's open plan (141/167): the plan's day says
  // when it was done and opens that workout; the workout's day says which plan
  // it did (sessionRef — the words every view uses). Read from what the calendar
  // already has: its weeks' workouts and plans.
  const workoutDay = (id: string) => { const w = workouts.find(x => x.id === id); return w ? workoutLocalDay(w) || null : null }
  return {
    date,
    activities: dayActivities,
    sessions: sessions.map(s => ({ ...s, plannedElsewhere: plansClosedBy(s.workout.id, plansByDate, dateStr) })),
    openPlans: openPlans.map(o => ({ ...o, doneByOther: doneElsewhere(o.session, dateStr, workoutDay) })),
  }
}

export function isDayEmpty(day: DayData): boolean {
  return day.sessions.length === 0 && day.openPlans.length === 0 && day.activities.length === 0
}
