export type DevRequestCategory = 'bug' | 'feature' | 'improvement' | 'integration' | 'longterm' | 'question' | 'other'
export type DevRequestPriority = 'low' | 'medium' | 'high' | 'urgent'
export type DevRequestStatus   = 'open' | 'in_progress' | 'done' | 'dismissed'
export type DevRequestEffort   = 'small' | 'medium' | 'large'

export interface DevRequest {
  id:          string
  user_id:     string
  title:       string
  description: string | null
  page:        string | null
  category:    DevRequestCategory
  priority:    DevRequestPriority
  status:      DevRequestStatus
  effort:      DevRequestEffort | null
  sort_order:  number
  created_at:  string
  updated_at:  string
  /** Set by the database when status becomes 'done' (migration 114; absent before it). */
  completed_at?: string | null
  /** When a prompt for Claude was last built for this request (migration 114). */
  prompted_at?:  string | null
}

export interface CreateDevRequestInput {
  title:        string
  description?: string | null
  page?:        string | null
  category?:    DevRequestCategory
  priority?:    DevRequestPriority
  effort?:      DevRequestEffort | null
  sort_order?:  number
}
