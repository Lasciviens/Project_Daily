import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchTasksBySection,
  fetchTasksForDay,
  fetchTasksByWeek,
  fetchTasksByMonth,
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  swapTaskOrder,
} from '../api/tasksApi'
import {
  createTodoistTask,
  closeTodoistTask,
  reopenTodoistTask,
  deleteTodoistTask,
  saveTodoistMapping,
  getTodoistId,
  removeTodoistMapping,
} from '../api/todoistApi'
import type { CreateTaskInput, UpdateTaskInput } from '../types'

const TODOIST_TOKEN = import.meta.env.VITE_TODOIST_API_KEY as string | undefined

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
  const qc    = useQueryClient()
  const token = TODOIST_TOKEN
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const task = await createTask(input)
      if (token) {
        try {
          const todoistId = await createTodoistTask(token, task)
          saveTodoistMapping(task.id, todoistId)
        } catch (err) { console.warn('[Todoist] create failed:', err) }
      }
      return task
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
  const qc    = useQueryClient()
  const token = TODOIST_TOKEN
  return useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const task = await toggleTaskDone(id, isDone)
      if (token) {
        const todoistId = getTodoistId(id)
        if (todoistId) {
          try {
            if (isDone) await closeTodoistTask(token, todoistId)
            else        await reopenTodoistTask(token, todoistId)
          } catch (err) { console.warn('[Todoist] toggle failed:', err) }
        }
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
  const qc    = useQueryClient()
  const token = TODOIST_TOKEN
  return useMutation({
    mutationFn: async (id: string) => {
      if (token) {
        const todoistId = getTodoistId(id)
        if (todoistId) {
          try { await deleteTodoistTask(token, todoistId) } catch (err) { console.warn('[Todoist] delete failed:', err) }
          removeTodoistMapping(id)
        }
      }
      return deleteTask(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
