import type { RepeatKind, RepeatUnit } from './recurrence'

export interface ScheduleBlock {
  id:           string
  user_id:      string
  title:        string
  days_of_week: number[]    // 0=Sun … 6=Sat
  start_time:   string      // 'HH:MM:SS'
  end_time:     string
  color:        string
  category:     TimeBlockCategory
  /** First date this template may render on (migration 081, 'yyyy-MM-dd') —
   *  a recurring block used to have NO date bounds and so fabricated
   *  occurrences all the way back through history. Optional in the type
   *  because a pre-081 row simply doesn't carry it, and the projection
   *  treats that as "no lower bound" (the old behaviour). */
  effective_from?: string
  /** Days left out (migration 142): each became a one-off plan of its own. */
  except_dates?: string[]
  /** How it repeats (migration 146; missing before it = 'weekly'). The one
   *  reader is recurrence.ts (occursOn) — see its header for each kind. */
  repeat_kind?:     RepeatKind
  /** 'interval' only: every N (1–99) days / weeks / months. */
  repeat_interval?: number | null
  repeat_unit?:     RepeatUnit | null
  /** 'dates' only: the hand-picked days ('yyyy-MM-dd'). */
  repeat_dates?:    string[] | null
  /** Its ONE repeating Google Calendar event, in 'primary' (migration 147;
   *  missing before it). The mapping is calendar/calendarSeries.ts. */
  google_calendar_event_id?: string | null
  /** The last day the event's RDATE list covers (the monthly kinds); null
   *  when the event carries every occurrence. */
  google_calendar_horizon?:  string | null
  /** The zone the series is expanded in — set when it is created; only a
   *  save from the planner changes it (background pushes reuse it). */
  google_calendar_time_zone?: string | null
  /** The day it was added to Google Calendar (148): the series starts on its
   *  first day on or after this, not at effective_from. Missing before 148. */
  google_calendar_from?: string | null
  created_at:   string
  updated_at:   string
}

export type TimeBlockCategory = 'daily' | 'training' | 'media' | 'games' | 'work' | 'projects' | 'other'

export interface TimeBlock {
  id:               string
  user_id:          string
  date:             string
  title:            string
  start_time:       string | null
  duration_minutes: number
  color:            string
  category:         TimeBlockCategory
  /** The ONLY representation of "linked to a Task" (migration 077) — never
   *  source_type='task'. At most one block per task (DB-enforced). */
  task_id?:         string | null
  /** The originating real-world entity this block was planned FROM (movie /
   *  training_session / project_item / tv_episode / calendar / manual) —
   *  independent of task_id, and never 'task' (migration 077 removed that
   *  value from the CHECK — it was a polymorphic overload of this column). */
  source_type?:     string | null
  source_id?:       string | null
  // Only stamped when a single specific TV episode was planned (never for a
  // multi-episode batch plan) — source_id alone only identifies the show,
  // not which episode, so this is what lets a DB trigger match "this episode
  // was marked watched" back to the one planned time_block for it.
  season_number?:   number | null
  episode_number?:  number | null
  notes:            string | null
  google_calendar_event_id?: string | null
  /** The weekly plan (schedule_blocks) whose day this block replaces, and
   *  that day (migration 142): one occurrence turned into a plan of its own. */
  schedule_block_id?: string | null
  occurrence_date?:   string | null
  /** Its linked task's status — only on the training-range read
   *  (fetchTrainingBlocksRange): a trained session (task done) is no longer "next". */
  task_status?:     'open' | 'in_progress' | 'waiting' | 'done' | 'cancelled' | null
  /** Its linked task's Hevy workout and routine (141), on the same reads. */
  task_workout_id?: string | null
  task_routine_id?: string | null
  created_at:       string
  updated_at:       string
}

export interface CreateTimeBlockInput {
  date:             string
  title:            string
  start_time?:      string | null
  duration_minutes: number
  color?:           string
  category?:        TimeBlockCategory
  task_id?:         string
  source_type?:     string
  source_id?:       string
  season_number?:   number
  episode_number?:  number
}

/** Patch for an existing one-off time_block — every field the row actually
 *  has, so a title/duration/category edit can propagate to a linked Google
 *  Calendar event exactly like a date/time edit already does. */
export interface UpdateTimeBlockInput {
  date?:                      string
  start_time?:                string | null
  title?:                     string
  duration_minutes?:          number
  category?:                  TimeBlockCategory
  color?:                     string
  google_calendar_event_id?:  string | null
  /** Only ever set on an edit that links a previously-standalone block to a
   *  freshly-created Task ("Also add to Tasks" on an existing block) — see
   *  ScheduleTab's own comment for why this is now unambiguous. */
  task_id?:                   string | null
}

/** The repeat columns a planner save writes (planModal.config's repeatRowFromForm). */
export interface RepeatRow {
  days_of_week:    number[]
  repeat_kind:     RepeatKind
  repeat_interval: number | null
  repeat_unit:     RepeatUnit | null
  repeat_dates:    string[] | null
}

export interface CreateScheduleBlockInput extends Partial<Omit<RepeatRow, 'days_of_week'>> {
  title:        string
  days_of_week: number[]
  start_time:   string
  end_time:     string
  color?:       string
  category?:    TimeBlockCategory
  /** The first day (and the anchor of a monthly / every-N repeat); today when left out. */
  effective_from?: string
}

export interface UpdateScheduleBlockInput extends Partial<RepeatRow> {
  title?:        string
  start_time?:   string
  end_time?:     string
  color?:        string
  category?:     TimeBlockCategory
  effective_from?: string
}
