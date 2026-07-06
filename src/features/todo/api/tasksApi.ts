import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { useCalendarStore } from '../../../app/store'
import { deleteCalendarEvent } from '../../calendar/api/calendarApi'
import { logError } from '../../../shared/utils/logError'
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
      // tasks with a past due_date should not bleed into other day views
      .or(`due_date.is.null,due_date.eq.${dateStr}`)
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

export async function fetchWorkTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('domain', 'work')
    .neq('status', 'cancelled')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
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
  const user = await requireUser()
  const section = input.section ?? 'inbox'

  // Every new task previously got sort_order: 0, so swapTaskOrder (which
  // swaps two rows' values) was a no-op between any two freshly-created
  // tasks (0 <-> 0). Give it the next slot in its section instead.
  const { data: maxRow } = await supabase
    .from('tasks')
    .select('sort_order')
    .eq('section', section)
    .order('sort_order', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id:     user.id,
      title:       input.title,
      domain:      input.domain      ?? 'personal',
      section,
      priority:    input.priority    ?? 'medium',
      due_date:    input.due_date    ?? null,
      due_time:    input.due_time    ?? null,
      status:      'open',
      sort_order:  nextSortOrder,
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
  const [r1, r2] = await Promise.all([
    supabase.from('tasks').update({ sort_order: b.sort_order, updated_at: new Date().toISOString() }).eq('id', a.id),
    supabase.from('tasks').update({ sort_order: a.sort_order, updated_at: new Date().toISOString() }).eq('id', b.id),
  ])
  if (r1.error) throw r1.error
  if (r2.error) throw r2.error
}

export async function toggleTaskDone(id: string, isDone: boolean): Promise<Task> {
  return updateTask(id, { status: isDone ? 'done' : 'open' })
}

export async function deleteTask(id: string): Promise<void> {
  // Keep the schedule consistent — remove any auto-created blocks linked to this
  // task, and their Google Calendar events too (best-effort) so nothing is left
  // orphaned on the calendar.
  const { data: blocks } = await supabase
    .from('time_blocks')
    .select('google_calendar_event_id')
    .eq('source_type', 'task')
    .eq('source_id', id)
  const token = useCalendarStore.getState().accessToken
  if (token && blocks?.length) {
    for (const b of blocks) {
      if (b.google_calendar_event_id) {
        try { await deleteCalendarEvent(token, 'primary', b.google_calendar_event_id) }
        catch (err) { logError(`Calendar event delete failed: ${(err as Error).message}`, { taskId: id }) }
      }
    }
  }
  await supabase.from('time_blocks').delete().eq('source_type', 'task').eq('source_id', id)
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}
