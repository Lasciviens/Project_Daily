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

// Persists a new drag-and-drop order in one round trip.
export async function reorderDevRequests(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) =>
    supabase.from('dev_requests').update({ sort_order: i }).eq('id', id)
  ))
}

export const DEV_REQUEST_STATUS_CYCLE: DevRequestStatus[] = ['open', 'in_progress', 'done']
