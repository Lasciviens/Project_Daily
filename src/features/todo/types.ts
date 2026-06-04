export type TaskDomain    = 'personal' | 'work' | 'media'
export type TaskSection   = 'inbox' | 'today' | 'tomorrow' | 'this_week' | 'backlog'
export type TaskStatus    = 'open' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority  = 'low' | 'medium' | 'high'
export type TaskSourceType = 'manual' | 'media' | 'calendar' | 'ai'

export interface Task {
  id:          string
  user_id:     string
  title:       string
  description: string | null
  domain:      TaskDomain
  section:     TaskSection
  status:      TaskStatus
  priority:    TaskPriority
  due_date:    string | null
  due_time:    string | null
  source_type: TaskSourceType
  source_id:   string | null
  created_at:  string
  updated_at:  string
}

export interface CreateTaskInput {
  title:    string
  domain?:  TaskDomain
  section?: TaskSection
  priority?: TaskPriority
  due_date?: string | null
}

export interface UpdateTaskInput {
  title?:       string
  description?: string | null
  domain?:      TaskDomain
  section?:     TaskSection
  status?:      TaskStatus
  priority?:    TaskPriority
  due_date?:    string | null
}
