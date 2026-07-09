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
}

export interface CreateDevRequestInput {
  title:        string
  description?: string | null
  page?:        string | null
  category?:    DevRequestCategory
  priority?:    DevRequestPriority
  effort?:      DevRequestEffort | null
}
