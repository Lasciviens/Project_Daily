// Exercise template
export interface HevyExerciseTemplate {
  id: string
  user_id: string
  title: string
  type: 'weight_reps' | 'bodyweight_reps' | 'weighted_bodyweight' | 'assisted_bodyweight' | 'duration' | 'distance_duration' | 'weight_distance'
  primary_muscle_group: string | null
  is_custom: boolean
  created_at: string
  synced_at: string
  secondary_muscle_groups?: string[] // from hevy_exercise_template_muscles join
}

// Set within a workout exercise
export interface HevySet {
  id: string
  user_id: string
  hevy_exercise_id: string
  exercise_template_id: string
  index: number
  type: 'normal' | 'warmup' | 'dropset' | 'failure'
  weight_kg: number | null
  reps: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
  created_at: string
}

// Exercise within a workout
export interface HevyWorkoutExercise {
  id: string
  user_id: string
  hevy_workout_id: string
  exercise_template_id: string
  index: number
  title: string
  notes: string | null
  supersets_id: number | null
  created_at: string
  sets?: HevySet[]                     // populated when fetching with sets
  template?: HevyExerciseTemplate      // populated when joining templates
}

// Completed workout
export interface HevyWorkout {
  id: string
  user_id: string
  title: string
  routine_id: string | null
  description: string | null
  start_time: string | null
  end_time: string | null
  hevy_updated_at: string
  hevy_created_at: string
  created_at: string
  synced_at: string
  exercises?: HevyWorkoutExercise[]    // populated when fetching full detail
}

// Routine set template
export interface HevyRoutineSet {
  id: string
  user_id: string
  hevy_routine_exercise_id: string
  index: number
  type: 'normal' | 'warmup' | 'dropset' | 'failure'
  weight_kg: number | null
  reps: number | null
  rep_range_start: number | null
  rep_range_end: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
  created_at: string
}

// Exercise within a routine
export interface HevyRoutineExercise {
  id: string
  user_id: string
  hevy_routine_id: string
  exercise_template_id: string
  index: number
  title: string
  notes: string | null
  rest_seconds: string | null
  supersets_id: number | null
  created_at: string
  sets?: HevyRoutineSet[]
  template?: HevyExerciseTemplate
}

// Routine/program
export interface HevyRoutine {
  id: string
  user_id: string
  folder_id: number | null
  title: string
  notes: string | null
  hevy_updated_at: string
  hevy_created_at: string
  created_at: string
  synced_at: string
  exercises?: HevyRoutineExercise[]
  folder?: HevyRoutineFolder
}

// Routine folder
export interface HevyRoutineFolder {
  id: number
  user_id: string
  title: string
  created_at: string
  synced_at: string
}

// Body measurements
export interface HevyBodyMeasurement {
  id: string
  user_id: string
  date: string  // YYYY-MM-DD
  weight_kg: number | null
  lean_mass_kg: number | null
  fat_percent: number | null
  neck_cm: number | null
  shoulder_cm: number | null
  chest_cm: number | null
  left_bicep_cm: number | null
  right_bicep_cm: number | null
  left_forearm_cm: number | null
  right_forearm_cm: number | null
  abdomen_cm: number | null
  waist_cm: number | null
  hips_cm: number | null
  left_thigh_cm: number | null
  right_thigh_cm: number | null
  left_calf_cm: number | null
  right_calf_cm: number | null
  created_at: string
  updated_at: string
}

// Personal record per exercise
export interface HevyPR {
  exercise_template_id: string
  title: string
  primary_muscle_group: string | null
  max_weight_kg: number
  reps_at_max: number | null
  achieved_at: string  // ISO date of the workout
}

// Strava activity (matches strava_activities table from 025 migration)
export interface StravaActivity {
  id: string
  user_id: string
  strava_activity_id: number | null
  type: 'run' | 'cycling' | 'walk' | 'swim' | 'yoga' | 'other'
  title: string
  start_date: string | null
  distance_meters: number | null
  duration_seconds: number | null
  elevation_gain_m: number | null
  avg_heart_rate: number | null
  avg_pace_sec_per_km: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

// Sync state
export interface HevySyncState {
  user_id: string
  last_events_since: string | null
  created_at: string
  updated_at: string
}
