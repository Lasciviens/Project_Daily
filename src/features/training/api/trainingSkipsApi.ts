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

/** A skip of a missed routine with no plan (Missed sessions): one per routine
 *  per due week — skipping the same week again replaces the reason. A
 *  planned session's own skip is written by trainingPlanApi.skipPlan. */
export async function createTrainingSkip(input: CreateTrainingSkipInput): Promise<TrainingSkip> {
  const user = await requireUser()
  const row = { user_id: user.id, routine_id: input.routine_id, week_start: input.week_start, reason: input.reason.trim() }
  const found = await supabase.from('training_skips').select('id')
    .eq('routine_id', input.routine_id).eq('week_start', input.week_start).is('task_id', null).maybeSingle()
  if (found.error) {
    // Before 142 (no task_id): 112's own key covers the upsert.
    if (!/task_id/.test(found.error.message ?? '')) throw isMissingTable(found.error) ? new Error(NOT_MIGRATED_112) : found.error
    const legacy = await supabase.from('training_skips').upsert(row, { onConflict: 'user_id,routine_id,week_start' }).select().single()
    if (legacy.error) throw isMissingTable(legacy.error) ? new Error(NOT_MIGRATED_112) : legacy.error
    return legacy.data as TrainingSkip
  }
  const res = found.data
    ? await supabase.from('training_skips').update({ reason: row.reason }).eq('id', found.data.id).select().single()
    : await supabase.from('training_skips').insert(row).select().single()
  if (res.error) throw isMissingTable(res.error) ? new Error(NOT_MIGRATED_112) : res.error
  return res.data as TrainingSkip
}

export async function deleteTrainingSkip(id: string): Promise<void> {
  const { error } = await supabase.from('training_skips').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_112) : error
}
