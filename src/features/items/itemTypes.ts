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
  /** A Google Tasks list: its local id (google_task_lists.id) or a title (made on Google when new). */
  googleTaskList?: string | null
  source?: { type: string; id: string } | null
  /** Inbox / Today / Backlog when a screen keeps sections (the Tasks tab); otherwise
   *  itemRules.sectionForItem decides from the day. */
  section?: 'inbox' | 'today' | 'backlog' | null
}

export interface SavedItem {
  taskId: string | null
  blockId: string | null
  scheduleBlockId: string | null
  /** A new item (not an edit). */
  created?: boolean
  /** Set when the save edited one day of a repeat. */
  occurrenceDate?: string | null
}

export interface ConvertPreview {
  futureStandaloneBlocks: number
  pastStandaloneBlocks: number
  plans: number
  tasksWithSlots: number
  examples: { title: string; date: string }[]
  /** Planned episodes left as they are: watching one removes its slot (043/149). */
  autoClearedEpisodes?: number
}

/** What "Convert old items" did; its own Undo takes `conversionId`. */
export interface ConvertResult {
  converted: number
  conversionId: string | null
}

export interface CalendarReadbackState {
  lastRunAt: string | null
  lastCleanAt: string | null
  lastError: string | null
  /** Changes the last run applied. */
  lastApplied?: number
  /** False before migration 155 (nothing to show). */
  available?: boolean
}

export type RepeatDayAction = 'done' | 'skip' | 'undo'

export interface RepeatDayInput {
  scheduleBlockId: string
  /** YYYY-MM-DD: the day of the repeat (its own day, even if it was moved). */
  date: string
  action: RepeatDayAction
  /** For the toast: the item's title. */
  title?: string
}

/** A Google choice that can't be saved (error) or needs a word in the sheet (warning). */
export interface GoogleTargetProblem {
  level: 'error' | 'warning'
  message: string
}

/** What a delete acts on (any of the ids the screen has). */
export interface DeleteItemTarget {
  taskId?: string | null
  blockId?: string | null
  scheduleBlockId?: string | null
  /** The repeat's day, for scope 'day'. */
  date?: string | null
  title: string
}

export type DeleteItemScope = 'item' | 'day' | 'all'
