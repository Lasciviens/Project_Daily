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

export interface CreateScheduleBlockInput {
  title:        string
  days_of_week: number[]
  start_time:   string
  end_time:     string
  color?:       string
  category?:    TimeBlockCategory
}

export interface UpdateScheduleBlockInput {
  title?:        string
  days_of_week?: number[]
  start_time?:   string
  end_time?:     string
  color?:        string
  category?:     TimeBlockCategory
}
