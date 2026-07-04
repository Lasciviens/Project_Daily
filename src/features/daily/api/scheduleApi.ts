import { supabase } from '../../../integrations/supabase/client'
import type { ScheduleBlock, TimeBlock, TimeBlockCategory, CreateTimeBlockInput, CreateScheduleBlockInput } from '../types'

export async function fetchScheduleBlocks(): Promise<ScheduleBlock[]> {
  const { data, error } = await supabase
    .from('schedule_blocks')
    .select('*')
    .order('start_time', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createScheduleBlock(input: CreateScheduleBlockInput): Promise<ScheduleBlock> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('schedule_blocks')
    .insert({ ...input, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteScheduleBlock(id: string): Promise<void> {
  const { error } = await supabase.from('schedule_blocks').delete().eq('id', id)
  if (error) throw error
}

export async function fetchTimeBlocks(dateStr: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('date', dateStr)
    .order('start_time', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

// All training-category blocks within a date range (inclusive) — used by the
// Training calendar to show planned/future sessions.
export async function fetchTrainingBlocksRange(from: string, to: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('category', 'training')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createTimeBlock(input: CreateTimeBlockInput): Promise<TimeBlock> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('time_blocks')
    .insert({ ...input, user_id: user.id, color: input.color ?? 'accent' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTimeBlock(id: string, patch: { start_time?: string; date?: string; title?: string; duration_minutes?: number; category?: TimeBlockCategory; color?: string }): Promise<void> {
  const { error } = await supabase
    .from('time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteTimeBlock(id: string): Promise<void> {
  const { error } = await supabase.from('time_blocks').delete().eq('id', id)
  if (error) throw error
}
