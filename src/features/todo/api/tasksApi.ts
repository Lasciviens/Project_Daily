import { supabase } from '../../../integrations/supabase/client'
import type { Task, CreateTaskInput, UpdateTaskInput } from '../types'

export async function fetchTasksBySection(section: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('section', section)
    .neq('status', 'cancelled')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchTasksForDay(dateStr: string, section: string): Promise<Task[]> {
  const [sectionRes, dateRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('section', section)
      .neq('status', 'cancelled')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .eq('due_date', dateStr)
      .neq('section', section)
      .neq('status', 'cancelled')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])
  if (sectionRes.error) throw sectionRes.error
  if (dateRes.error) throw dateRes.error
  return [...(sectionRes.data ?? []), ...(dateRes.data ?? [])]
}

export async function fetchTasksByWeek(weekStart: string, weekEnd: string): Promise<Task[]> {
  const [sectionRes, dateRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('section', 'this_week')
      .neq('status', 'cancelled')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .gte('due_date', weekStart)
      .lte('due_date', weekEnd)
      .neq('section', 'this_week')
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true }),
  ])
  if (sectionRes.error) throw sectionRes.error
  if (dateRes.error) throw dateRes.error
  return [...(sectionRes.data ?? []), ...(dateRes.data ?? [])]
}

export async function fetchTasksByMonth(monthStart: string, monthEnd: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .gte('due_date', monthStart)
    .lte('due_date', monthEnd)
    .neq('status', 'cancelled')
  if (error) throw error
  return data ?? []
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id:     user.id,
      title:       input.title,
      domain:      input.domain      ?? 'personal',
      section:     input.section     ?? 'inbox',
      priority:    input.priority    ?? 'medium',
      due_date:    input.due_date    ?? null,
      status:      'open',
      sort_order:  0,
      source_type: input.source_type ?? 'manual',
      source_id:   input.source_id   ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function swapTaskOrder(id1: string, id2: string): Promise<void> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, sort_order')
    .in('id', [id1, id2])
  if (error) throw error
  if (!data || data.length !== 2) return
  const [a, b] = data
  await Promise.all([
    supabase.from('tasks').update({ sort_order: b.sort_order, updated_at: new Date().toISOString() }).eq('id', a.id),
    supabase.from('tasks').update({ sort_order: a.sort_order, updated_at: new Date().toISOString() }).eq('id', b.id),
  ])
}

export async function toggleTaskDone(id: string, isDone: boolean): Promise<Task> {
  return updateTask(id, { status: isDone ? 'done' : 'open' })
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}
