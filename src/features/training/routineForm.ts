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

const numOrNull = (v: string) => (v.trim() !== '' ? Number(v) : null)

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
      superset_id:          numOrNull(ex.superset_id),
      rest_seconds:         numOrNull(ex.rest_seconds),
      notes:                ex.notes.trim() || null,
      sets: ex.sets.map(s => {
        // Hevy requires rep_range to be a { start, end } object OR absent — it
        // rejects `rep_range: null` with a 400. So include it only when a real
        // range is entered; otherwise send fixed reps and omit the key entirely.
        const hasRange = ex.use_rep_range && s.rep_range_start.trim() !== '' && s.rep_range_end.trim() !== ''
        const set: Record<string, unknown> = {
          type:             s.type,
          weight_kg:        numOrNull(s.weight_kg),
          distance_meters:  numOrNull(s.distance_meters),
          duration_seconds: numOrNull(s.duration_seconds),
          custom_metric:    numOrNull(s.custom_metric),
        }
        if (hasRange) {
          set.reps      = null
          set.rep_range = { start: Number(s.rep_range_start), end: Number(s.rep_range_end) }
        } else {
          set.reps = numOrNull(s.reps)
        }
        return set
      }),
    })),
  }
}

