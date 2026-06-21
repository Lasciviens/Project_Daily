export interface WorkNote {
  id: string
  user_id: string
  content: string
  updated_at: string
}

export interface WorkPinnedLink {
  id: string
  user_id: string
  title: string
  url: string
  sort_order: number | null
  created_at: string
}

export interface WorkWeeklyGoal {
  id: string
  user_id: string
  week_start: string
  title: string
  done: boolean
  sort_order: number | null
  created_at: string
}
