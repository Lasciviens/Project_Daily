import type { Task } from '../types'
import {
  dateToGoogleDue, googleErrorReasons, googleTasksFailureKind, googleTasksFailureText,
  type GoogleTasksFailureKind,
} from './googleTasksRules'

const BASE = 'https://www.googleapis.com/tasks/v1'

// A typed error carrying the real HTTP status — mirrors calendarApi.ts's
// CalendarApiError/isCalendarNotFound. Every "was this task genuinely
// deleted, or did the request merely fail?" decision must go through
// isGoogleTaskNotFound, never a string match against the error message
// (a Google error body can carry only a human message like "Not Found"
// with no digits in it at all).
export class GoogleTasksApiError extends Error {
  readonly status: number
  /** What it means for the owner (googleTasksRules.googleTasksFailureKind). */
  readonly kind: GoogleTasksFailureKind
  constructor(status: number, message: string, kind: GoogleTasksFailureKind = googleTasksFailureKind(status, [])) {
    super(message)
    this.name = 'GoogleTasksApiError'
    this.status = status
    this.kind = kind
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
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const kind = googleTasksFailureKind(res.status, googleErrorReasons(data))
    throw new GoogleTasksApiError(res.status, googleTasksFailureText(kind, res.status, data?.error?.message), kind)
  }
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

export async function getGoogleTask(token: string, googleListId: string, googleTaskId: string): Promise<GoogleRemoteTask> {
  return request(token, `/lists/${googleListId}/tasks/${googleTaskId}`) as Promise<GoogleRemoteTask>
}

export async function createGoogleTask(
  token: string, googleListId: string, task: Task,
  opts?: { parent?: string; previous?: string },
): Promise<GoogleRemoteTask> {
  const body: Record<string, unknown> = { title: task.title }
  const due = dateToGoogleDue(task.due_date)
  if (due) body.due = due
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
    due:   dateToGoogleDue(task.due_date),
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
