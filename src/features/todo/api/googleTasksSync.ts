import { supabase } from '../../../integrations/supabase/client'
import {
  fetchGoogleTaskLists, fetchDefaultGoogleTaskList,
  fullGoogleTasksSync, googleDueToLocalDate,
  type GoogleRemoteTask,
} from './googleTasksApi'

interface LocalTaskList { id: string; google_id: string }

// ── Task lists (google_task_lists mirror) ───────────────────────────────────
// The TaskList resource carries no "is this the default list" flag — resolve
// it by fetching the @default alias and matching its real id, never by
// assuming a list's own id is literally the string "@default".
//
// Also reconciles STALE lists: a list deleted on Google's side used to keep
// its local row forever (upsert-only, nothing ever removed it), so every
// future pull kept including it in the target set and erroring on it — a
// real incident this exact shape almost caused in the cron poller (a single
// deleted list would freeze that run's sync-state watermark permanently,
// since the per-list error never clears on its own). Returns the confirmed
// current rows so callers build their target set from THIS fetch, not a
// second DB query that could race with the delete below.
//
// Before dropping a stale list's row, every task that belonged to it is
// DETACHED (google_task_id/google_tasklist_id/google_sync_enabled all
// cleared together — migration 074). ON DELETE SET NULL alone would only
// clear google_tasklist_id and leave a real google_task_id behind — a task
// has no identity independent of its list in this API (every endpoint
// addresses one via /lists/{tasklist}/tasks/{task}), so that combination is
// actively broken: the next edit would PATCH /lists/@default/tasks/<id> for
// an id that never existed in @default, and Google 404s every time.
export async function syncGoogleTaskLists(token: string): Promise<LocalTaskList[]> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('Not signed in')

  const [lists, defaultList] = await Promise.all([
    fetchGoogleTaskLists(token),
    fetchDefaultGoogleTaskList(token),
  ])

  const localRows: LocalTaskList[] = []
  for (const l of lists) {
    const { data, error } = await supabase.from('google_task_lists').upsert({
      user_id:           userId,
      google_id:         l.id,
      title:             l.title,
      is_default:        l.id === defaultList.id,
      google_etag:       l.etag,
      google_updated_at: l.updated,
    }, { onConflict: 'user_id,google_id' }).select('id, google_id').single()
    if (error) throw error
    if (data) localRows.push(data)
  }

  const { data: existing } = await supabase.from('google_task_lists').select('id, google_id').eq('user_id', userId)
  const currentGoogleIds = new Set(lists.map(l => l.id))
  const staleIds = (existing ?? []).filter(row => !currentGoogleIds.has(row.google_id)).map(row => row.id)
  for (const staleId of staleIds) {
    const { error: detachError } = await supabase.rpc('detach_tasks_from_deleted_google_list', {
      p_google_tasklist_id: staleId,
    })
    if (detachError) throw detachError
  }
  if (staleIds.length) {
    await supabase.from('google_task_lists').delete().in('id', staleIds)
  }

  return localRows
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
  const lists = await syncGoogleTaskLists(token)
  const targets = lists.length ? lists : [{ id: null as string | null, google_id: '@default' }]

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

    // Every task gets a parent resolution pass, not just the ones WITH a
    // `parent` — a task moved back to top-level on Google's side (parent
    // removed) still needs its LOCAL parent_task_id cleared to match, and
    // `continue`-ing past that case (the original bug here) left it stuck
    // showing as a subtask forever, silently diverging from Google's truth.
    for (const rt of remoteTasks) {
      const localId = idMap.get(rt.id)
      if (!localId) continue
      const parentLocalId = rt.parent ? idMap.get(rt.parent) ?? null : null
      // Skip only when a `parent` was named but couldn't be resolved in
      // THIS batch (shouldn't happen for a full pull — every sibling is in
      // the same batch — but never clear a real parent based on a lookup
      // miss, only on Google genuinely reporting none).
      if (rt.parent && !parentLocalId) continue
      const { error } = await supabase.rpc('set_task_parent_from_google', {
        p_task_id: localId, p_parent_task_id: parentLocalId,
      })
      if (error) throw error
    }
  }

  return { imported }
}

// resolveGoogleListId's local-side counterpart, exported for callers (e.g.
// GoogleTasksSyncButtons) that need to know which local google_task_lists
// row backs a given task without duplicating this lookup.
export { localGoogleTaskListId }
