import { format } from 'date-fns'
import type { Task } from '../types'

const BASE = 'https://www.googleapis.com/tasks/v1'

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
  if (!res.ok) throw new Error(data?.error?.message ?? `Google Tasks error ${res.status}`)
  return data
}

export async function createGoogleTask(token: string, task: Task): Promise<string> {
  const body: Record<string, unknown> = { title: task.title }
  // Use noon local time to avoid midnight-UTC off-by-one across timezones
  if (task.due_date) body.due = new Date(task.due_date + 'T12:00:00').toISOString()
  if (task.description) body.notes = task.description
  const result = await request(token, '/lists/@default/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as { id: string }
  return result.id
}

export async function completeGoogleTask(token: string, googleTaskId: string): Promise<void> {
  await request(token, `/lists/@default/tasks/${googleTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  })
}

export async function reopenGoogleTask(token: string, googleTaskId: string): Promise<void> {
  await request(token, `/lists/@default/tasks/${googleTaskId}`, {
    method: 'PATCH',
    // completed must be cleared when reopening
    body: JSON.stringify({ status: 'needsAction', completed: null }),
  })
}

export async function deleteGoogleTask(token: string, googleTaskId: string): Promise<void> {
  await request(token, `/lists/@default/tasks/${googleTaskId}`, { method: 'DELETE' })
}

export interface GoogleRemoteTask {
  id:      string
  title:   string
  notes?:  string
  status:  'needsAction' | 'completed'
  due?:    string
  updated: string
  deleted?: boolean
  hidden?:  boolean
  parent?:  string
}

export async function fetchGoogleTasks(token: string): Promise<GoogleRemoteTask[]> {
  const data = await request(token, '/lists/@default/tasks?showCompleted=false&showHidden=false') as { items?: GoogleRemoteTask[] }
  return data?.items ?? []
}

// ── localStorage mapping: supabaseId → googleTaskId ──────────────────────────

const MAPPING_KEY = 'google-task-map'

function getMapping(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAPPING_KEY) ?? '{}') }
  catch { return {} }
}

export function saveGoogleTaskMapping(supabaseId: string, googleTaskId: string) {
  const map = getMapping()
  map[supabaseId] = googleTaskId
  localStorage.setItem(MAPPING_KEY, JSON.stringify(map))
}

export function getGoogleTaskId(supabaseId: string): string | undefined {
  return getMapping()[supabaseId]
}

export function removeGoogleTaskMapping(supabaseId: string) {
  const map = getMapping()
  delete map[supabaseId]
  localStorage.setItem(MAPPING_KEY, JSON.stringify(map))
}

export function getSupabaseIdByGoogleTaskId(googleTaskId: string): string | undefined {
  return Object.entries(getMapping()).find(([, gid]) => gid === googleTaskId)?.[0]
}

// due comes back as RFC 3339 midnight UTC — convert to local date string 'yyyy-MM-dd'
export function googleDueToLocalDate(due: string): string {
  return format(new Date(due), 'yyyy-MM-dd')
}
