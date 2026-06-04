import { supabase } from '../../../integrations/supabase/client'
import type { Task } from '../types'

const PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3 }

async function todoistProxy(action: string, taskId?: string, task?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('todoist-proxy', {
    body: { action, taskId, task },
  })
  if (error) {
    let detail = error.message
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any).context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function createTodoistTask(task: Task): Promise<string> {
  const body: Record<string, unknown> = {
    content:  task.title,
    priority: PRIORITY[task.priority] ?? 1,
  }
  if (task.due_date) body.due_date = task.due_date

  const result = await todoistProxy('create', undefined, body) as { id: string }
  return result.id
}

export async function closeTodoistTask(todoistId: string): Promise<void> {
  await todoistProxy('close', todoistId)
}

export async function reopenTodoistTask(todoistId: string): Promise<void> {
  await todoistProxy('reopen', todoistId)
}

export async function deleteTodoistTask(todoistId: string): Promise<void> {
  await todoistProxy('delete', todoistId)
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

export function getSupabaseIdByTodoistId(todoistId: string): string | undefined {
  const map = getMapping()
  return Object.entries(map).find(([, tid]) => tid === todoistId)?.[0]
}

export interface TodoistRemoteTask {
  id:           string
  content:      string
  priority:     number   // 1=normal 2=medium 3=high 4=urgent
  due:          { date: string } | null
  is_completed: boolean
}

const PRIORITY_FROM_TODOIST: Record<number, Task['priority']> = {
  1: 'low', 2: 'medium', 3: 'high', 4: 'high',
}

export async function fetchTodoistTasks(): Promise<TodoistRemoteTask[]> {
  const result = await todoistProxy('list') as TodoistRemoteTask[]
  return Array.isArray(result) ? result : []
}

export function todoistPriorityToLocal(p: number): Task['priority'] {
  return PRIORITY_FROM_TODOIST[p] ?? 'low'
}
