import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
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
  const { id: userId } = await requireUser()

  // The app never makes a second list of one name (any case) — Google would
  // allow it, and lists made elsewhere can still share a name (migration
  // 145). An explicit "Add" of an existing name is an error, not a reuse.
  const { data: existing, error: readError } = await supabase.from('google_task_lists').select('title').eq('user_id', userId)
  if (readError) throw readError
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

// Resolves a free-typed list NAME (the plan editor's "Google Task list"
// field) to a local google_task_lists id: an existing list of that name (any
// case) is reused, otherwise the list is created on Google and mirrored.
// Google itself allows several lists of one name; a pull mirrors them all
// (migration 145) and this picks the first.
export async function resolveOrCreateGoogleTaskListId(token: string, title: string): Promise<string> {
  const trimmed = title.trim()
  const { id: userId } = await requireUser()

  const findExisting = async (): Promise<string | null> => {
    // Two lists may share a name (145): always the same one — the default, then the oldest.
    const { data: existing, error } = await supabase.from('google_task_lists').select('id, title').eq('user_id', userId)
      .order('is_default', { ascending: false }).order('created_at', { ascending: true })
    if (error) throw error
    return (existing ?? []).find(l => l.title.trim().toLowerCase() === trimmed.toLowerCase())?.id ?? null
  }

  const existingId = await findExisting()
  if (existingId) return existingId

  const remote = await createGoogleTaskList(token, trimmed)
  const { data, error } = await supabase.from('google_task_lists').insert({
    user_id: userId, google_id: remote.id, title: remote.title,
    is_default: false, google_etag: remote.etag, google_updated_at: remote.updated,
  }).select('id').single()

  if (error) {
    // 23505: migration 076's title index, until 145 drops it — another save
    // created the same name a moment earlier; use that one. Remove this
    // branch once 145 is applied everywhere.
    if (error.code === '23505') {
      const winnerId = await findExisting()
      if (winnerId) return winnerId
    }
    throw error
  }
  return data.id
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
