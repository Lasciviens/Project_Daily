import type { MovementPattern } from './muscleMap'

// Sibling to types.hevy.ts — the athlete_profile / athlete_limitations shape
// (migration 070). One profile row per user; limitations are a list, each
// scoped to a MovementPattern (defined in muscleMap.ts, not here — that file
// is also where a pattern derives to affected muscle slugs via
// PATTERN_AFFECTED_SLUGS).
export type TrainingGoal = 'strength' | 'hypertrophy' | 'fat_loss' | 'general'
export type ExperienceLevel = 'novice' | 'intermediate' | 'advanced'
export type Equipment = 'home' | 'gym' | 'both'
export type LimitationSeverity = 'avoid' | 'limit' | 'monitor'

export interface AthleteProfile {
  user_id: string
  goal: TrainingGoal | null
  experience_level: ExperienceLevel | null
  training_age_years: number | null
  training_days_per_week: number | null
  equipment_access: Equipment | null
  notes: string | null
  updated_at: string
}

export type UpsertAthleteProfileInput = Partial<Omit<AthleteProfile, 'user_id' | 'updated_at'>>

export interface AthleteLimitation {
  id: string
  user_id: string
  movement_pattern: MovementPattern
  severity: LimitationSeverity
  note: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface CreateLimitationInput {
  movement_pattern: MovementPattern
  severity?: LimitationSeverity
  note?: string | null
}

export type UpdateLimitationInput = Partial<Pick<AthleteLimitation, 'movement_pattern' | 'severity' | 'note' | 'active'>>
