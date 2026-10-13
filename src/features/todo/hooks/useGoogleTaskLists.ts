import { useQuery } from '@tanstack/react-query'
import { ensureValidCalendarToken } from '../../calendar/api/calendarTokenSync'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchGoogleTaskListRows, createGoogleTaskListMirrored, renameGoogleTaskListMirrored, deleteGoogleTaskListMirrored,
} from '../api/googleTaskListsApi'

export type { GoogleTaskListRow } from '../api/googleTaskListsApi'

export function useGoogleTaskLists() {
  return useQuery({ queryKey: qk.googleTaskLists.all, queryFn: fetchGoogleTaskListRows, staleTime: STALE.live })
}

// A token that is still valid — refreshed first when the stored one is past
// its hour (the raw store value used to be sent and Google answered 401).
async function requireToken(): Promise<string> {
  const token = await ensureValidCalendarToken()
  if (!token) throw new Error('Google is not connected: connect it in Settings → Subscriptions')
  return token
}

export function useCreateGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'create_google_task_list',
    mutationFn: async (title: string) => createGoogleTaskListMirrored(await requireToken(), title),
    successMessage: 'List created',
    invalidates: [qk.googleTaskLists.all],
  })
}

export function useRenameGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'rename_google_task_list',
    mutationFn: async ({ localId, googleId, title }: { localId: string; googleId: string; title: string }) =>
      renameGoogleTaskListMirrored(await requireToken(), localId, googleId, title),
    successMessage: 'List renamed',
    invalidates: [qk.googleTaskLists.all],
  })
}

export function useDeleteGoogleTaskList() {
  return useMutationWithFeedback({
    action: 'delete_google_task_list',
    mutationFn: async ({ localId, googleId }: { localId: string; googleId: string }) =>
      deleteGoogleTaskListMirrored(await requireToken(), localId, googleId),
    silent: 'the delete flow reports the result',
    invalidates: [qk.googleTaskLists.all, qk.tasks.all],
  })
}
