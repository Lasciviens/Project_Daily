import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  fetchTasksByIds,
  fetchSubtasks,
  createTask,
  updateTask,
  toggleTaskDone,
} from '../api/tasksApi'
import { drainGoogleTasksOutbox } from '../api/googleTasksOutbox'
import { pullGoogleTasks } from '../api/googleTasksSync'
import { updateTimeBlock, fetchTimeBlockByTaskId, fetchCalendarLinkedTaskIds } from '../../daily/api/scheduleApi'
import { toast, useCalendarStore } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { mapRowsInCache, putRowsInCache, restoreCache, snapshotCache } from '../../../shared/query/cachePatch'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { rowsOf, type RowOverrides } from '../../../shared/utils/deletedRows'
import { BLOCK_EVENT_RESET, relinkRestoredBlockEvents, removeDeletedBlockEvents } from '../../calendar/api/deletedBlockEvents'
import { dayTasks, isOpenTask, openOnDay, sectionForDay, weekCounts } from '../taskRules'
import { todayStr } from '../../../shared/utils/dateUtils'
import { applyTaskPatch, taskUpdateMessage } from '../taskWrites'
import type { CreateTaskInput, UpdateTaskInput, Task } from '../types'

// Aggregated overview of every active task (+ recently done) — the Daily "Tasks"
// tab groups these into Overdue / Today / Upcoming / No date / Done.
export function useAllTasks() {
  return useQuery({
    queryKey: qk.tasks.list(),
    queryFn: fetchAllTasks,
    staleTime: STALE.live,
  })
}

export function useTasksBySection(section: string, enabled = true) {
  return useQuery({
    queryKey: qk.tasks.section(section),
    queryFn: () => fetchTasksBySection(section),
    staleTime: STALE.live,
    enabled,
  })
}

export function useOpenTrainingSessionTasks() {
  return useQuery({
    queryKey: qk.tasks.trainingOpen(),
    queryFn: fetchOpenTrainingSessionTasks,
    staleTime: STALE.live,
  })
}

/**
 * THE day list (Daily's day pane and rail, Home's tasks card, overview and
 * brief, the week strip's today count): one read, split by taskRules.dayTasks
 * — open (overdue first), done and cancelled on that day, and their counts.
 */
export function useDayTasks(day: string) {
  const today = todayStr()
  const query = useQuery({
    queryKey: qk.tasks.day(day, today),
    queryFn: () => fetchTasksForDay(day, today),
    staleTime: STALE.live,
  })
  const split = useMemo(() => dayTasks(query.data ?? [], day, today), [query.data, day, today])
  return { ...split, section: sectionForDay(day, today), isLoading: query.isLoading, ready: query.data !== undefined, isError: query.isError && query.data === undefined, refetch: query.refetch }
}

/**
 * Open tasks on a day, as the week strips count them: today's from the day
 * list (its overdue and undated Today rows count, as the day pane shows), any
 * other day's from `tasks` (due that day).
 */
export function useOpenOnDay(tasks: readonly Task[]): (day: string) => number {
  const today = todayStr()
  const todayOpen = useDayTasks(today).counts.open
  return useCallback((day: string) => (day === today ? todayOpen : openOnDay(tasks, day, today)), [tasks, today, todayOpen])
}

/** A week's open / done / % (taskRules.weekCounts) over the week read and today's list. */
export function useWeekCounts(weekTasks: readonly Task[], from: string, to: string) {
  const today = todayStr()
  const todayList = useDayTasks(today)
  return useMemo(() => weekCounts({
    weekTasks, todayTasks: todayList.open, from, to, today,
  }), [weekTasks, todayList.open, from, to, today])
}

export function useTasksByWeek(weekStart: Date, weekEnd: Date) {
  const startStr = format(weekStart, 'yyyy-MM-dd')
  const endStr   = format(weekEnd,   'yyyy-MM-dd')
  return useQuery({
    queryKey: qk.tasks.week(startStr, endStr),
    queryFn: () => fetchTasksByWeek(startStr, endStr),
  })
}

export function useTasksByMonth(monthStart: Date, monthEnd: Date) {
  const startStr = format(monthStart, 'yyyy-MM-dd')
  const endStr   = format(monthEnd,   'yyyy-MM-dd')
  return useQuery({
    queryKey: qk.tasks.month(startStr, endStr),
    queryFn: () => fetchTasksByMonth(startStr, endStr),
  })
}

// Best-effort: drain whatever migration 071's DB triggers just enqueued so a
// create/edit/toggle/delete still feels instant when Google is reachable.
// The outbox (populated atomically with the tasks write, not by this call)
// is the actual safety net — a failure here just means "will retry later",
// never a lost operation.
export async function drainBestEffort(token: string | null, context: Record<string, unknown>): Promise<string | null> {
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

/**
 * Delivers the Google Tasks outbox in the background: the save is done and
 * reported as soon as the database answers (owner, 13.10.2026: "the UI keeps
 * me waiting while it saves"); Google follows a moment later. Concurrent
 * drains are safe (the outbox claim skips rows another drain holds).
 */
export function syncGoogleTasksSoon(context: Record<string, unknown>, warn = false): void {
  const token = useCalendarStore.getState().accessToken
  if (!token) return
  void drainBestEffort(token, context).then(err => {
    if (err && warn) toast.warning(`Google Tasks sync failed: ${err}`)
  })
}

// Every task mutation below is built on useMutationWithFeedback: errors are
// always toasted + logged, and the result is said once the write answers.
// `report: false` is for a multi-step save that reports the whole result
// itself (the plan editor's "Saved").

export function useCreateTask({ report = true }: { report?: boolean } = {}) {
  return useMutationWithFeedback({
    action: 'create_task',
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
      // this delivers it promptly instead of waiting for the next drain.
      if (googleSyncEnabled) syncGoogleTasksSoon({ taskId: task.id }, true)
      return { task }
    },
    successMessage: () => (report ? 'Task added' : undefined),
    invalidates: [qk.tasks.all],
  })
}

export function useUpdateTask({ report = true }: { report?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_task',
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateTaskInput }) => {
      const task = await updateTask(id, patch)
      // Whether this edit touched a Google-synced field is decided by
      // migration 071's DB trigger (it has OLD/NEW); this only delivers what
      // it enqueued — in the background.
      syncGoogleTasksSoon({ taskId: id })

      // Task title is canonical (migration 077) — a DB trigger already kept
      // the linked time_block's OWN title in sync regardless of which door
      // wrote it, but the REMOTE Google Calendar event needs an explicit
      // push here since a trigger has no OAuth token to reach it with.
      // Routed through scheduleApi's updateTimeBlock so it shares the typed
      // calendar-status lifecycle of every other calendar push. In the
      // background: the task is saved; the calendar follows.
      if (patch.title !== undefined && useCalendarStore.getState().accessToken) {
        void (async () => {
          try {
            const linked = await fetchTimeBlockByTaskId(id)
            if (linked?.id) await updateTimeBlock(linked.id, { title: task.title })
          } catch (err) {
            logError(`Calendar event title sync failed: ${(err as Error).message}`, { taskId: id })
          }
        })()
      }
      return task
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all })
      const snapshot = snapshotCache(qc, qk.tasks.all)
      const now = new Date().toISOString()
      mapRowsInCache<Task>(qc, qk.tasks.all, new Set([id]), t => applyTaskPatch(t, patch, now))
      return { snapshot }
    },
    onSuccess: task => putRowsInCache(qc, qk.tasks.all, [task]),
    onError: (_err, _vars, ctx) => { if (ctx) restoreCache(qc, ctx.snapshot) },
    successMessage: (_task, { patch }) => (report ? taskUpdateMessage(patch) : undefined),
    // A task edit can move/retitle a linked schedule block — keep schedule
    // views in sync (the plan modal syncs the block itself).
    invalidates: ['taskGraph'],
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'toggle_task',
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const task = await toggleTaskDone(id, isDone)
      syncGoogleTasksSoon({ taskId: id })
      return task
    },
    onMutate: async ({ id, isDone }) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all })
      const snapshot = snapshotCache(qc, qk.tasks.all)
      const now = new Date().toISOString()
      mapRowsInCache<Task>(qc, qk.tasks.all, new Set([id]), t => applyTaskPatch(t, { status: isDone ? 'done' : 'open' }, now))
      return { snapshot }
    },
    onSuccess: task => putRowsInCache(qc, qk.tasks.all, [task]),
    onError: (_err, _vars, ctx) => { if (ctx) restoreCache(qc, ctx.snapshot) },
    successMessage: (_task, { isDone }) => (isDone ? 'Task done' : 'Task reopened'),
    // The schedule reads carry each block's task status (Training's "next
    // session", the agenda's Done) — a tick refreshes them too.
    invalidates: ['taskGraph'],
  })
}

/**
 * A task put back by Undo had its Google Task deleted on Google: it comes
 * back without the old Google ids, and the outbox creates a new one (its
 * sync switch and list stay). google_hidden/google_deleted are NOT NULL
 * (migration 071) — false, never null, or the whole Undo fails.
 */
export const TASK_GOOGLE_RESET: RowOverrides = {
  tasks: {
    google_task_id: null, google_etag: null, google_position: null, google_updated_at: null,
    google_web_view_link: null, google_links: null, google_local_edit_at: null,
    google_calendar_event_id: null, google_hidden: false, google_deleted: false,
  },
}

/**
 * THE task delete: one call deletes the task and returns what went with it —
 * its schedule slot (and that slot's Google Calendar event, removed right
 * after), its training skip, and the subtasks, wish and shopping item that
 * pointed at it (migration 144). Undo puts all of it back with the same ids;
 * Google Task and Calendar copies are made again.
 *   del.run([task.id], { title: 'Delete this task?', done: 'Task deleted' })
 */
export function useDeleteTask() {
  return useRowsDelete({
    table: 'tasks',
    action: 'delete_task',
    invalidates: ['taskGraph', qk.training.skipsAll, qk.wishes.all],
    cache: qk.tasks.all,
    afterDelete: async snapshot => {
      await removeDeletedBlockEvents(snapshot)
      for (const t of rowsOf<Task>(snapshot, 'tasks')) syncGoogleTasksSoon({ taskId: t.id })
    },
    overrides: () => ({ ...TASK_GOOGLE_RESET, ...BLOCK_EVENT_RESET }),
    afterRestore: async snapshot => {
      for (const t of rowsOf<Task>(snapshot, 'tasks')) if (t.google_sync_enabled) syncGoogleTasksSoon({ taskId: t.id })
      return relinkRestoredBlockEvents(snapshot)
    },
  })
}

// One task by id — entity popups re-read through this, and ToDoItem's
// "↳ Subtask of …" chip uses it (cached by id, so a parent shared by many
// rows costs one request). The only by-id key is qk.tasks.byId ('by-id').
export function useTaskById(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.tasks.byId(id ?? ''),
    queryFn: () => fetchTaskById(id as string),
    enabled: !!id,
    staleTime: STALE.live,
  })
}

/** Several tasks by id in one request (e.g. the day agenda's linked-task details). */
export function useTasksByIds(ids: readonly string[]) {
  return useQuery({
    queryKey: qk.tasks.byIds(ids),
    queryFn: () => fetchTasksByIds(ids),
    enabled: ids.length > 0,
    staleTime: STALE.live,
  })
}

// Direct children for ToDoItem's inline "N subtasks" expand.
export function useSubtasks(parentTaskId: string, enabled = true) {
  return useQuery({
    queryKey: qk.tasks.subtasks(parentTaskId),
    queryFn: () => fetchSubtasks(parentTaskId),
    enabled,
    staleTime: STALE.live,
  })
}

export function useSetParentTask() {
  return useMutationWithFeedback({
    action: 'set_parent_task',
    mutationFn: async ({ id, parentTaskId }: { id: string; parentTaskId: string | null }) => {
      const task = await updateTask(id, { parent_task_id: parentTaskId })
      // A parent_task_id change is a Google-visible field (migration 071's
      // trigger enqueues 'update'/'move' for it).
      syncGoogleTasksSoon({ taskId: id })
      return task
    },
    successMessage: (_task, { parentTaskId }) => (parentTaskId ? 'Now a subtask' : 'No longer a subtask'),
    invalidates: [qk.tasks.all],
  })
}

export function useWorkTasks() {
  return useQuery({
    queryKey: qk.tasks.work(),
    queryFn: fetchWorkTasks,
  })
}

// Full pull from Google Tasks (every list, real pagination, tombstones
// included) — reconciles local against Google's true state rather than
// only ever importing genuinely-new tasks. Was unreachable from any UI
// before 20.08.2026 (a "known side effect" of the old To-Do
// drawer's removal); wired up via GoogleTasksSyncButtons.
export function useSyncFromGoogleTasks() {
  return useMutationWithFeedback({
    action: 'sync_from_google_tasks',
    mutationFn: async () => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')
      const { imported } = await pullGoogleTasks(token)
      return imported
    },
    successMessage: (count: number) =>
      count > 0 ? `Synced ${count} task${count === 1 ? '' : 's'} from Google` : 'Google Tasks already up to date',
    invalidates: [qk.tasks.all, qk.googleTaskLists.all],
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
  return useMutationWithFeedback({
    action: 'push_to_google_tasks',
    mutationFn: async (tasks: Task[]) => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')

      const notYetSynced = tasks.filter(t =>
        !t.google_task_id && isOpenTask(t))

      const calendarLinkedIds = await fetchCalendarLinkedTaskIds(notYetSynced.map(t => t.id))
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
      : r.failed > 0 ? `Pushed ${r.pushed}, ${r.failed} failed`
      : `Pushed ${r.pushed} task${r.pushed === 1 ? '' : 's'} to Google`,
    invalidates: [qk.tasks.all],
  })
}
