import { supabase } from '../../../integrations/supabase/client'
import { createGoogleTaskList, renameGoogleTaskList, deleteGoogleTaskList } from './googleTasksApi'

// Local mirror (google_task_lists) + the matching Google Tasks call, one
// function per user action. The hooks in useGoogleTaskLists.ts only wrap these.

export interface GoogleTaskListRow {
  id:         string
  google_id:  string
  title:      string
  is_default: boolean
}

export async function fetchGoogleTaskListRows(): Promise<GoogleTaskListRow[]> {
  const { data, error } = await supabase
    .from('google_task_lists')
    .select('id, google_id, title, is_default')
    .order('is_default', { ascending: false })
    .order('title', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createGoogleTaskListMirrored(token: string, title: string): Promise<void> {
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
}

export async function renameGoogleTaskListMirrored(token: string, localId: string, googleId: string, title: string): Promise<void> {
  const remote = await renameGoogleTaskList(token, googleId, title)
  const { error } = await supabase.from('google_task_lists').update({
    title: remote.title, google_etag: remote.etag, google_updated_at: remote.updated,
  }).eq('id', localId)
  if (error) throw error
}

// Mirrors the stale-list reconcile path (migrations 073/074): detach every
// task that belonged to this list BEFORE dropping the local row, so none is
// left with a real google_task_id pointing at a list that no longer exists
// (the next edit would 404 forever — see detach_tasks_from_deleted_google_list's
// own comment for why that combination is broken).
export async function deleteGoogleTaskListMirrored(token: string, localId: string, googleId: string): Promise<void> {
  await deleteGoogleTaskList(token, googleId)
  const { error: detachError } = await supabase.rpc('detach_tasks_from_deleted_google_list', {
    p_google_tasklist_id: localId,
  })
  if (detachError) throw detachError
  const { error } = await supabase.from('google_task_lists').delete().eq('id', localId)
  if (error) throw error
}
