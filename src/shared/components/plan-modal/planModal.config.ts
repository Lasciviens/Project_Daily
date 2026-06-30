// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — CONFIG RESOLUTION & PURE HELPERS
//  No React here. Everything is a pure function so it can be unit-tested and
//  reused. Visual/behavioural defaults live here, NOT scattered in the modal.
// ─────────────────────────────────────────────────────────────────────────────

import { format, addDays, parseISO, isToday, isTomorrow } from 'date-fns'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { TaskSection } from '../../../features/todo/types'
import type {
  PlanModalConfig, PlanTab, ScheduleField, TaskField, RecurrenceMode,
} from './planModal.types'

// ── Static presets ────────────────────────────────────────────────────────────

export const DURATION_PRESETS = [30, 60, 90, 120, 180] as const

export const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  daily:    'Daily',
  training: 'Training',
  media:    'Media',
  games:    'Games',
  work:     'Work',
  projects: 'Projects',
  other:    'Other',
}

export const RECURRENCE_OPTIONS: { value: RecurrenceMode; label: string }[] = [
  { value: 'none',     label: 'No repeat' },
  { value: 'daily',    label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly',   label: 'Weekly' },
]

export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const   // 0=Sun … 6=Sat
export const WEEKDAYS   = [1, 2, 3, 4, 5]
export const EVERY_DAY  = [0, 1, 2, 3, 4, 5, 6]

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

// ── Date / time string helpers ────────────────────────────────────────────────

export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function tomorrowStr(): string {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd')
}

/** "26.06.2026 Fri" — the app-wide compact date format for this modal. */
export function displayDate(iso: string): string {
  try {
    return format(parseISO(iso), 'dd.MM.yyyy EEE')
  } catch {
    return iso
  }
}

export function stepDate(iso: string, dir: 1 | -1): string {
  try {
    return format(addDays(parseISO(iso), dir), 'yyyy-MM-dd')
  } catch {
    return iso
  }
}

/** Shift an HH:MM time by a signed number of minutes, wrapping within a day. */
export function shiftTime(hhmm: string, deltaMin: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total  = ((h * 60 + m + deltaMin) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** End time = start + duration, used when creating recurring schedule blocks. */
export function endTimeFrom(startHHMM: string, durationMin: number): string {
  return shiftTime(startHHMM, durationMin)
}

/** Map an arbitrary date to the right To-Do section. */
export function sectionForDate(iso: string): TaskSection {
  try {
    const d = parseISO(iso)
    if (isToday(d))    return 'today'
    if (isTomorrow(d)) return 'tomorrow'
    return 'this_week'
  } catch {
    return 'today'
  }
}

/** Resolve a recurrence mode + explicit weekly days into the days_of_week array. */
export function daysForRecurrence(mode: RecurrenceMode, weeklyDays: number[]): number[] {
  if (mode === 'daily')    return EVERY_DAY
  if (mode === 'weekdays') return WEEKDAYS
  if (mode === 'weekly')   return weeklyDays.length ? weeklyDays : WEEKDAYS
  return []
}

// ── Config resolution ─────────────────────────────────────────────────────────

export function resolveTabs(config?: PlanModalConfig): PlanTab[] {
  const tabs = config?.tabs && config.tabs.length ? config.tabs : (['schedule', 'task'] as PlanTab[])
  return tabs
}

export function resolveDefaultTab(config: PlanModalConfig | undefined, tabs: PlanTab[]): PlanTab {
  if (config?.defaultTab && tabs.includes(config.defaultTab)) return config.defaultTab
  return tabs[0]
}

export function isScheduleFieldHidden(field: ScheduleField, config?: PlanModalConfig): boolean {
  return !!config?.hideScheduleFields?.includes(field)
}

export function isScheduleFieldLocked(field: ScheduleField, config?: PlanModalConfig): boolean {
  return !!config?.lockScheduleFields?.includes(field)
}

export function isTaskFieldHidden(field: TaskField, config?: PlanModalConfig): boolean {
  return !!config?.hideTaskFields?.includes(field)
}

export function isTaskFieldLocked(field: TaskField, config?: PlanModalConfig): boolean {
  return !!config?.lockTaskFields?.includes(field)
}
