// One item: a task, its optional slot (time_blocks) and its optional repeat
// rule (schedule_blocks), saved and shown as one thing (migration 155).
// The shared contract between the data layer and the screens — extend it,
// don't rename. Background: docs/features/tasks.md, planning-calendar.md.

/** Where the item lives on Google. Old rows (null) keep today's behaviour until their next save. */
export type GoogleTarget = 'tasks' | 'calendar' | 'both' | 'none'

export interface RepeatInput {
  kind: 'weekly' | 'monthly' | 'interval' | 'dates'
  daysOfWeek?: number[]
  interval?: number
  unit?: 'day' | 'week' | 'month'
  dates?: string[]
  /** YYYY-MM-DD */
  startsOn: string
}

export interface ItemInput {
  /** Editing an item that has a task. */
  taskId?: string | null
  /** Its slot, if any. */
  blockId?: string | null
  /** Editing a repeating item. */
  scheduleBlockId?: string | null
  /** For a repeat: 'day' edits one occurrence (needs occurrenceDate), 'all' the rule. */
  scope?: 'item' | 'day' | 'all'
  occurrenceDate?: string | null
  title: string
  notes?: string | null
  domain: 'personal' | 'work' | 'media'
  priority: 'low' | 'medium' | 'high'
  /** YYYY-MM-DD; null = no date. */
  date: string | null
  /** HH:MM; null = anytime. */
  time: string | null
  /** null = doesn't block time. */
  durationMinutes: number | null
  deadline?: { date: string; time: string | null } | null
  repeat?: RepeatInput | null
  google: GoogleTarget
  googleTaskList?: string | null
  source?: { type: string; id: string } | null
}

export interface SavedItem {
  taskId: string | null
  blockId: string | null
  scheduleBlockId: string | null
}

export interface ConvertPreview {
  futureStandaloneBlocks: number
  pastStandaloneBlocks: number
  plans: number
  tasksWithSlots: number
  examples: { title: string; date: string }[]
}

export interface CalendarReadbackState {
  lastRunAt: string | null
  lastCleanAt: string | null
  lastError: string | null
}

export type RepeatDayAction = 'done' | 'skip' | 'undo'
