import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchTasksBySection,
  fetchTasksForDay,
  fetchTasksByWeek,
  fetchTasksByMonth,
  fetchWorkTasks,
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  swapTaskOrder,
} from '../api/tasksApi'
import {
  fetchTodoistTasks,
  todoistPriorityToLocal,
  getSupabaseIdByTodoistId,
  createTodoistTask,
  closeTodoistTask,
  reopenTodoistTask,
  deleteTodoistTask,
  saveTodoistMapping,
  getTodoistId,
  removeTodoistMapping,
} from '../api/todoistApi'
import type { CreateTaskInput, UpdateTaskInput } from '../types'

export function useTasksBySection(section: string) {
  return useQuery({
    queryKey: ['tasks', 'section', section],
    queryFn: () => fetchTasksBySection(section),
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
    queryKey: ['tasks', 'week', startStr],
    queryFn: () => fetchTasksByWeek(startStr, endStr),
  })
}

export function useTasksByMonth(monthStart: Date, monthEnd: Date) {
  const startStr = format(monthStart, 'yyyy-MM-dd')
  const endStr   = format(monthEnd,   'yyyy-MM-dd')
  return useQuery({
    queryKey: ['tasks', 'month', startStr],
    queryFn: () => fetchTasksByMonth(startStr, endStr),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const task = await createTask(input)
      let todoistError: string | null = null
      try {
        const todoistId = await createTodoistTask(task)
        saveTodoistMapping(task.id, todoistId)
      } catch (err) {
        todoistError = err instanceof Error ? err.message : 'Todoist sync failed'
        console.warn('[Todoist] create failed:', err)
      }
      return { task, todoistError }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      updateTask(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const task = await toggleTaskDone(id, isDone)
      const todoistId = getTodoistId(id)
      if (todoistId) {
        try {
          if (isDone) await closeTodoistTask(todoistId)
          else        await reopenTodoistTask(todoistId)
        } catch (err) { console.warn('[Todoist] toggle failed:', err) }
      }
      return task
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useSwapTaskOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id1, id2 }: { id1: string; id2: string }) => swapTaskOrder(id1, id2),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const todoistId = getTodoistId(id)
      if (todoistId) {
        try { await deleteTodoistTask(todoistId) } catch (err) { console.warn('[Todoist] delete failed:', err) }
        removeTodoistMapping(id)
      }
      return deleteTask(id)
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

// Pull tasks from Todoist → import new ones to inbox
export function useSyncFromTodoist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const remoteTasks = await fetchTodoistTasks()
      let imported = 0
      for (const rt of remoteTasks) {
        const alreadyMapped = getSupabaseIdByTodoistId(rt.id)
        if (alreadyMapped) continue
        const newTask = await createTask({
          title:    rt.content,
          section:  'inbox',
          priority: todoistPriorityToLocal(rt.priority),
          domain:   'personal',
          due_date: rt.due?.date ?? undefined,
        })
        saveTodoistMapping(newTask.id, rt.id)
        imported++
      }
      return imported
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// Push local tasks that aren't in Todoist yet → create them there
export function usePushToTodoist() {
  return useMutation({
    mutationFn: async (tasks: import('../types').Task[]) => {
      let pushed = 0
      let failed = 0
      for (const task of tasks) {
        if (getTodoistId(task.id)) continue // already synced
        if (task.status === 'done' || task.status === 'cancelled') continue
        try {
          const todoistId = await createTodoistTask(task)
          saveTodoistMapping(task.id, todoistId)
          pushed++
        } catch {
          failed++
        }
      }
      return { pushed, failed }
    },
  })
}
