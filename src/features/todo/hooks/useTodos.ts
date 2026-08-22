import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchAllTasks,
  fetchTasksBySection,
  fetchTasksForDay,
  fetchTasksByWeek,
  fetchTasksByMonth,
  fetchWorkTasks,
  fetchOpenTrainingSessionTasks,
  fetchTaskById,
  fetchSubtasks,
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  swapTaskOrder,
} from '../api/tasksApi'
import { drainGoogleTasksOutbox } from '../api/googleTasksOutbox'
import { pullGoogleTasks } from '../api/googleTasksSync'
import { supabase } from '../../../integrations/supabase/client'
import { updateTimeBlock } from '../../daily/api/scheduleApi'
import { useCalendarStore } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { CreateTaskInput, UpdateTaskInput, Task } from '../types'

// Aggregated overview of every active task (+ recently done) — the Daily "Tasks"
// tab groups these into Overdue / Today / Upcoming / No date / Done.
export function useAllTasks() {
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: fetchAllTasks,
    staleTime: 30_000,
  })
}

export function useTasksBySection(section: string, enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'section', section],
    queryFn: () => fetchTasksBySection(section),
    staleTime: 30_000,
    enabled,
  })
}

export function useOpenTrainingSessionTasks() {
  return useQuery({
    queryKey: ['tasks', 'training-session-open'],
    queryFn: fetchOpenTrainingSessionTasks,
    staleTime: 30_000,
  })
}

export function useTasksForDay(date: Date, section: string) {
  const dateStr = format(date, 'yyyy-MM-dd')
  return useQuery({
    queryKey: ['tasks', 'day', dateStr, section],
    queryFn: () => fetchTasksForDay(dateStr, section),
  })
}

export function useTasksByWeek(weekStart: Date, weekEnd: Date) {
  const startStr = format(weekStart, 'yyyy-MM-dd')
  const endStr   = format(weekEnd,   'yyyy-MM-dd')
  return useQuery({
    queryKey: ['tasks', 'week', startStr, endStr],
    queryFn: () => fetchTasksByWeek(startStr, endStr),
  })
}

export function useTasksByMonth(monthStart: Date, monthEnd: Date) {
  const startStr = format(monthStart, 'yyyy-MM-dd')
  const endStr   = format(monthEnd,   'yyyy-MM-dd')
  return useQuery({
    queryKey: ['tasks', 'month', startStr, endStr],
    queryFn: () => fetchTasksByMonth(startStr, endStr),
  })
}

// Best-effort: drain whatever migration 071's DB triggers just enqueued so a
// create/edit/toggle/delete still feels instant when Google is reachable.
// The outbox (populated atomically with the tasks write, not by this call)
// is the actual safety net — a failure here just means "will retry later",
// never a lost operation.
async function drainBestEffort(token: string | null, context: Record<string, unknown>): Promise<string | null> {
  if (!token) return null
  try {
    const { failed } = await drainGoogleTasksOutbox(token)
    return failed > 0 ? `${failed} Google Tasks sync operation(s) failed — will retry` : null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logError(`Google Tasks outbox drain failed: ${message}`, context)
    return message
  }
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    // `skipGoogleTasks` is set by the plan modal when this task will also be
    // represented as a linked Google Calendar EVENT (via its time block).
    // Without it the same task shows up on Google Calendar twice — once as a
    // Google Task, once as the event — the "task duplicate" bug. The calendar
    // event is the canonical two-way-linked record (time_blocks
    // .google_calendar_event_id + migrations 038/043), so the Google Task copy
    // is suppressed in that case via google_sync_enabled: false.
    mutationFn: async ({ skipGoogleTasks, ...input }: CreateTaskInput & { skipGoogleTasks?: boolean }) => {
      const token = useCalendarStore.getState().accessToken
      const googleSyncEnabled = !!token && !skipGoogleTasks
      const task = await createTask({ ...input, google_sync_enabled: googleSyncEnabled })
      // The INSERT's own trigger already enqueued the outbox row atomically —
      // this just delivers it promptly instead of waiting for the next drain.
      const googleTaskError = googleSyncEnabled ? await drainBestEffort(token, { taskId: task.id }) : null
      return { task, googleTaskError }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateTaskInput }) => {
      const task = await updateTask(id, patch)
      // Whether this edit actually touched a Google-synced field (and
      // whether it crossed a status bucket boundary, e.g. done vs in_progress
      // vs waiting) is decided by migration 071's DB trigger, not here — it
      // has the OLD/NEW row and the single source of truth for that
      // condition. This call only delivers whatever got enqueued.
      const token = useCalendarStore.getState().accessToken
      if (token) await drainBestEffort(token, { taskId: id })

      // Task title is canonical (migration 077) — a DB trigger already kept
      // the linked time_block's OWN title in sync regardless of which door
      // wrote it, but the REMOTE Google Calendar event needs an explicit
      // push here since a trigger has no OAuth token to reach it with.
      // Routed through scheduleApi's updateTimeBlock (not a direct
      // updateCalendarEvent call) so this shares the SAME typed-status
      // lifecycle as every other calendar push — a confirmed 404 here
      // clears the stale link exactly like it would from the plan modal,
      // instead of a second, inconsistent "log and forget" path for the
      // same remote event.
      if (patch.title !== undefined && token) {
        const { data: linked } = await supabase
          .from('time_blocks')
          .select('id')
          .eq('task_id', id)
          .maybeSingle()
        if (linked?.id) {
          try { await updateTimeBlock(linked.id, { title: task.title }) }
          catch (err) { logError(`Calendar event title sync failed: ${(err as Error).message}`, { taskId: id }) }
        }
      }
      return task
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      // A task edit can move/retitle a linked schedule block — keep schedule
      // views in sync (the plan modal syncs the block itself).
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const task = await toggleTaskDone(id, isDone)
      const token = useCalendarStore.getState().accessToken
      if (token) await drainBestEffort(token, { taskId: id })
      return task
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useSwapTaskOrder() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'swap_task_order',
    mutationFn: ({ id1, id2 }: { id1: string; id2: string }) => swapTaskOrder(id1, id2),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError:    () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (taskOrId: string | Task) => {
      const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
      // A hard delete's outbox 'delete' row (if the task was google_sync_enabled)
      // is enqueued atomically by the trigger BEFORE the row is gone — no
      // client-side lookup of google_task_id needed here any more.
      await deleteTask(id)
      const token = useCalendarStore.getState().accessToken
      if (token) await drainBestEffort(token, { taskId: id })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
}

// Parent-title lookup for ToDoItem's "↳ Subtask of …" chip — one row, cheap,
// react-query-cached by id so re-rendering the same parent across a list
// costs one request, not one per child.
export function useTaskById(id: string | null) {
  return useQuery({
    queryKey: ['tasks', 'by-id', id],
    queryFn: () => fetchTaskById(id as string),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// Direct children for ToDoItem's inline "N subtasks" expand.
export function useSubtasks(parentTaskId: string, enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'subtasks', parentTaskId],
    queryFn: () => fetchSubtasks(parentTaskId),
    enabled,
    staleTime: 30_000,
  })
}

export function useSetParentTask() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'set_parent_task',
    mutationFn: async ({ id, parentTaskId }: { id: string; parentTaskId: string | null }) => {
      const task = await updateTask(id, { parent_task_id: parentTaskId })
      // A parent_task_id change is a Google-visible field (migration 071's
      // trigger enqueues 'update'/'move' for it) — every other mutation here
      // drains right away instead of waiting for the next unrelated drain;
      // this one was missed and left "Set parent" pending until something
      // else happened to trigger a drain.
      const token = useCalendarStore.getState().accessToken
      if (token) await drainBestEffort(token, { taskId: id })
      return task
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useWorkTasks() {
  return useQuery({
    queryKey: ['tasks', 'work'],
    queryFn: fetchWorkTasks,
  })
}

// Full pull from Google Tasks (every list, real pagination, tombstones
// included) — reconciles local against Google's true state rather than
// only ever importing genuinely-new tasks. Was unreachable from any UI
// before 20/08/2026 (CLAUDE.md's "known side effect" of the old To-Do
// drawer's removal); wired up via GoogleTasksSyncButtons.
export function useSyncFromGoogleTasks() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'sync_from_google_tasks',
    mutationFn: async () => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')
      const { imported } = await pullGoogleTasks(token)
      return imported
    },
    successMessage: (count: number) =>
      count > 0 ? `Synced ${count} task${count === 1 ? '' : 's'} from Google ✓` : 'Google Tasks already up to date',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// Catch-up action for tasks created before Google was connected, OR whose
// create-time sync silently failed (a real incident: the ambiguous-overload
// RPC bug, fixed separately, could leave google_sync_enabled=true with
// google_task_id still NULL for anything created during that window — the
// task never actually reached Google despite looking "already synced").
//
// The real signal for "not yet on Google" is the absence of google_task_id,
// NOT google_sync_enabled — that flag reflects INTENT (set at create time,
// before any Google call happens), not outcome. The old filter checked only
// google_sync_enabled, so it silently skipped exactly the stuck-create case
// this action exists to catch, always reporting "All tasks already in
// Google Tasks" for them.
//
// Calendar-linked tasks (google_sync_enabled=false BY DESIGN — see
// UnifiedPlanModal's skipGoogleTasks) also have no google_task_id, so
// they're excluded by checking for a linked time_blocks row with its own
// google_calendar_event_id — pushing those would recreate the exact
// "task duplicated as both a Calendar event and a Task" bug that flag exists
// to prevent.
export function usePushToGoogleTasks() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'push_to_google_tasks',
    mutationFn: async (tasks: Task[]) => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')

      const notYetSynced = tasks.filter(t =>
        !t.google_task_id && t.status !== 'done' && t.status !== 'cancelled')

      const { data: linkedBlocks } = notYetSynced.length
        ? await supabase
            .from('time_blocks')
            .select('task_id')
            .not('google_calendar_event_id', 'is', null)
            .in('task_id', notYetSynced.map(t => t.id))
        : { data: [] }
      const calendarLinkedIds = new Set((linkedBlocks ?? []).map(b => b.task_id))
      const candidates = notYetSynced.filter(t => !calendarLinkedIds.has(t.id))

      for (const t of candidates) {
        // A task already marked google_sync_enabled=true (the stuck-create
        // case) needs an explicit false→true transition to re-trigger
        // migration 071's opt-in branch — setting true→true is a no-op the
        // trigger doesn't see as a change at all.
        if (t.google_sync_enabled) await updateTask(t.id, { google_sync_enabled: false })
        await updateTask(t.id, { google_sync_enabled: true })
      }

      const { failed } = await drainGoogleTasksOutbox(token)
      return { pushed: candidates.length - failed, failed }
    },
    successMessage: (r: { pushed: number; failed: number }) =>
      r.pushed === 0 && r.failed === 0 ? 'All tasks already in Google Tasks'
      : r.failed > 0 ? `Pushed ${r.pushed}, ${r.failed} failed ⚠`
      : `Pushed ${r.pushed} task${r.pushed === 1 ? '' : 's'} to Google ✓`,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
