import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// exercise_gif_overrides (migration 082) may not be applied yet — same
// pre-migration-safe convention as athleteProfileApi.ts: a READ degrades to
// an empty list, a WRITE throws a named error instead of silently no-oping
// (which would look exactly like the save failed for no reason).

export interface ExerciseGifOverride {
  id: string
  user_id: string
  exercise_template_id: string
  gif_url: string
  source: 'manual' | 'exercisegymgifsdb'
  created_at: string
  updated_at: string
}

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED = 'Exercise GIF overrides aren\'t available yet — migration 082 (exercise_gif_overrides) has not been applied.'

// Fetched ONCE and matched client-side against exercise_template_id — same
// "fetch once, derive many views" shape as useExerciseImageDb itself; this
// table is small (one row per manually-fixed exercise) so there is no
// pagination concern.
export async function fetchExerciseGifOverrides(): Promise<ExerciseGifOverride[]> {
  const { data, error } = await supabase.from('exercise_gif_overrides').select('*')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function upsertExerciseGifOverride(
  exerciseTemplateId: string,
  gifUrl: string,
  source: ExerciseGifOverride['source'],
): Promise<ExerciseGifOverride> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('exercise_gif_overrides')
    .upsert(
      { user_id: user.id, exercise_template_id: exerciseTemplateId, gif_url: gifUrl, source },
      { onConflict: 'user_id,exercise_template_id' },
    )
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function deleteExerciseGifOverride(exerciseTemplateId: string): Promise<void> {
  const { error } = await supabase.from('exercise_gif_overrides').delete().eq('exercise_template_id', exerciseTemplateId)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}
