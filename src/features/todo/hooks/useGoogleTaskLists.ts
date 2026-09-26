import { useQuery } from '@tanstack/react-query'
import { useCalendarStore } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchGoogleTaskListRows, createGoogleTaskListMirrored, renameGoogleTaskListMirrored, deleteGoogleTaskListMirrored,
} from '../api/googleTaskListsApi'

export type { GoogleTaskListRow } from '../api/googleTaskListsApi'

export function useGoogleTaskLists() {
  return useQuery({ queryKey: qk.googleTaskLists.all, queryFn: fetchGoogleTaskListRows, staleTime: STALE.live })
}

function requireToken(): string {
  const token = useCalendarStore.getState().accessToken
  if (!token) throw new Error('Google account not connected')
  return token
}

export function useCreateGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'create_google_task_list',
    mutationFn: (title: string) => createGoogleTaskListMirrored(requireToken(), title),
    successMessage: 'List created',
    invalidates: [qk.googleTaskLists.all],
  })
}

export function useRenameGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'rename_google_task_list',
    mutationFn: ({ localId, googleId, title }: { localId: string; googleId: string; title: string }) =>
      renameGoogleTaskListMirrored(requireToken(), localId, googleId, title),
    invalidates: [qk.googleTaskLists.all],
  })
}

export function useDeleteGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'delete_google_task_list',
    mutationFn: ({ localId, googleId }: { localId: string; googleId: string }) =>
      deleteGoogleTaskListMirrored(requireToken(), localId, googleId),
    successMessage: 'List deleted',
    invalidates: [qk.googleTaskLists.all, qk.tasks.all],
  })
}
