export type WorkoutType = 'strength' | 'run' | 'cycling' | 'walk' | 'yoga' | 'swim' | 'other'

export interface ExerciseSet {
  reps?:         number
  weight_kg?:    number
  duration_sec?: number
}

export interface Exercise {
  name: string
  sets: ExerciseSet[]
}

export interface TrainingSession {
  id:                  string
  user_id:             string
  planned_date:        string | null   // yyyy-MM-dd
  completed_at:        string | null   // ISO timestamp
  type:                WorkoutType
  title:               string
  notes:               string | null
  source:              'manual' | 'strava'
  strava_activity_id:  number | null
  distance_meters:     number | null
  duration_seconds:    number | null
  elevation_gain_m:    number | null
  avg_heart_rate:      number | null
  avg_pace_sec_per_km: number | null
  exercises:           Exercise[] | null
  created_at:          string
  updated_at:          string
}

export interface TrainingProgram {
  id:          string
  user_id:     string
  name:        string
  description: string | null
  is_active:   boolean
  created_at:  string
  updated_at:  string
}

export interface StravaStatus {
  connected:      boolean
  athlete_id:     number | null
  athlete_name:   string | null
  athlete_avatar: string | null
}

export interface CreateSessionInput {
  planned_date?:       string
  completed_at?:       string
  type:                WorkoutType
  title:               string
  notes?:              string
  distance_meters?:    number
  duration_seconds?:   number
  elevation_gain_m?:   number
  avg_heart_rate?:     number
  avg_pace_sec_per_km?: number
  exercises?:          Exercise[]
}
