import { formatLocalDate, localDayOf } from '../../../../shared/utils/dateUtils'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import type { Tone } from '../../../../shared/ui'
import { workoutLocalDay } from '../../workoutDates'
import { planStatus, type PlanStatus } from '../../trainingPlanModel'
import type { HevyWorkout, StravaActivity } from '../../types.hevy'
import type { TimeBlock, ScheduleBlock } from '../../../daily/types'

// Training calendar data model — the plan/workout/activity shape of one day
// and the pure helpers the week and month views share.

// A calendar "plan" entry is either a real one-off time_blocks row, or a
// PROJECTED occurrence of a recurring schedule_blocks template (e.g. "every
// Mon/Wed/Fri 16:30"), never projected before the template's effective_from
// (projectRecurringBlocksForDay). A recurring occurrence has no row of its
// own, so it carries the REAL schedule_blocks row for editing.
export interface CalendarPlanItem {
  id:    string
  title: string
  kind:  'block' | 'recurring'
  timeBlock?:     TimeBlock
  scheduleBlock?: ScheduleBlock
}

// Local YYYY-MM-DD (avoids the UTC shift that toISOString would introduce)
export const ymd = formatLocalDate

// A plan on a day that has a workout or a Strava activity is DONE — it used
// to show red "missed" right next to that day's green workout.
export const PLAN_TONE: Record<PlanStatus, Tone> = { today: 'warn', upcoming: 'info', done: 'success', missed: 'danger' }
export const WORKOUT_TONE: Tone = 'success'

// Strava stores its UTC start; the day is the LOCAL day it started on.
export function activityDay(a: StravaActivity): string | null {
  return localDayOf(a.start_date)
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function formatDate(date: Date): string {
  return fmtDateEnGB(date, { day: '2-digit', month: 'short' })
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
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plans: CalendarPlanItem[]
}

export function dayDataFor(dateStr: string, date: Date, workouts: HevyWorkout[], activities: StravaActivity[], plansByDate: Map<string, CalendarPlanItem[]>): DayData {
  return {
    date,
    workouts: workouts.filter(w => workoutLocalDay(w) === dateStr),
    activities: activities.filter(a => activityDay(a) === dateStr),
    plans: plansByDate.get(dateStr) ?? [],
  }
}

export function statusOf(day: DayData, todayStr: string): PlanStatus {
  return planStatus(ymd(day.date), todayStr, day.workouts.length > 0 || day.activities.length > 0)
}

export interface ViewProps {
  workouts: HevyWorkout[]
  activities: StravaActivity[]
  plansByDate: Map<string, CalendarPlanItem[]>
  todayStr: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSwitchView: () => void
  onOpenWorkout: (id: string) => void
  onOpenPlan: (p: CalendarPlanItem) => void
}

