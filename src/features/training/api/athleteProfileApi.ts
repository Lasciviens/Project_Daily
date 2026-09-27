import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  AthleteProfile,
  UpsertAthleteProfileInput,
  AthleteLimitation,
  CreateLimitationInput,
  UpdateLimitationInput,
  CurrentProgramRoutine,
  AthleteMusclePreference,
  UpsertMusclePreferenceInput,
  ExerciseTargetOverride,
  UpsertExerciseTargetInput,
} from '../types.athlete'

// athlete_profile / athlete_limitations (migration 070) may not be applied
// yet — same guard convention as waterApi.ts / wishesApi.ts. A missing-table
// READ degrades to a safe empty value so no surface breaks on an un-migrated
// DB. A missing-table WRITE, by contrast, must NOT be a silent no-op — that
// would look exactly like data loss — so it throws a message naming the
// missing migration.

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED =
  'Athlete profile is not available yet — migration 070 (athlete_profile / athlete_limitations) has not been applied.'

// birth_year / sex / height_cm arrive with migration 110. `select('*')`
// already tolerates their absence; normalizeProfile just turns "missing" into
// an explicit null so every consumer sees the same shape before and after 110.
const HEALTH_PROFILE_COLUMNS = ['birth_year', 'sex', 'height_cm'] as const

export const NOT_MIGRATED_110 =
  'Birth year, sex and height can’t be saved yet — migration 110 (athlete_profile health fields) has not been applied.'

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeProfile(row: Record<string, unknown>): AthleteProfile {
  const sex = row.sex === 'male' || row.sex === 'female' ? row.sex : null
  return {
    ...(row as unknown as AthleteProfile),
    birth_year: finiteOrNull(row.birth_year),
    sex,
    // numeric(5,1) — PostgREST may hand it back as a string.
    height_cm:  finiteOrNull(row.height_cm),
  }
}

/** A write that names one of the 110 columns on a DB without them (PGRST204 / 42703). */
function isMissingHealthColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  if (x?.code !== 'PGRST204' && x?.code !== '42703') return false
  const msg = x?.message ?? ''
  return HEALTH_PROFILE_COLUMNS.some(col => msg.includes(col))
}

export async function fetchAthleteProfile(): Promise<AthleteProfile | null> {
  const { data, error } = await supabase.from('athlete_profile').select('*').maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return data ? normalizeProfile(data) : null
}

export async function upsertAthleteProfile(input: UpsertAthleteProfileInput): Promise<AthleteProfile> {
  const user = await requireUser()
  const run = (row: Record<string, unknown>) => supabase
    .from('athlete_profile')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()

  const row: Record<string, unknown> = { user_id: user.id, ...input }
  let { data, error } = await run(row)

  // Pre-110: retry without the health columns so the rest of the patch still
  // saves. Only a real value the user typed is reported as lost — clearing a
  // field that can't exist yet is a no-op, not an error.
  if (error && isMissingHealthColumn(error)) {
    const lostValue = HEALTH_PROFILE_COLUMNS.some(col => row[col] != null)
    for (const col of HEALTH_PROFILE_COLUMNS) delete row[col]
    const hasOtherFields = Object.keys(row).length > 1
    if (hasOtherFields || !lostValue) {
      ;({ data, error } = await run(row))
      if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
    }
    if (lostValue) throw new Error(NOT_MIGRATED_110)
  }

  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  if (!data) throw new Error('Athlete profile save returned no row.')
  return normalizeProfile(data)
}

export async function fetchAthleteLimitations(activeOnly = false): Promise<AthleteLimitation[]> {
  let query = supabase.from('athlete_limitations').select('*').order('created_at', { ascending: false })
  if (activeOnly) query = query.eq('active', true)
  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function createAthleteLimitation(input: CreateLimitationInput): Promise<AthleteLimitation> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('athlete_limitations')
    .insert({
      user_id:          user.id,
      movement_pattern: input.movement_pattern,
      severity:         input.severity ?? 'monitor',
      note:             input.note ?? null,
    })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function updateAthleteLimitation(id: string, patch: UpdateLimitationInput): Promise<AthleteLimitation> {
  const { data, error } = await supabase
    .from('athlete_limitations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function deleteAthleteLimitation(id: string): Promise<void> {
  const { error } = await supabase.from('athlete_limitations').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

// ─── Current program (migration 084) — explicit, never inferred ────────────
const NOT_MIGRATED_084 =
  'Progress decision-engine tables are not available yet — migration 084 has not been applied.'

export async function fetchCurrentProgramRoutines(): Promise<CurrentProgramRoutine[]> {
  const { data, error } = await supabase.from('current_program_routines').select('*')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

/** Replaces the whole current-program set in one call (the picker UI saves
 *  the full checked set at once, not one row at a time) — delete whatever's
 *  no longer checked, insert whatever's newly checked, leave the rest. */
export async function setCurrentProgramRoutines(routineIds: string[]): Promise<void> {
  const user = await requireUser()
  const { data: existing, error: readErr } = await supabase
    .from('current_program_routines')
    .select('routine_id')
  if (readErr) throw isMissingTable(readErr) ? new Error(NOT_MIGRATED_084) : readErr

  const existingIds = new Set((existing ?? []).map(r => r.routine_id as string))
  const nextIds = new Set(routineIds)
  const toRemove = [...existingIds].filter(id => !nextIds.has(id))
  const toAdd = [...nextIds].filter(id => !existingIds.has(id))

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('current_program_routines')
      .delete()
      .eq('user_id', user.id)
      .in('routine_id', toRemove)
    if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('current_program_routines')
      .insert(toAdd.map(routine_id => ({ user_id: user.id, routine_id })))
    if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
  }
}

// ─── Muscle preferences (migration 084) ─────────────────────────────────────
export async function fetchMusclePreferences(): Promise<AthleteMusclePreference[]> {
  const { data, error } = await supabase.from('athlete_muscle_preferences').select('*').order('muscle_slug')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function upsertMusclePreference(input: UpsertMusclePreferenceInput): Promise<AthleteMusclePreference> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('athlete_muscle_preferences')
    .upsert(
      { user_id: user.id, muscle_slug: input.muscle_slug, preference: input.preference, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,muscle_slug' },
    )
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
  return data
}

export async function deleteMusclePreference(muscleSlug: string): Promise<void> {
  const { error } = await supabase.from('athlete_muscle_preferences').delete().eq('muscle_slug', muscleSlug)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
}

// ─── Exercise target overrides (migration 084) ──────────────────────────────
export async function fetchExerciseTargetOverrides(): Promise<ExerciseTargetOverride[]> {
  const { data, error } = await supabase.from('exercise_target_overrides').select('*')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function upsertExerciseTargetOverride(input: UpsertExerciseTargetInput): Promise<ExerciseTargetOverride> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('exercise_target_overrides')
    .upsert(
      {
        user_id: user.id,
        exercise_template_id: input.exercise_template_id,
        rep_range_start: input.rep_range_start,
        rep_range_end: input.rep_range_end,
        note: input.note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,exercise_template_id' },
    )
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
  return data
}

export async function deleteExerciseTargetOverride(exerciseTemplateId: string): Promise<void> {
  const { error } = await supabase.from('exercise_target_overrides').delete().eq('exercise_template_id', exerciseTemplateId)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_084) : error
}
