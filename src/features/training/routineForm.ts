import type { HevyRoutine, HevyExerciseTemplate } from './types.hevy'
import type { SetType } from './setTypeMeta'

// ─── Types for form state ─────────────────────────────────────────────────────

export interface FormSet {
  _key:             string
  type:             SetType
  weight_kg:        string
  reps:             string
  rep_range_start:  string
  rep_range_end:    string
  distance_meters:  string
  duration_seconds: string
  custom_metric:    string
  /** Workouts only (Hevy's routine sets have no RPE). '' = not logged. */
  rpe?:             string
}

export interface FormExercise {
  _key:                 string
  exercise_template_id: string
  title:                string
  notes:                string
  rest_seconds:         string
  superset_id:          string
  use_rep_range:        boolean
  sets:                 FormSet[]
}

export interface RoutineForm {
  title:     string
  folder_id: string
  notes:     string
  exercises: FormExercise[]
}

export function newKey() { return Math.random().toString(36).slice(2) }

export function blankSet(): FormSet {
  return {
    _key: newKey(), type: 'normal',
    weight_kg: '', reps: '', rep_range_start: '', rep_range_end: '',
    distance_meters: '', duration_seconds: '', custom_metric: '',
  }
}

export function blankExercise(template: HevyExerciseTemplate): FormExercise {
  return {
    _key: newKey(),
    exercise_template_id: template.id,
    title: template.title,
    notes: '',
    rest_seconds: '',
    superset_id: '',
    use_rep_range: false,
    sets: [blankSet()],
  }
}

// Which set metric inputs apply to a given Hevy exercise template type.
// Mirrors how Hevy itself renders set fields per exercise type.
export function setFieldsForType(type: string | undefined) {
  switch (type) {
    // reps only, no weight
    case 'reps_only':
    case 'bodyweight_reps':
      return { weight: false, reps: true,  duration: false, distance: false }
    // time only (incl. stair-machine floors/steps — closest input is duration)
    case 'duration':
    case 'floors_duration':
    case 'steps_duration':
      return { weight: false, reps: false, duration: true,  distance: false }
    // weight + time
    case 'weight_duration':
      return { weight: true,  reps: false, duration: true,  distance: false }
    // distance + time
    case 'distance_duration':
      return { weight: false, reps: false, duration: true,  distance: true  }
    // weight + distance
    case 'short_distance_weight':
    case 'weight_distance':
      return { weight: true,  reps: false, duration: false, distance: true  }
    // weight + reps (incl. weighted/assisted bodyweight variants) and unknown
    default:
      return { weight: true,  reps: true,  duration: false, distance: false }
  }
}

// Convert existing routine data to form state
export function routineToForm(routine: HevyRoutine): RoutineForm {
  return {
    title:     routine.title,
    folder_id: routine.folder_id != null ? String(routine.folder_id) : '',
    notes:     routine.notes ?? '',
    exercises: (routine.exercises ?? []).map(ex => ({
      _key:                 newKey(),
      exercise_template_id: ex.exercise_template_id,
      title:                ex.title,
      notes:                ex.notes ?? '',
      rest_seconds:         ex.rest_seconds != null ? String(ex.rest_seconds) : '',
      superset_id:          ex.supersets_id != null ? String(ex.supersets_id) : '',
      use_rep_range:        (ex.sets ?? []).some(s => s.rep_range_start != null),
      sets: (ex.sets ?? []).map(s => ({
        _key:             newKey(),
        type:             s.type,
        weight_kg:        s.weight_kg != null ? String(s.weight_kg) : '',
        reps:             s.reps != null ? String(s.reps) : '',
        rep_range_start:  s.rep_range_start != null ? String(s.rep_range_start) : '',
        rep_range_end:    s.rep_range_end != null ? String(s.rep_range_end) : '',
        distance_meters:  s.distance_meters != null ? String(s.distance_meters) : '',
        duration_seconds: s.duration_seconds != null ? String(s.duration_seconds) : '',
        custom_metric:    s.custom_metric != null ? String(s.custom_metric) : '',
      })),
    })),
  }
}

// ─── Form input sanitisers ───────────────────────────────────────────────────
// Numeric set/measurement fields are `type="text" inputMode="decimal"`, never
// `type="number"`: a Norwegian keypad types ',' and a number input silently
// empties '62,5', so the weight was saved as null with no warning. Every
// weight/measurement input runs through sanitizeDecimal (comma → dot, digits
// and one separator only); counts (reps, seconds, metres) through
// sanitizeInteger.
export function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1
    ? cleaned
    : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export function sanitizeInteger(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

const numOrNull = (v: string) => {
  const t = v.trim()
  if (t === '' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
// Hevy's schema types reps, distance_meters, duration_seconds and
// superset_id/rest_seconds as INTEGERS.
const intOrNull = (v: string) => {
  const n = numOrNull(v)
  return n == null ? null : Math.round(n)
}

// Hevy's workout-set RPE is an enum; anything else is a 400.
export const RPE_OPTIONS = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const

/** One set in the exact Hevy shape shared by routines and workouts:
 *  `type, weight_kg, reps, distance_meters, duration_seconds, custom_metric`
 *  (+ `rep_range` for routines, `rpe` for workouts). Never an `index`. */
function setToPayload(s: FormSet, opts: { useRange: boolean; withRpe: boolean }): Record<string, unknown> {
  const set: Record<string, unknown> = {
    type:             s.type,
    weight_kg:        numOrNull(s.weight_kg),
    distance_meters:  intOrNull(s.distance_meters),
    duration_seconds: intOrNull(s.duration_seconds),
    custom_metric:    numOrNull(s.custom_metric),
  }
  // Hevy requires rep_range to be a { start, end } object OR absent — it
  // rejects `rep_range: null` with a 400. So include it only when a real
  // range is entered; otherwise send fixed reps and omit the key entirely.
  const hasRange = opts.useRange && s.rep_range_start.trim() !== '' && s.rep_range_end.trim() !== ''
  if (hasRange) {
    set.reps      = null
    set.rep_range = { start: Number(s.rep_range_start), end: Number(s.rep_range_end) }
  } else {
    set.reps = intOrNull(s.reps)
  }
  if (opts.withRpe) {
    const rpe = numOrNull(s.rpe ?? '')
    set.rpe = rpe != null && (RPE_OPTIONS as readonly number[]).includes(rpe) ? rpe : null
  }
  return set
}

// Build the exact Hevy API payload. Field names and shape must match the
// Hevy OpenAPI schema for POST/PUT /v1/routines — any extra key triggers a
// "… is not allowed" 400. Notably: no exercise index/title, no set index/rpe,
// superset_id is singular, and rep ranges use the nested { start, end } object.
export function formToPayload(form: RoutineForm, routineId?: string) {
  const isUpdate = !!routineId
  return {
    ...(routineId ? { id: routineId } : {}),
    title:     form.title.trim(),
    // Hevy's PUT /v1/routines/{id} rejects folder_id ("not allowed") — it's only
    // accepted on create (POST). So send it on create, omit it on update.
    ...(isUpdate ? {} : { folder_id: form.folder_id ? Number(form.folder_id) : null }),
    notes:     form.notes.trim() || null,
    exercises: form.exercises.map(ex => ({
      exercise_template_id: ex.exercise_template_id,
      superset_id:          intOrNull(ex.superset_id),
      rest_seconds:         intOrNull(ex.rest_seconds),
      notes:                ex.notes.trim() || null,
      sets: ex.sets.map(s => setToPayload(s, { useRange: ex.use_rep_range, withRpe: false })),
    })),
  }
}

// ─── Log workout ──────────────────────────────────────────────────────────────
// The same exercise/set form state as the routine editor (FormExercise), so
// the log modal reuses ExerciseSearch + SetRow with per-type fields, and the
// payload comes from the SAME set builder as routines.

export interface WorkoutForm {
  title:       string
  description: string
  /** `yyyy-MM-ddTHH:mm` — a datetime-local value, i.e. LOCAL wall time. */
  startLocal:  string
  durationMin: string
  exercises:   FormExercise[]
}

export const MAX_WORKOUT_MINUTES = 24 * 60

/** Start/end instants from the form's local start and duration, or null
 *  when either is missing or invalid. */
export function workoutTimes(startLocal: string, durationMin: string): { startIso: string; endIso: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startLocal)) return null
  const start = new Date(startLocal) // no zone suffix → parsed as local time
  if (Number.isNaN(start.getTime())) return null
  const minutes = Number(durationMin)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_WORKOUT_MINUTES) return null
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + Math.round(minutes) * 60_000).toISOString() }
}

/** What stops a workout from being logged, in the words the toast shows —
 *  null when the form can be sent. */
export function validateWorkoutForm(form: WorkoutForm): string | null {
  if (!form.title.trim()) return 'Give the workout a title.'
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(form.startLocal) || Number.isNaN(new Date(form.startLocal).getTime())) return 'Pick the date and time the workout started.'
  const minutes = Number(form.durationMin)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_WORKOUT_MINUTES) return 'Duration must be between 1 and 1440 minutes.'
  if (form.exercises.length === 0) return 'Add at least one exercise.'
  const empty = form.exercises.find(ex => ex.sets.length === 0)
  if (empty) return `${empty.title} has no sets.`
  return null
}

/** The exact POST /v1/workouts body (verified against Hevy's published
 *  OpenAPI, 2026-09-27): `title, description, start_time, end_time,
 *  exercises[{ exercise_template_id, superset_id, notes, sets[{ type,
 *  weight_kg, reps, distance_meters, duration_seconds, custom_metric, rpe }] }]`.
 *  No `routine_id` (the POST schema has none), no index/title keys. */
export function workoutFormToPayload(form: WorkoutForm, times: { startIso: string; endIso: string }) {
  return {
    title:       form.title.trim(),
    description: form.description.trim() || null,
    start_time:  times.startIso,
    end_time:    times.endIso,
    exercises: form.exercises.map(ex => ({
      exercise_template_id: ex.exercise_template_id,
      superset_id:          intOrNull(ex.superset_id),
      notes:                ex.notes.trim() || null,
      sets: ex.sets.map(s => setToPayload(s, { useRange: false, withRpe: true })),
    })),
  }
}

/** A routine's exercises as log-form rows: target reps (or the bottom of a
 *  rep range) become the starting reps, the rest carries over as-is. */
export function routineToWorkoutExercises(routine: HevyRoutine): FormExercise[] {
  return routineToForm(routine).exercises.map(ex => ({
    ...ex,
    use_rep_range: false,
    sets: ex.sets.map(s => ({ ...s, reps: s.reps || s.rep_range_start, rep_range_start: '', rep_range_end: '' })),
  }))
}
