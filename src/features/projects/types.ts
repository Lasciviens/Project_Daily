export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'
export type ProjectColor  = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose'
export type PhaseStatus   = 'pending' | 'in_progress' | 'done'
export type ItemType      = 'update' | 'improvement' | 'ui_request' | 'bug' | 'wishlist'
export type ItemStatus    = 'open' | 'in_progress' | 'done' | 'cancelled'
export type ItemPriority  = 'low' | 'medium' | 'high'

export interface Project {
  id:          string
  user_id:     string
  name:        string
  description: string | null
  status:      ProjectStatus
  color:       ProjectColor
  sort_order:  number
  created_at:  string
  updated_at:  string
}

export interface ProjectPhase {
  id:          string
  project_id:  string
  user_id:     string
  name:        string
  description: string | null
  status:      PhaseStatus
  sort_order:  number
  created_at:  string
  updated_at:  string
}

export interface ProjectItem {
  id:          string
  phase_id:    string
  project_id:  string
  user_id:     string
  title:       string
  notes:       string | null
  type:        ItemType
  status:      ItemStatus
  priority:    ItemPriority
  sort_order:  number
  created_at:  string
  updated_at:  string
}

export interface CreateProjectInput {
  name:         string
  description?: string | null
  color?:       ProjectColor
  status?:      ProjectStatus
}

export interface CreatePhaseInput {
  project_id:   string
  name:         string
  description?: string | null
}

export interface CreateItemInput {
  phase_id:   string
  project_id: string
  title:      string
  type?:      ItemType
  status?:    ItemStatus
  priority?:  ItemPriority
  notes?:     string | null
}
