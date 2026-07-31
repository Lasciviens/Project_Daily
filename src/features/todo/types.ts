export type TaskDomain    = 'personal' | 'work' | 'media'
export type TaskSection   = 'inbox' | 'today' | 'tomorrow' | 'this_week' | 'backlog'
export type TaskStatus    = 'open' | 'in_progress' | 'waiting' | 'done' | 'cancelled'
export type TaskPriority  = 'low' | 'medium' | 'high'
export type TaskSourceType = 'manual' | 'movie' | 'tv_series' | 'media' | 'calendar' | 'ai' | 'training_session' | 'project_item'

export interface Task {
  id:                       string
  user_id:                  string
  title:                    string
  description:              string | null
  domain:                   TaskDomain
  section:                  TaskSection
  status:                   TaskStatus
  priority:                 TaskPriority
  /** Opening edge of a window; due_date stays the sole deadline (migration 069). */
  start_date:               string | null
  due_date:                 string | null
  due_time:                 string | null
  waiting_for:              string | null
  is_focused:               boolean
  source_type:              TaskSourceType
  source_id:                string | null
  sort_order:               number
  google_task_id:           string | null
  google_calendar_event_id: string | null
  created_at:               string
  updated_at:               string
}

export interface CreateTaskInput {
  title:       string
  description?: string | null
  domain?:     TaskDomain
  section?:    TaskSection
  priority?:   TaskPriority
  start_date?: string | null
  due_date?:   string | null
  due_time?:   string | null
  source_type?: TaskSourceType
  source_id?:   string | null
}

export interface UpdateTaskInput {
  title?:                    string
  description?:              string | null
  domain?:                   TaskDomain
  section?:                  TaskSection
  status?:                   TaskStatus
  priority?:                 TaskPriority
  start_date?:               string | null
  due_date?:                 string | null
  due_time?:                 string | null
  waiting_for?:              string | null
  is_focused?:               boolean
  google_task_id?:           string | null
  google_calendar_event_id?: string | null
}
