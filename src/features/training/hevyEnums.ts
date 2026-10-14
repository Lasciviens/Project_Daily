// Hevy's enums for creating a custom exercise (POST /v1/exercise_templates),
// exactly as its published OpenAPI lists them (checked 14.10.2026,
// docs/integrations/hevy.md): CustomExerciseType, EquipmentCategory and
// MuscleGroup. hevy-api checks the same lists before it sends anything — a
// hand-mirrored copy, compared by scripts/verify-hevy-api.cjs. Pure and
// import-free (scripts/verify-hevy-training.cjs).
//
// The types stored on synced templates are a wider set (Hevy's own library
// also has bodyweight_weighted, floors_duration, steps_duration …), so
// `exerciseTypeLabel` covers those too.

export const HEVY_EXERCISE_TYPES = [
  'weight_reps', 'reps_only', 'bodyweight_reps', 'bodyweight_assisted_reps',
  'duration', 'weight_duration', 'distance_duration', 'short_distance_weight',
] as const
export type HevyExerciseType = typeof HEVY_EXERCISE_TYPES[number]

export const HEVY_EQUIPMENT = [
  'none', 'barbell', 'dumbbell', 'kettlebell', 'machine', 'plate', 'resistance_band', 'suspension', 'other',
] as const
export type HevyEquipment = typeof HEVY_EQUIPMENT[number]

export const HEVY_MUSCLE_GROUPS = [
  'abdominals', 'shoulders', 'biceps', 'triceps', 'forearms', 'quadriceps', 'hamstrings', 'calves', 'glutes',
  'abductors', 'adductors', 'lats', 'upper_back', 'traps', 'lower_back', 'chest', 'cardio', 'neck', 'full_body', 'other',
] as const
export type HevyMuscleGroup = typeof HEVY_MUSCLE_GROUPS[number]

/** hevy-api refuses a longer title (our own guard; Hevy publishes no limit). */
export const HEVY_TITLE_MAX = 100

// Friendly names for every exercise type the app may meet. Anything not
// listed is humanized (snake_case → "Title Case"), so a raw value like
// "reps_only" never reaches the screen.
const TYPE_LABELS: Record<string, string> = {
  weight_reps:              'Weight × Reps',
  reps_only:                'Reps',
  bodyweight_reps:          'Bodyweight',
  bodyweight_weighted:      'Weighted BW',
  weighted_bodyweight:      'Weighted BW',
  bodyweight_assisted_reps: 'Assisted BW',
  assisted_bodyweight:      'Assisted BW',
  bodyweight_assisted:      'Assisted BW',
  duration:                 'Duration',
  weight_duration:          'Weight × Time',
  distance_duration:        'Distance × Time',
  short_distance_weight:    'Weighted Distance',
  weight_distance:          'Weight × Dist',
  floors_duration:          'Floors × Time',
  steps_duration:           'Steps × Time',
}

const EQUIPMENT_LABELS: Record<string, string> = { none: 'No equipment', resistance_band: 'Resistance band' }
const MUSCLE_LABELS: Record<string, string> = { upper_back: 'Upper back', lower_back: 'Lower back', full_body: 'Full body' }

function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : value
}

export const exerciseTypeLabel = (type: string): string =>
  TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
export const equipmentLabel = (v: string): string => EQUIPMENT_LABELS[v] ?? humanize(v)
export const muscleLabel = (v: string): string => MUSCLE_LABELS[v] ?? humanize(v)

export interface CustomExerciseForm {
  title: string
  exerciseType: string
  equipment: string
  muscleGroup: string
  otherMuscles: string[]
}

/** What hevy-api's create_exercise_template takes (Hevy's own field names). */
export interface CustomExercisePayload {
  title: string
  exercise_type: HevyExerciseType
  equipment_category: HevyEquipment
  muscle_group: HevyMuscleGroup
  other_muscles: HevyMuscleGroup[]
}

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)

/** The form → Hevy's body, or the first thing to fix. The main muscle is
 *  never also listed as an "other" muscle; duplicates are dropped. */
export function customExercisePayload(form: CustomExerciseForm): { payload: CustomExercisePayload } | { error: string } {
  const title = form.title.trim()
  if (!title) return { error: 'Give the exercise a name.' }
  if (title.length > HEVY_TITLE_MAX) return { error: `Keep the name to ${HEVY_TITLE_MAX} characters.` }
  if (!isOneOf(HEVY_EXERCISE_TYPES, form.exerciseType)) return { error: 'Pick how the exercise is logged.' }
  if (!isOneOf(HEVY_EQUIPMENT, form.equipment)) return { error: 'Pick the equipment.' }
  if (!isOneOf(HEVY_MUSCLE_GROUPS, form.muscleGroup)) return { error: 'Pick the main muscle.' }
  const muscle = form.muscleGroup
  const others = [...new Set(form.otherMuscles)].filter((m): m is HevyMuscleGroup => isOneOf(HEVY_MUSCLE_GROUPS, m) && m !== muscle)
  return {
    payload: { title, exercise_type: form.exerciseType, equipment_category: form.equipment, muscle_group: muscle, other_muscles: others },
  }
}

/** A routine folder's title, or the thing to fix. */
export function routineFolderTitle(raw: string): { title: string } | { error: string } {
  const title = raw.trim()
  if (!title) return { error: 'Give the folder a name.' }
  if (title.length > HEVY_TITLE_MAX) return { error: `Keep the name to ${HEVY_TITLE_MAX} characters.` }
  return { title }
}
