import { supabase } from '../../../integrations/supabase/client'
import type { DevRequest, CreateDevRequestInput, DevRequestStatus } from '../types'

export async function fetchDevRequests(): Promise<DevRequest[]> {
  const { data, error } = await supabase
    .from('dev_requests')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createDevRequest(input: CreateDevRequestInput): Promise<DevRequest> {
  const { data, error } = await supabase
    .from('dev_requests')
    .insert({ ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateDevRequest(
  id: string,
  patch: Partial<Pick<DevRequest, 'title' | 'description' | 'page' | 'category' | 'priority' | 'status' | 'effort' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase
    .from('dev_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteDevRequest(id: string): Promise<void> {
  const { error } = await supabase.from('dev_requests').delete().eq('id', id)
  if (error) throw error
}

// Bulk-remove closed (done/dismissed) requests in one round trip — used by
// the drawer's "Delete all closed" action instead of one confirm per row.
export async function deleteDevRequests(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('dev_requests').delete().in('id', ids)
  if (error) throw error
}

// Persists a new drag-and-drop order: only the rows whose number changed
// (planReorder in devRequestRules.ts), in parallel. The old version ignored
// each update's error, so a failed write never reached the user.
export async function reorderDevRequests(changes: { id: string; sort_order: number }[]): Promise<void> {
  const results = await Promise.all(changes.map(c =>
    supabase.from('dev_requests').update({ sort_order: c.sort_order }).eq('id', c.id)
  ))
  const failed = results.find(r => r.error)
  if (failed?.error) throw failed.error
}

export const DEV_REQUEST_STATUS_CYCLE: DevRequestStatus[] = ['open', 'in_progress', 'done']
