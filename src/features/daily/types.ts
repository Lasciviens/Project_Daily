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

export interface TimeBlock {
  id:               string
  user_id:          string
  date:             string
  title:            string
  start_time:       string | null
  duration_minutes: number
  color:            string
  created_at:       string
  updated_at:       string
}

export interface CreateTimeBlockInput {
  date:             string
  title:            string
  start_time?:      string | null
  duration_minutes: number
  color?:           string
}

export interface CreateScheduleBlockInput {
  title:        string
  days_of_week: number[]
  start_time:   string
  end_time:     string
  color?:       string
}
