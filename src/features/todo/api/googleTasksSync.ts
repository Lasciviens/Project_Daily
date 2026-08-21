import { supabase } from '../../../integrations/supabase/client'
import {
  fetchGoogleTaskLists, fetchDefaultGoogleTaskList,
  fullGoogleTasksSync, googleDueToLocalDate,
  type GoogleRemoteTask,
} from './googleTasksApi'

// ── Task lists (google_task_lists mirror) ───────────────────────────────────
// The TaskList resource carries no "is this the default list" flag — resolve
// it by fetching the @default alias and matching its real id, never by
// assuming a list's own id is literally the string "@default".
export async function syncGoogleTaskLists(token: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in')

  const [lists, defaultList] = await Promise.all([
    fetchGoogleTaskLists(token),
    fetchDefaultGoogleTaskList(token),
  ])

  for (const l of lists) {
    const { error } = await supabase.from('google_task_lists').upsert({
      user_id:           userId,
      google_id:         l.id,
      title:             l.title,
      is_default:        l.id === defaultList.id,
      google_etag:       l.etag,
      google_updated_at: l.updated,
    }, { onConflict: 'user_id,google_id' })
    if (error) throw error
  }
}

async function localGoogleTaskListId(googleListId: string): Promise<string | null> {
  if (googleListId === '@default') {
    const { data } = await supabase.from('google_task_lists').select('id').eq('is_default', true).maybeSingle()
    return data?.id ?? null
  }
  const { data } = await supabase.from('google_task_lists').select('id').eq('google_id', googleListId).maybeSingle()
  return data?.id ?? null
}

async function upsertOne(rt: GoogleRemoteTask, googleTasklistLocalId: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('upsert_task_from_google', {
    p_google_task_id:       rt.id,
    p_title:                rt.title,
    p_notes:                rt.notes ?? null,
    p_due_date:             rt.due ? googleDueToLocalDate(rt.due) : null,
    p_status:               rt.status,
    p_google_updated_at:    rt.updated,
    p_google_tasklist_id:   googleTasklistLocalId,
    p_completed_at:         rt.completed ?? null,
    p_google_etag:          rt.etag ?? null,
    p_google_position:      rt.position ?? null,
    p_google_web_view_link: rt.webViewLink ?? null,
    p_google_hidden:        rt.hidden ?? false,
    p_google_deleted:       rt.deleted ?? false,
  })
  if (error) throw error
  return data as string | null
}

export interface PullResult {
  imported: number
}

// Full pull across every Google Task list — creates/updates local mirrors
// via upsert_task_from_google (which itself refuses to overwrite a task
// with a pending outbox row — see that function's comment), then resolves
// parent/subtask relationships in a second pass once every sibling in the
// batch has a local id.
export async function pullGoogleTasks(token: string): Promise<PullResult> {
  await syncGoogleTaskLists(token)

  const { data: lists } = await supabase.from('google_task_lists').select('id, google_id')
  const targets = lists?.length ? lists : [{ id: null as string | null, google_id: '@default' }]

  let imported = 0

  for (const list of targets) {
    const remoteTasks = await fullGoogleTasksSync(token, list.google_id)
    const idMap = new Map<string, string>() // google task id -> local uuid

    for (const rt of remoteTasks) {
      const localId = await upsertOne(rt, list.id)
      if (localId) {
        idMap.set(rt.id, localId)
        imported++
      }
    }

    for (const rt of remoteTasks) {
      if (!rt.parent) continue
      const localId       = idMap.get(rt.id)
      const parentLocalId = idMap.get(rt.parent)
      if (localId && parentLocalId) {
        const { error } = await supabase.rpc('set_task_parent_from_google', {
          p_task_id: localId, p_parent_task_id: parentLocalId,
        })
        if (error) throw error
      }
    }
  }

  return { imported }
}

// resolveGoogleListId's local-side counterpart, exported for callers (e.g.
// GoogleTasksSyncButtons) that need to know which local google_task_lists
// row backs a given task without duplicating this lookup.
export { localGoogleTaskListId }
