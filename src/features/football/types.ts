// The owner's football rows (migrations 163, 168). ESPN's own data is never
// stored: its shapes are footballModel's Fb* types.

export type FollowKind = 'team' | 'league'

export interface FootballFollow {
  id: string
  user_id: string
  kind: FollowKind
  /** A team's ESPN id, or a tournament's slug. */
  ref: string
  name: string
  logo: string | null
  /** A team's own league (its table, club and squad); a tournament's own slug. */
  league: string | null
  /** A team's coming matches go into the day by themselves. */
  subscribed: boolean
  /** A team starred on the Football page (168): the Personal page's Football card shows it. Never a tournament. */
  favourite: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface NewFollowInput {
  kind: FollowKind
  ref: string
  name: string
  logo: string | null
  league: string | null
}

export interface FootballPlan {
  id: string
  user_id: string
  event_id: string
  league: string
  /** Null once its item was deleted: the subscription never adds it again. */
  task_id: string | null
  kickoff_at: string
  time_valid: boolean
  origin: 'subscription' | 'manual'
  created_at: string
  updated_at: string
}
