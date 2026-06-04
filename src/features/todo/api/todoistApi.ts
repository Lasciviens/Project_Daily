import type { Task } from '../types'

const BASE = 'https://api.todoist.com/rest/v2'

// priority mapping: our low/medium/high → Todoist 1/2/3
const PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3 }

async function todoistFetch<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Todoist ${res.status}: ${err}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

interface TodoistTask { id: string }

export async function createTodoistTask(token: string, task: Task): Promise<string> {
  const body: Record<string, unknown> = {
    content:  task.title,
    priority: PRIORITY[task.priority] ?? 1,
    labels:   task.domain !== 'personal' ? [task.domain] : [],
  }
  if (task.due_date) body.due_date = task.due_date

  const result = await todoistFetch<TodoistTask>('POST', '/tasks', token, body)
  return result.id
}

export async function closeTodoistTask(token: string, todoistId: string): Promise<void> {
  await todoistFetch<void>('POST', `/tasks/${todoistId}/close`, token)
}

export async function reopenTodoistTask(token: string, todoistId: string): Promise<void> {
  await todoistFetch<void>('POST', `/tasks/${todoistId}/reopen`, token)
}

export async function deleteTodoistTask(token: string, todoistId: string): Promise<void> {
  await todoistFetch<void>('DELETE', `/tasks/${todoistId}`, token)
}

// localStorage mapping: supabaseId → todoistId
const MAPPING_KEY = 'todoist-task-map'

function getMapping(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAPPING_KEY) ?? '{}') }
  catch { return {} }
}

export function saveTodoistMapping(supabaseId: string, todoistId: string) {
  const map = getMapping()
  map[supabaseId] = todoistId
  localStorage.setItem(MAPPING_KEY, JSON.stringify(map))
}

export function getTodoistId(supabaseId: string): string | undefined {
  return getMapping()[supabaseId]
}

export function removeTodoistMapping(supabaseId: string) {
  const map = getMapping()
  delete map[supabaseId]
  localStorage.setItem(MAPPING_KEY, JSON.stringify(map))
}
