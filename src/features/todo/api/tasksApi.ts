import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { useCalendarStore } from '../../../app/store'
import { deleteCalendarEvent } from '../../calendar/api/calendarApi'
import { logError } from '../../../shared/utils/logError'
import type { Task, CreateTaskInput, UpdateTaskInput } from '../types'

// All active tasks (+ done, so the UI can show a "recently done" group) for the
// aggregated Tasks overview on Daily — grouped client-side into Overdue / Today
// / Upcoming / No date / Done. Cancelled excluded (app-wide convention).
export async function fetchAllTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

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

// Open planned-training-session tasks (RoutinesTab "Plan routine") — used by
// the Workouts tab to offer a manual "close this" fallback when a logged
// Hevy workout can't be auto-matched to one by routine_id (freeform workouts).
export async function fetchOpenTrainingSessionTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('source_type', 'training_session')
    .neq('status', 'done')
    .neq('status', 'cancelled')
  if (error) throw error
  return data ?? []
}

export async function fetchTasksForDay(dateStr: string, section: string): Promise<Task[]> {
  // 'today' is the one section whose UNDATED rows legitimately belong to the day
  // being viewed (an undated task parked in 'today' is today's work), and an open
  // task whose due_date has passed must still surface there as overdue rather
  // than silently vanish — hence `lte`.
  //
  // Every other day view must match the date EXACTLY. useDayData maps a whole
  // RANGE of day-offsets onto ONE section value (+2..+7 → 'this_week',
  // everything else → 'backlog'), so keeping `due_date.is.null` here meant a
  // single undated 'this_week' row rendered on all six of those days, and a
  // single undated 'backlog' row claimed yesterday *and* every far-future day.
  // Nothing loses its home: undated rows still reach fetchAllTasks →
  // TasksPanel's "No date" group; undated 'this_week' rows also stay in
  // fetchTasksByWeek's section arm → DayView's "This week — no date" band.
  const dueFilter = section === 'today'
    ? `due_date.is.null,due_date.lte.${dateStr}`
    : `due_date.eq.${dateStr}`

  const [sectionRes, dateRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('section', section)
      .or(dueFilter)
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

// Migration 069 (start_date) and 071 (Google Tasks full-surface — 8 new
// columns: parent_task_id, google_tasklist_id, google_sync_enabled, etc.)
// both land as manual migrations, so a deployed browser can hit either
// before its migration is applied. Rather than one hand-written guard per
// column (the old missingStartDate), parse the missing column's name straight
// out of PostgREST's error and strip just that key, retrying — bounded so a
// genuinely different error can't loop forever.
function missingColumnName(err: unknown): string | null {
  const e = err as { code?: string; message?: string }
  if (e?.code !== 'PGRST204' && e?.code !== '42703') return null
  const m = /column ["']?(\w+)["']?/i.exec(e?.message ?? '')
  return m?.[1] ?? null
}

async function insertTaskWithFallback(row: Record<string, unknown>): Promise<Task> {
  const mutable = { ...row }
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabase.from('tasks').insert(mutable).select().single()
    if (!error) return data
    const col = missingColumnName(error)
    if (!col || !(col in mutable)) throw error
    delete mutable[col]
  }
  throw new Error('createTask: exceeded missing-column retry budget')
}

async function updateTaskWithFallback(id: string, row: Record<string, unknown>): Promise<Task> {
  const mutable = { ...row }
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data, error } = await supabase.from('tasks').update(mutable).eq('id', id).select().single()
    if (!error) return data
    const col = missingColumnName(error)
    if (!col || !(col in mutable)) throw error
    delete mutable[col]
  }
  throw new Error('updateTask: exceeded missing-column retry budget')
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

  const row: Record<string, unknown> = {
    user_id:     user.id,
    title:       input.title,
    description: input.description ?? null,
    domain:      input.domain      ?? 'personal',
    section,
    priority:    input.priority    ?? 'medium',
    due_date:    input.due_date    ?? null,
    due_time:    input.due_time    ?? null,
    status:      'open',
    sort_order:  nextSortOrder,
    source_type: input.source_type ?? 'manual',
    source_id:   input.source_id   ?? null,
  }
  if (input.start_date !== undefined) row.start_date = input.start_date ?? null
  if (input.parent_task_id !== undefined) row.parent_task_id = input.parent_task_id ?? null
  if (input.google_tasklist_id !== undefined) row.google_tasklist_id = input.google_tasklist_id ?? null
  // Only ever written true at create time (see Task.google_sync_enabled) —
  // omit rather than send `false` so pre-migration inserts aren't forced
  // through the fallback loop for a value that already defaults to false.
  if (input.google_sync_enabled) row.google_sync_enabled = true

  return insertTaskWithFallback(row)
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
  const row: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  return updateTaskWithFallback(id, row)
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
