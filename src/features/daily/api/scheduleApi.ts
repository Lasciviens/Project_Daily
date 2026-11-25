import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  ScheduleBlock, TimeBlock, CreateTimeBlockInput, UpdateTimeBlockInput,
} from '../types'


export async function fetchScheduleBlocks(): Promise<ScheduleBlock[]> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .select('*')
    .order('start_time', { ascending: true })
  if (error) throw error
  return data ?? []
}

const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /column .* does not exist|could not find the '.*' column/i.test(e.message ?? '')

/** One repeating plan, read fresh (never cached). `.single()` — a missing row is an error, not "no plan". */
export async function fetchScheduleBlock(id: string): Promise<ScheduleBlock> {
  const { data, error } = await supabase.from('schedule_blocks').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

// A block's task state rides along (not kept as an embed): a training
// session's row shows Done / Skipped / Missed from the same facts as its
// popup (training/plan/sessionState).
type TaskEmbed = {
  task: {
    status: TimeBlock['task_status']; hevy_workout_id?: string | null; hevy_routine_id?: string | null
    closed_reason?: string | null; first_plan_date?: string | null
  } | null
}
const withTaskState = ({ task, ...b }: TimeBlock & TaskEmbed): TimeBlock => ({
  ...b, task_status: task?.status ?? null, task_workout_id: task?.hevy_workout_id ?? null, task_routine_id: task?.hevy_routine_id ?? null,
  task_closed_reason: task?.closed_reason ?? null, task_first_plan_date: task?.first_plan_date ?? null,
})
const TASK_EMBED = '*, task:tasks(status, hevy_workout_id, hevy_routine_id, closed_reason, first_plan_date)'
// Before migration 167 tasks has no first_plan_date: one retry without it.
// Remove once 167 has run (it ships with this read).
const TASK_EMBED_BEFORE_167 = '*, task:tasks(status, hevy_workout_id, hevy_routine_id, closed_reason)'
async function withTaskEmbed<T>(read: (select: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>): Promise<T | null> {
  let { data, error } = await read(TASK_EMBED)
  if (error && isMissingColumn(error)) ({ data, error } = await read(TASK_EMBED_BEFORE_167))
  if (error) throw error
  return data
}

/** One block with its task's state, read fresh (null when it is gone). */
export async function fetchTimeBlockWithTask(id: string): Promise<TimeBlock | null> {
  const data = await withTaskEmbed(select => supabase.from('time_blocks').select(select).eq('id', id).maybeSingle())
  return data ? withTaskState(data as unknown as TimeBlock & TaskEmbed) : null
}

export async function fetchTimeBlocks(dateStr: string): Promise<TimeBlock[]> {
  const data = await withTaskEmbed(select => supabase
    .from('time_blocks')
    .select(select)
    .eq('date', dateStr)
    .order('start_time', { ascending: true, nullsFirst: false }))
  return ((data ?? []) as unknown as (TimeBlock & TaskEmbed)[]).map(withTaskState)
}

export async function fetchTimeBlock(id: string): Promise<TimeBlock | null> {
  const { data, error } = await supabase.from('time_blocks').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

// At most one block per task (partial unique index, migration 077).
export async function fetchTimeBlockByTaskId(taskId: string): Promise<TimeBlock | null> {
  const { data, error } = await supabase.from('time_blocks').select('*').eq('task_id', taskId).maybeSingle()
  if (error) throw error
  return data
}

// All training-category blocks within a date range (inclusive) — used by the
// Training calendar to show planned/future sessions.
export async function fetchTrainingBlocksRange(from: string, to: string): Promise<TimeBlock[]> {
  const data = await withTaskEmbed(select => supabase
    .from('time_blocks')
    .select(select)
    .eq('category', 'training')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true }))
  // The linked task's status rides along so a trained session (its task done,
  // migration 141) stops being "next"; the embed itself is not kept.
  return ((data ?? []) as unknown as (TimeBlock & TaskEmbed)[]).map(withTaskState)
}

/** A slot as the month calendar counts it: its day, its kind and its task (a timed task counts on the Tasks line). */
export type MonthSlot = Pick<TimeBlock, 'id' | 'date' | 'category' | 'task_id'>

/** Every slot from `from` to `to` (inclusive), narrow columns, read in pages
 *  (PostgREST answers at most 1 000 rows a request). One read for a month. */
export async function fetchTimeBlocksRange(from: string, to: string): Promise<MonthSlot[]> {
  const PAGE = 1000
  const out: MonthSlot[] = []
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from('time_blocks')
      .select('id, date, category, task_id')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as MonthSlot[]))
    if (!data || data.length < PAGE) return out
  }
}

/** A training repeat's day that is a task on its day with no slot (156): what
 *  the Training views pair with that day's projection, so it reads as the
 *  task says (done, skipped, missed) — never from the date alone. */
export interface TrainingDayTask {
  id: string
  status: NonNullable<TimeBlock['task_status']>
  closed_reason: string | null
  hevy_workout_id: string | null
  hevy_routine_id: string | null
  schedule_block_id: string
  occurrence_date: string
  first_plan_date?: string | null
  /** The task's own title: a past day keeps the name it had, even after the template is renamed. */
  title?: string | null
}

export async function fetchTrainingDayTasks(from: string, to: string): Promise<TrainingDayTask[]> {
  const cols = 'id, title, status, closed_reason, hevy_workout_id, hevy_routine_id, schedule_block_id, occurrence_date'
  const read = (select: string) => supabase
    .from('tasks')
    .select(select)
    .not('schedule_block_id', 'is', null)
    .gte('occurrence_date', from)
    .lte('occurrence_date', to)
    .or('hevy_routine_id.not.is.null,source_type.eq.training_session')
  let { data, error } = await read(`${cols}, first_plan_date`)
  // Before migration 167 (no first_plan_date); remove once 167 has run.
  if (error && isMissingColumn(error)) ({ data, error } = await read(cols))
  if (error) {
    if (isMissingColumn(error)) return [] // before 156: a repeat's day is no task
    throw error
  }
  return (data ?? []) as unknown as TrainingDayTask[]
}

export async function createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('time_blocks')
    .insert({ ...input, user_id: user.id, color: input.color ?? 'accent' })
    .select()
    .single()
  if (error) throw error
  return data
}

/** A one-off block's change. Its Apple Calendar event follows through the queue its triggers fill (173–175). */
export async function updateTimeBlock(id: string, patch: UpdateTimeBlockInput): Promise<void> {
  const { error } = await supabase
    .from('time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
