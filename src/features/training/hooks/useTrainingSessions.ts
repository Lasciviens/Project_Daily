import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSessions, createSession, updateSession, deleteSession, fetchStravaStatus,
  fetchSessionExercises, saveSessionExercises,
} from '../api/trainingApi'
import { syncStravaActivities, disconnectStrava } from '../api/stravaApi'
import { supabase } from '../../../integrations/supabase/client'
import { deleteGoogleTask } from '../../todo/api/googleTasksApi'
import { deleteTask } from '../../todo/api/tasksApi'
import { getGoogleTaskId, removeGoogleTaskMapping } from '../../todo/api/googleTasksApi'
import { useCalendarStore } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { CreateSessionInput, Exercise } from '../types'

export function useTrainingSessions() {
  return useQuery({
    queryKey: ['training', 'sessions'],
    queryFn:  fetchSessions,
    staleTime: 5 * 60_000,
  })
}

export function useStravaStatus() {
  return useQuery({
    queryKey: ['training', 'strava-status'],
    queryFn:  fetchStravaStatus,
    staleTime: 60 * 60_000,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSessionInput) => createSession(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}

export function useUpdateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateSessionInput> }) =>
      updateSession(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_training_session',
    successMessage: 'Deleted',
    mutationFn: async (id: string) => {
      const { linkedTaskId } = await deleteSession(id)

      if (linkedTaskId) {
        // Look up google_task_id from Supabase (cross-device), fall back to localStorage
        const { data: taskRow } = await supabase
          .from('tasks')
          .select('google_task_id')
          .eq('id', linkedTaskId)
          .maybeSingle()

        const googleTaskId = taskRow?.google_task_id ?? getGoogleTaskId(linkedTaskId)
        if (googleTaskId) {
          const token = useCalendarStore.getState().accessToken
          if (token) {
            try { await deleteGoogleTask(token, googleTaskId) } catch {}
          }
          removeGoogleTaskMapping(linkedTaskId)
        }
        await deleteTask(linkedTaskId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}

export function useSessionExercises(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['training', 'exercises', sessionId],
    queryFn:  () => fetchSessionExercises(sessionId!),
    enabled:  !!sessionId,
    staleTime: 5 * 60_000,
  })
}

export function useSaveSessionExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, exercises }: { sessionId: string; exercises: Exercise[] }) =>
      saveSessionExercises(sessionId, exercises),
    onSuccess: (_, { sessionId }) =>
      qc.invalidateQueries({ queryKey: ['training', 'exercises', sessionId] }),
  })
}

export function useSyncStrava() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncStravaActivities,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}

export function useDisconnectStrava() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectStrava,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}
