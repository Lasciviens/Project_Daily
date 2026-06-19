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
  fetchGoogleTasks,
  googleDueToLocalDate,
  getSupabaseIdByGoogleTaskId,
  createGoogleTask,
  completeGoogleTask,
  reopenGoogleTask,
  deleteGoogleTask,
  saveGoogleTaskMapping,
  getGoogleTaskId,
  removeGoogleTaskMapping,
} from '../api/googleTasksApi'
import { useCalendarStore } from '../../../app/store'
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
      // Sync to Google Tasks — soft failure (never blocks the Supabase write)
      const token = useCalendarStore.getState().accessToken
      let googleTaskError: string | null = null
      if (token) {
        try {
          const googleTaskId = await createGoogleTask(token, task)
          saveGoogleTaskMapping(task.id, googleTaskId)
        } catch (err) {
          googleTaskError = err instanceof Error ? err.message : 'Google Tasks sync failed'
          console.warn('[GoogleTasks] create failed:', err)
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
      const googleTaskId = getGoogleTaskId(id)
      if (googleTaskId) {
        const token = useCalendarStore.getState().accessToken
        if (token) {
          try {
            if (isDone) await completeGoogleTask(token, googleTaskId)
            else        await reopenGoogleTask(token, googleTaskId)
          } catch (err) { console.warn('[GoogleTasks] toggle failed:', err) }
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const googleTaskId = getGoogleTaskId(id)
      if (googleTaskId) {
        const token = useCalendarStore.getState().accessToken
        if (token) {
          try { await deleteGoogleTask(token, googleTaskId) } catch (err) { console.warn('[GoogleTasks] delete failed:', err) }
        }
        removeGoogleTaskMapping(id)
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

// Pull tasks from Google Tasks → import new ones to inbox
export function useSyncFromGoogleTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const token = useCalendarStore.getState().accessToken
      if (!token) throw new Error('Google account not connected')
      const remoteTasks = await fetchGoogleTasks(token)
      let imported = 0
      for (const rt of remoteTasks) {
        if (getSupabaseIdByGoogleTaskId(rt.id)) continue
        const newTask = await createTask({
          title:    rt.title,
          section:  'inbox',
          priority: 'medium',
          domain:   'personal',
          due_date: rt.due ? googleDueToLocalDate(rt.due) : undefined,
        })
        saveGoogleTaskMapping(newTask.id, rt.id)
        imported++
      }
      return imported
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// Push local tasks not yet in Google Tasks → create them there
export function usePushToGoogleTasks() {
  return useMutation({
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
          pushed++
        } catch {
          failed++
        }
      }
      return { pushed, failed }
    },
  })
}
