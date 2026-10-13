// What a task write looks like before and after the database answers — pure,
// so scripts/verify-delete-flow.cjs can check it. useTodos patches every
// cached list with applyTaskPatch at once (the tick shows on the tap), then
// replaces it with the row the write returned, and says taskUpdateMessage.
import type { Task, UpdateTaskInput } from './types'

// The task as the user sees it right after an action, before the database
// answers: the same rules the database applies (completed_at, migration 129;
// a closed task leaves the focus, migration 143). The write's own answer then
// replaces it, and a failed write puts the old one back.
export function applyTaskPatch(task: Task, patch: UpdateTaskInput, now: string): Task {
  const next = { ...task, ...patch } as Task
  if (patch.status !== undefined && patch.status !== task.status) {
    const closed = patch.status === 'done' || patch.status === 'cancelled'
    next.completed_at = closed ? now : null
    if (closed) next.is_focused = false
  }
  return next
}

/** What a task edit tells the user (the result of the action, not a re-read). */
export function taskUpdateMessage(patch: UpdateTaskInput): string {
  const keys = Object.keys(patch).filter(k => k !== 'updated_at')
  if (patch.status === 'cancelled') return 'Task cancelled'
  if (patch.status === 'done') return 'Task done'
  if (patch.is_focused === true) return patch.status === 'in_progress' ? 'In focus · started' : 'Added to focus'
  if (patch.is_focused === false && keys.length === 1) return 'Removed from focus'
  if (patch.status === 'open') return 'Task reopened'
  if (patch.status === 'in_progress') return 'Task started'
  if (patch.status === 'waiting') return patch.waiting_for ? `Waiting for ${patch.waiting_for}` : 'Task waiting'
  if (patch.google_tasklist_id !== undefined && keys.length === 1) return 'Moved to the other list'
  if (patch.google_sync_enabled !== undefined && keys.length === 1) return patch.google_sync_enabled ? 'Syncing with Google Tasks' : 'No longer on Google Tasks'
  return 'Task saved'
}
