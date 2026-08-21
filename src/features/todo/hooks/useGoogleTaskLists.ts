import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { createGoogleTaskList, renameGoogleTaskList, deleteGoogleTaskList } from '../api/googleTasksApi'

export interface GoogleTaskListRow {
  id:         string
  google_id:  string
  title:      string
  is_default: boolean
}

async function fetchGoogleTaskListRows(): Promise<GoogleTaskListRow[]> {
  const { data, error } = await supabase
    .from('google_task_lists')
    .select('id, google_id, title, is_default')
    .order('is_default', { ascending: false })
    .order('title', { ascending: true })
  if (error) throw error
  return data ?? []
}

export function useGoogleTaskLists() {
  return useQuery({ queryKey: ['google-task-lists'], queryFn: fetchGoogleTaskListRows, staleTime: 30_000 })
}

function requireToken(): string {
  const token = useCalendarStore.getState().accessToken
  if (!token) throw new Error('Google account not connected')
  return token
}

export function useCreateGoogleTaskList() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'create_google_task_list',
    mutationFn: async (title: string) => {
      const token = requireToken()
      const trimmed = title.trim()
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) throw new Error('Not signed in')

      // Real gap fixed: this had NO dedup check at all (not even exact-
      // match) — typing "work" here when "Work" already existed always
      // created a second Google list. Case-insensitive, matching
      // resolveOrCreateGoogleTaskListId's rule (and migration 076's DB-level
      // backstop) — but this is an explicit "Add" action, so an existing
      // match is reported as an error rather than silently reused.
      const { data: existing } = await supabase.from('google_task_lists').select('title').eq('user_id', userId)
      if ((existing ?? []).some(l => l.title.trim().toLowerCase() === trimmed.toLowerCase())) {
        throw new Error(`A list named "${trimmed}" already exists`)
      }

      const remote = await createGoogleTaskList(token, trimmed)
      const { error } = await supabase.from('google_task_lists').insert({
        user_id: userId, google_id: remote.id, title: remote.title,
        is_default: false, google_etag: remote.etag, google_updated_at: remote.updated,
      })
      if (error) throw error
    },
    successMessage: 'List created ✓',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-task-lists'] }),
  })
}

export function useRenameGoogleTaskList() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'rename_google_task_list',
    mutationFn: async ({ localId, googleId, title }: { localId: string; googleId: string; title: string }) => {
      const token = requireToken()
      const remote = await renameGoogleTaskList(token, googleId, title)
      const { error } = await supabase.from('google_task_lists').update({
        title: remote.title, google_etag: remote.etag, google_updated_at: remote.updated,
      }).eq('id', localId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-task-lists'] }),
  })
}

// Mirrors the stale-list reconcile path (migrations 073/074): detach every
// task that belonged to this list BEFORE dropping the local row, so none is
// left with a real google_task_id pointing at a list that no longer exists
// (the next edit would 404 forever — see detach_tasks_from_deleted_google_list's
// own comment for why that combination is broken).
export function useDeleteGoogleTaskList() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'delete_google_task_list',
    mutationFn: async ({ localId, googleId }: { localId: string; googleId: string }) => {
      const token = requireToken()
      await deleteGoogleTaskList(token, googleId)
      const { error: detachError } = await supabase.rpc('detach_tasks_from_deleted_google_list', {
        p_google_tasklist_id: localId,
      })
      if (detachError) throw detachError
      const { error } = await supabase.from('google_task_lists').delete().eq('id', localId)
      if (error) throw error
    },
    successMessage: 'List deleted ✓',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-task-lists'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
