export interface ScheduleBlock {
  id:           string
  user_id:      string
  title:        string
  days_of_week: number[]    // 0=Sun … 6=Sat
  start_time:   string      // 'HH:MM:SS'
  end_time:     string
  color:        string
  created_at:   string
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
  source_type?:     string
  source_id?:       string
  season_number?:   number
  episode_number?:  number
}

export interface CreateScheduleBlockInput {
  title:        string
  days_of_week: number[]
  start_time:   string
  end_time:     string
  color?:       string
}
