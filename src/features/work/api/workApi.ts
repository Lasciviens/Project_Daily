import { supabase } from '../../../integrations/supabase/client'
import type { WorkNote, WorkPinnedLink, WorkWeeklyGoal } from '../types'

export async function fetchWorkNote(): Promise<WorkNote | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_notes')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data ?? null
}

export async function upsertWorkNote(content: string): Promise<WorkNote> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_notes')
    .upsert(
      { user_id: user.id, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchPinnedLinks(): Promise<WorkPinnedLink[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_pinned_links')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createPinnedLink(title: string, url: string): Promise<WorkPinnedLink> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_pinned_links')
    .insert({ user_id: user.id, title, url })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePinnedLink(id: string): Promise<void> {
  const { error } = await supabase.from('work_pinned_links').delete().eq('id', id)
  if (error) throw error
}

export async function fetchWeeklyGoals(weekStart: string): Promise<WorkWeeklyGoal[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_weekly_goals')
    .select('*')
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createWeeklyGoal(weekStart: string, title: string): Promise<WorkWeeklyGoal> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('work_weekly_goals')
    .insert({ user_id: user.id, week_start: weekStart, title, done: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function toggleWeeklyGoal(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('work_weekly_goals')
    .update({ done })
    .eq('id', id)
  if (error) throw error
}

export async function deleteWeeklyGoal(id: string): Promise<void> {
  const { error } = await supabase.from('work_weekly_goals').delete().eq('id', id)
  if (error) throw error
}
