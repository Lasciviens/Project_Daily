import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { SkipRecord } from '../plan/skippedRoutines'

// training_skips (migration 112): a skipped current-program session and why.
// Same guard convention as athleteProfileApi.ts: a missing table READ
// degrades to [] (no flag is ever hidden by it — skips only quiet flags), a
// WRITE throws a message naming the migration instead of a silent no-op.

export interface TrainingSkip extends SkipRecord {
  user_id: string
  created_at: string
}

export interface CreateTrainingSkipInput {
  routine_id: string
  week_start: string
  reason: string
}

const NOT_MIGRATED_112 = 'Skipping a session is not available yet — migration 112 (training_skips) has not been applied.'

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

/** Skips whose missed session was due in a week starting on/after `fromWeek`. */
export async function fetchTrainingSkips(fromWeek: string): Promise<TrainingSkip[]> {
  const { data, error } = await supabase
    .from('training_skips')
    .select('*')
    .gte('week_start', fromWeek)
    .order('week_start', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []) as TrainingSkip[]
}

/** One skip per routine per due week (the table's unique key): skipping the
 *  same session again replaces the reason instead of failing. */
export async function createTrainingSkip(input: CreateTrainingSkipInput): Promise<TrainingSkip> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('training_skips')
    .upsert({ user_id: user.id, routine_id: input.routine_id, week_start: input.week_start, reason: input.reason.trim() }, { onConflict: 'user_id,routine_id,week_start' })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_112) : error
  return data as TrainingSkip
}

export async function deleteTrainingSkip(id: string): Promise<void> {
  const { error } = await supabase.from('training_skips').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_112) : error
}
