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
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  swapTaskOrder,
} from '../api/tasksApi'
import {
  fetchGoogleTasks,
  googleDueToLocalDate,
  getSupabaseIdByGoogleTaskId,
  createGoogleTask,
  updateGoogleTask,
  completeGoogleTask,
  reopenGoogleTask,
  deleteGoogleTask,
  saveGoogleTaskMapping,
  getGoogleTaskId,
  removeGoogleTaskMapping,
} from '../api/googleTasksApi'
import { useCalendarStore } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { CreateTaskInput, UpdateTaskInput } from '../types'

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

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    // `skipGoogleTasks` is set by the plan modal when this task will also be
    // represented as a linked Google Calendar EVENT (via its time block).
    // Without it the same task shows up on Google Calendar twice — once as a
    // Google Task, once as the event — the "task duplicate" bug. The calendar
    // event is the canonical two-way-linked record (time_blocks
    // .google_calendar_event_id + migrations 038/043), so the Google Task copy
    // is suppressed in that case.
    mutationFn: async ({ skipGoogleTasks, ...input }: CreateTaskInput & { skipGoogleTasks?: boolean }) => {
      const task = await createTask(input)
      // Sync to Google Tasks — soft failure (never blocks the Supabase write)
      const token = useCalendarStore.getState().accessToken
      let googleTaskError: string | null = null
      if (token && !skipGoogleTasks) {
        try {
          const googleTaskId = await createGoogleTask(token, task)
          // Persist to Supabase (cross-device) and localStorage (fallback)
          await updateTask(task.id, { google_task_id: googleTaskId })
          saveGoogleTaskMapping(task.id, googleTaskId)
        } catch (err) {
          googleTaskError = err instanceof Error ? err.message : 'Google Tasks sync failed'
          logError(`Google Tasks create failed: ${googleTaskError}`, { taskId: task.id })
        }
      }
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
      // Real gap fixed 20/08/2026: only create/toggle-done/delete used to sync
      // to Google Tasks — a plain edit (reschedule the due date, fix a typo,
      // add notes) never did, so the Google-side copy went stale immediately.
      // Only bother Google when a synced field actually changed; skip a
      // priority/section-only edit that Google Tasks has no field for anyway.
      const syncedFieldChanged = patch.title !== undefined || patch.description !== undefined || patch.due_date !== undefined
      if (syncedFieldChanged && task.google_task_id) {
        const token = useCalendarStore.getState().accessToken
        if (token) {
          try { await updateGoogleTask(token, task.google_task_id, task) }
          catch (err) { logError(`Google Tasks update failed: ${err instanceof Error ? err.message : String(err)}`, { taskId: id }) }
        }
      }
      return task
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      // A task edit can move/retitle a linked schedule block — keep schedule
      // views in sync (the plan modal syncs the block itself).
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const task = await toggleTaskDone(id, isDone)
      // Prefer google_task_id from Supabase (cross-device), fall back to localStorage
      const googleTaskId = task.google_task_id ?? getGoogleTaskId(id)
      if (googleTaskId) {
        const token = useCalendarStore.getState().accessToken
        if (token) {
          try {
            if (isDone) await completeGoogleTask(token, googleTaskId)
            else        await reopenGoogleTask(token, googleTaskId)
          } catch (err) {
            logError(`Google Tasks toggle failed: ${err instanceof Error ? err.message : String(err)}`, { taskId: id })
          }
        }
      }
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
    mutationFn: async (taskOrId: string | import('../types').Task) => {
      const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
      // Prefer google_task_id from passed task object, then localStorage fallback
      const googleTaskId = (typeof taskOrId === 'object' ? taskOrId.google_task_id : null)
        ?? getGoogleTaskId(id)
      if (googleTaskId) {
        const token = useCalendarStore.getState().accessToken
        if (token) {
          try { await deleteGoogleTask(token, googleTaskId) } catch (err) {
            logError(`Google Tasks delete failed: ${err instanceof Error ? err.message : String(err)}`, { taskId: id })
          }
        }
        removeGoogleTaskMapping(id)
      }
      return deleteTask(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
}

export function useWorkTasks() {
  return useQuery({
    queryKey: ['tasks', 'work'],
    queryFn: fetchWorkTasks,
  })
}

// Pull tasks from Google Tasks → import new ones to inbox. Was defined but
// unreachable from any UI (CLAUDE.md's "known side effect" of the old To-Do
// drawer's removal) — wired up 20/08/2026 via GoogleTasksSyncButtons. Also
// fixed a real drop here: `rt.notes` (a task's notes/detail written in the
// Google Tasks app) was fetched but never carried into the imported row.
export function useSyncFromGoogleTasks() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'sync_from_google_tasks',
    mutationFn: async () => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')
      const remoteTasks = await fetchGoogleTasks(token)
      let imported = 0
      for (const rt of remoteTasks) {
        if (getSupabaseIdByGoogleTaskId(rt.id)) continue
        const newTask = await createTask({
          title:       rt.title,
          description: rt.notes ?? null,
          section:     'inbox',
          priority:    'medium',
          domain:      'personal',
          due_date:    rt.due ? googleDueToLocalDate(rt.due) : undefined,
        })
        saveGoogleTaskMapping(newTask.id, rt.id)
        // Persist to Supabase for cross-device sync
        try { await updateTask(newTask.id, { google_task_id: rt.id }) } catch { /* non-fatal */ }
        imported++
      }
      return imported
    },
    successMessage: (imported: number) => imported > 0 ? `Imported ${imported} task${imported === 1 ? '' : 's'} from Google ✓` : 'No new tasks in Google Tasks',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// Push local tasks not yet in Google Tasks → create them there. Same
// unreachable-until-20/08/2026 story as the pull direction above. This is a
// "catch up" action for tasks created before Google was connected, or whose
// create-time sync silently failed (useCreateTask never blocks on it) — every
// NEW task already gets pushed automatically going forward.
export function usePushToGoogleTasks() {
  return useMutationWithFeedback({
    action: 'push_to_google_tasks',
    mutationFn: async (tasks: import('../types').Task[]) => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')
      let pushed = 0
      let failed = 0
      for (const task of tasks) {
        if (getGoogleTaskId(task.id)) continue
        if (task.status === 'done' || task.status === 'cancelled') continue
        try {
          const googleTaskId = await createGoogleTask(token, task)
          saveGoogleTaskMapping(task.id, googleTaskId)
          // Persist to Supabase for cross-device sync
          try { await updateTask(task.id, { google_task_id: googleTaskId }) } catch { /* non-fatal */ }
          pushed++
        } catch {
          failed++
        }
      }
      return { pushed, failed }
    },
    successMessage: (r: { pushed: number; failed: number }) =>
      r.pushed === 0 && r.failed === 0 ? 'All tasks already in Google Tasks'
      : r.failed > 0 ? `Pushed ${r.pushed}, ${r.failed} failed ⚠`
      : `Pushed ${r.pushed} task${r.pushed === 1 ? '' : 's'} to Google ✓`,
  })
}
