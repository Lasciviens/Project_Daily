import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { OPEN_STATUSES, compareByDueThenOrder } from '../taskRules'
import type { Task, CreateTaskInput, UpdateTaskInput } from '../types'

// All active tasks (+ done, so the UI can show a "recently done" group) for the
// aggregated Tasks overview on Daily — grouped client-side into Overdue / Today
// / Upcoming / No date / Done. Cancelled excluded (app-wide convention).
// Read in pages: PostgREST stops at 1,000 rows, and done tasks pile up for
// ever — past 1,000 the cut fell on the undated rows (sorted last), so
// "No date" (where imported Google tasks landed before 148) quietly lost
// tasks. The pages are keyed on id (keyset), never offsets: a row a sync
// edits between two pages keeps its place, where an offset page on due_date
// could move it across the boundary and skip it. Sorted here afterwards
// (taskRules.compareByDueThenOrder — the order the query used to give).
export async function fetchAllTasks(): Promise<Task[]> {
  return (await fetchTaskPages(q => q)).sort(compareByDueThenOrder)
}

type TaskQuery = ReturnType<ReturnType<typeof supabase.from>['select']>

/** Every non-cancelled task `where` picks, read in keyset pages on id (see
 *  fetchAllTasks: PostgREST stops at 1,000 rows), each row once. */
async function fetchTaskPages(where: (q: TaskQuery) => TaskQuery): Promise<Task[]> {
  const PAGE = 1000
  const out: Task[] = []
  for (let last: string | null = null; ;) {
    let query = where(supabase.from('tasks').select('*')).neq('status', 'cancelled').order('id', { ascending: true }).limit(PAGE)
    if (last) query = query.gt('id', last)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as Task[]
    out.push(...rows)
    if (rows.length < PAGE) break
    last = rows[rows.length - 1].id
  }
  return [...new Map(out.map(t => [t.id, t])).values()]
}

/** A list's own order: sort_order (unset last), then newest first — what the query used to give. */
const bySortOrderNewestFirst = (a: Task, b: Task) =>
  (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
  || (b.created_at ?? '').localeCompare(a.created_at ?? '')

// A section and the Work board read every non-cancelled row (done ones too,
// and since 156 every repeat's day is a task) — in pages, or past 1,000 rows
// the cut fell on the newest quick-adds (28.10.2026).
export async function fetchTasksBySection(section: string): Promise<Task[]> {
  return (await fetchTaskPages(q => q.eq('section', section))).sort(bySortOrderNewestFirst)
}

// Open planned training sessions — every training task (141's definition:
// planned from a routine, or linked to one by its title). The Workouts tab
// offers a manual "close this" for a workout the database couldn't pair;
// Missed sessions moves or skips a routine's open past plan instead of
// planning a second one.
export async function fetchOpenTrainingSessionTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .or('source_type.eq.training_session,hevy_routine_id.not.is.null')
    .neq('status', 'done')
    .neq('status', 'cancelled')
  if (error) throw error
  return data ?? []
}

/**
 * Every task that can be on `dateStr`'s list (taskRules.onDay decides which
 * are): due that day, closed that day (done or cancelled), and — on today —
 * every open task that is overdue, whatever its section, plus undated open
 * ones parked in Today — where a task Google sends without a date is filed
 * (upsert_task_from_google, migration 148), so it needs no read of its own.
 *
 * Only Today keeps undated rows: Daily once mapped a whole range of days
 * onto one section (+2…+7 → this_week, the rest → backlog), so an undated row
 * of that section rendered on every one of those days. Undated rows still
 * reach fetchAllTasks → TasksPanel's "No date" group, and undated this_week
 * rows fetchTasksByWeek → DayView's "This week — no date" band.
 *
 * An open overdue task used to surface on Today only when it sat in the Today
 * section; one filed in the Inbox or Backlog vanished from Daily and Home
 * while the Tasks tab and Work counted it overdue. Done rows of the Today
 * section are no longer read wholesale (they piled up for ever and only the
 * ones closed on the day are shown) — the closed-that-day read brings those.
 *
 * Never add a wish/period/window/kind filter here (NEVER_HIDES): a new surface
 * only adds rows. A missing column here also breaks DayView, the rail and Home.
 */
export async function fetchTasksForDay(dateStr: string, today: string): Promise<Task[]> {
  const dayStart = new Date(`${dateStr}T00:00:00`).toISOString()
  const nextStart = new Date(`${shiftDateStr(dateStr, 1)}T00:00:00`).toISOString()
  const reads = [
    supabase
      .from('tasks')
      .select('*')
      .eq('due_date', dateStr)
      .neq('status', 'cancelled')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .gte('completed_at', dayStart)
      .lt('completed_at', nextStart)
      .order('completed_at', { ascending: true }),
  ]
  if (dateStr === today) {
    reads.push(supabase
      .from('tasks')
      .select('*')
      .in('status', [...OPEN_STATUSES])
      .or(`due_date.lt.${today},and(due_date.is.null,section.eq.today)`)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }))
  }
  const results = await Promise.all(reads)
  const seen = new Set<string>()
  const out: Task[] = []
  for (const r of results) {
    if (r.error) throw r.error
    for (const t of (r.data ?? []) as Task[]) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
  }
  return out
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

// Parent-task lookup for the "↳ Subtask of …" chip and children lookup for
// the inline expand — both small, react-query-cached (keyed by id), so
// ToDoItem can render subtask relationships without its callers (TasksPanel,
// DayView, DayQuickRail) threading the full task list through.
export async function fetchTaskById(id: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function fetchTasksByIds(ids: readonly string[]): Promise<Task[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('tasks').select('*').in('id', [...ids])
  if (error) throw error
  return data ?? []
}

export async function fetchSubtasks(parentTaskId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', parentTaskId)
    .neq('status', 'cancelled')
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function fetchWorkTasks(): Promise<Task[]> {
  return (await fetchTaskPages(q => q.eq('domain', 'work'))).sort(bySortOrderNewestFirst)
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
