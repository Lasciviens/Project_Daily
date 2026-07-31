export type WishKind     = 'thing' | 'place'
export type WishStatus   = 'idea' | 'planned' | 'done' | 'dropped'
export type WishPriority = 'low' | 'medium' | 'high'

// A wish is a different noun from a task: it carries a *reminder period*
// (period_start/period_end) that can never become a deadline, so it is never
// overdue and never red. `city`/`country`/`url` only mean something for
// kind='place' — same one-table variant shape shop_items uses for its own.
export interface WishItem {
  id:               string
  user_id:          string
  title:            string
  notes:            string | null
  kind:             WishKind
  period_start:     string | null   // 'yyyy-MM-dd'
  period_end:       string | null   // 'yyyy-MM-dd'
  period_label:     string | null   // the user's own word for the window
  city:             string | null
  country:          string | null
  url:              string | null
  priority:         WishPriority
  status:           WishStatus
  promoted_task_id: string | null   // set when "Plan it" turns the wish into a task
  sort_order:       number
  created_at:       string
  updated_at:       string
}

export interface CreateWishInput {
  title:         string
  kind?:         WishKind
  notes?:        string | null
  period_start?: string | null
  period_end?:   string | null
  period_label?: string | null
  city?:         string | null
  country?:      string | null
  url?:          string | null
  priority?:     WishPriority
}

export type UpdateWishInput = Partial<Omit<WishItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
