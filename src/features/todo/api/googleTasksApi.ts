import { format } from 'date-fns'
import type { Task } from '../types'

const BASE = 'https://www.googleapis.com/tasks/v1'

// A typed error carrying the real HTTP status — mirrors calendarApi.ts's
// CalendarApiError/isCalendarNotFound. Every "was this task genuinely
// deleted, or did the request merely fail?" decision must go through
// isGoogleTaskNotFound, never a string match against the error message
// (a Google error body can carry only a human message like "Not Found"
// with no digits in it at all).
export class GoogleTasksApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GoogleTasksApiError'
    this.status = status
  }
}
export function isGoogleTaskNotFound(error: unknown): boolean {
  return error instanceof GoogleTasksApiError && error.status === 404
}

async function request(token: string, path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new GoogleTasksApiError(res.status, data?.error?.message ?? `Google Tasks error ${res.status}`)
  return data
}

// ═══════════════════════════════════════════════════════════════════════════
// Task lists (google_task_lists mirror — migration 071)
// ═══════════════════════════════════════════════════════════════════════════

export interface GoogleRemoteTaskList {
  id:      string
  title:   string
  etag:    string
  updated: string
}

export async function fetchGoogleTaskLists(token: string): Promise<GoogleRemoteTaskList[]> {
  const out: GoogleRemoteTaskList[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '100', ...(pageToken ? { pageToken } : {}) })
    const data = await request(token, `/users/@me/lists?${qs}`) as { items?: GoogleRemoteTaskList[]; nextPageToken?: string }
    out.push(...(data.items ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

// The TaskList resource itself carries no "is this the default list" flag —
// resolve it by fetching the @default alias and matching its real id against
// fetchGoogleTaskLists' results (never assume a list's own `id` literally
// equals the string "@default").
export async function fetchDefaultGoogleTaskList(token: string): Promise<GoogleRemoteTaskList> {
  return request(token, '/users/@me/lists/@default') as Promise<GoogleRemoteTaskList>
}

export async function createGoogleTaskList(token: string, title: string): Promise<GoogleRemoteTaskList> {
  return request(token, '/users/@me/lists', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }) as Promise<GoogleRemoteTaskList>
}

export async function renameGoogleTaskList(token: string, googleListId: string, title: string): Promise<GoogleRemoteTaskList> {
  return request(token, `/users/@me/lists/${googleListId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  }) as Promise<GoogleRemoteTaskList>
}

export async function deleteGoogleTaskList(token: string, googleListId: string): Promise<void> {
  await request(token, `/users/@me/lists/${googleListId}`, { method: 'DELETE' })
}

// ═══════════════════════════════════════════════════════════════════════════
// Tasks
// ═══════════════════════════════════════════════════════════════════════════

export interface GoogleRemoteTask {
  id:           string
  title:        string
  notes?:       string
  status:       'needsAction' | 'completed'
  due?:         string
  completed?:   string
  updated:      string
  deleted?:     boolean
  hidden?:      boolean
  parent?:      string
  position?:    string
  etag?:        string
  webViewLink?: string
  links?:       unknown[]
}

interface TasksListResponse {
  items?:        GoogleRemoteTask[]
  nextPageToken?: string
}

async function paginateTasks(token: string, googleListId: string, params: Record<string, string>): Promise<GoogleRemoteTask[]> {
  const out: GoogleRemoteTask[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '100', ...params, ...(pageToken ? { pageToken } : {}) })
    const data = await request(token, `/lists/${googleListId}/tasks?${qs}`) as TasksListResponse
    out.push(...(data.items ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

// Normal UI-facing fetch: undone-or-done tasks Google would show by default,
// but never hidden/deleted tombstones — those are sync-engine data, not
// something a plain "what's in my Google Tasks" view needs to see.
export async function fetchVisibleGoogleTasks(token: string, googleListId = '@default'): Promise<GoogleRemoteTask[]> {
  return paginateTasks(token, googleListId, { showCompleted: 'true', showHidden: 'false', showDeleted: 'false' })
}

// First-time (or forced re-) full sync: every task including hidden/deleted
// tombstones, real pagination — this is what lets local fully mirror Google's
// state instead of only ever seeing the not-yet-hidden subset.
export async function fullGoogleTasksSync(token: string, googleListId = '@default'): Promise<GoogleRemoteTask[]> {
  return paginateTasks(token, googleListId, { showCompleted: 'true', showHidden: 'true', showDeleted: 'true' })
}

// Poll for what changed since the last successful sync. Callers should pass
// a cutoff a little EARLIER (~60s) than their stored "last synced" timestamp
// to absorb clock-skew / request-boundary edge cases and dedupe the overlap
// by task id afterwards — this function does not do that itself.
export async function incrementalGoogleTasksSync(token: string, googleListId: string, updatedMinIso: string): Promise<GoogleRemoteTask[]> {
  return paginateTasks(token, googleListId, {
    showCompleted: 'true', showHidden: 'true', showDeleted: 'true',
    updatedMin: updatedMinIso,
  })
}

export async function getGoogleTask(token: string, googleListId: string, googleTaskId: string): Promise<GoogleRemoteTask> {
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}`) as Promise<GoogleRemoteTask>
}

export async function createGoogleTask(
  token: string, googleListId: string, task: Task,
  opts?: { parent?: string; previous?: string },
): Promise<GoogleRemoteTask> {
  const body: Record<string, unknown> = { title: task.title }
  // Use noon local time to avoid midnight-UTC off-by-one across timezones
  if (task.due_date) body.due = new Date(task.due_date + 'T12:00:00').toISOString()
  if (task.description) body.notes = task.description
  const qs = new URLSearchParams()
  if (opts?.parent)   qs.set('parent', opts.parent)
  if (opts?.previous) qs.set('previous', opts.previous)
  const suffix = qs.toString() ? `?${qs}` : ''
  return request(token, `/lists/${googleListId}/tasks${suffix}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<GoogleRemoteTask>
}

export async function updateGoogleTask(token: string, googleListId: string, googleTaskId: string, task: Task): Promise<GoogleRemoteTask> {
  const body: Record<string, unknown> = {
    title: task.title,
    notes: task.description ?? '',
    due:   task.due_date ? new Date(task.due_date + 'T12:00:00').toISOString() : null,
  }
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as Promise<GoogleRemoteTask>
}

export async function completeGoogleTask(token: string, googleListId: string, googleTaskId: string): Promise<GoogleRemoteTask> {
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  }) as Promise<GoogleRemoteTask>
}

export async function reopenGoogleTask(token: string, googleListId: string, googleTaskId: string): Promise<GoogleRemoteTask> {
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}`, {
    method: 'PATCH',
    // completed must be cleared when reopening
    body: JSON.stringify({ status: 'needsAction', completed: null }),
  }) as Promise<GoogleRemoteTask>
}

export async function deleteGoogleTask(token: string, googleListId: string, googleTaskId: string): Promise<void> {
  await request(token, `/lists/${googleListId}/tasks/${googleTaskId}`, { method: 'DELETE' })
}

// tasks.move — the ONLY way to change parent/position/list after creation.
// Both fields are output-only on patch/update per the Tasks API v1 discovery
// document (verified live, not assumed) — insert() can set an initial
// parent/previous via query params, but re-parenting or reordering an
// EXISTING task always goes through this endpoint.
export async function moveGoogleTask(
  token: string, googleListId: string, googleTaskId: string,
  opts: { destinationTasklist?: string; parent?: string; previous?: string },
): Promise<GoogleRemoteTask> {
  const qs = new URLSearchParams()
  if (opts.destinationTasklist) qs.set('destinationTasklist', opts.destinationTasklist)
  if (opts.parent)               qs.set('parent', opts.parent)
  if (opts.previous)             qs.set('previous', opts.previous)
  const suffix = qs.toString() ? `?${qs}` : ''
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}/move${suffix}`, {
    method: 'POST',
  }) as Promise<GoogleRemoteTask>
}

// Marks every completed task in the list 'hidden' — distinct from delete.
// No UI trigger yet (low priority per the phase plan); kept for full API
// coverage so the capability exists once a "clear completed" button is wanted.
export async function clearCompletedGoogleTasks(token: string, googleListId: string): Promise<void> {
  await request(token, `/lists/${googleListId}/clear`, { method: 'POST' })
}

// due comes back as RFC 3339 midnight UTC — convert to local date string 'yyyy-MM-dd'
export function googleDueToLocalDate(due: string): string {
  return format(new Date(due), 'yyyy-MM-dd')
}
