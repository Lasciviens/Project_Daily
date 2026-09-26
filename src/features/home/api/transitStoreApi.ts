import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { StopResult } from './ruterApi'

// The user's own saved transit data: favourite stops (user_transit_stops),
// favourite routes (user_transit_routes) and recent stop→stop searches
// (transit_recent_searches, migration 021).

export interface UserTransitStop {
  id:               string
  stop_id:          string        // NSR:StopPlace:... for transit stops, or a
                                   // provider address id for an address favorite
  stop_name:        string
  stop_locality:    string | null
  label:            string | null
  is_default:       boolean
  sort_order:       number
  quay_id?:         string | null
  quay_description?: string | null
  lat?:             number | null   // set only for address favorites
  lon?:             number | null
}

export interface UserTransitRoute {
  id:             string
  label:          string
  from_stop_id:   string
  from_stop_name: string
  to_stop_id:     string
  to_stop_name:   string
  sort_order:     number
}

export interface RecentSearch {
  id:             string
  from_stop_id:   string
  from_stop_name: string
  to_stop_id:     string
  to_stop_name:   string
  searched_at:    string
}

export const MAX_RECENT_SEARCHES = 6

// ─── Stops ────────────────────────────────────────────────────────────────────

export async function fetchTransitStops(): Promise<UserTransitStop[]> {
  const { data, error } = await supabase.from('user_transit_stops').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data as UserTransitStop[]
}

export interface InsertTransitStopInput {
  stop: StopResult
  quayId: string | null
  quayDescription: string | null
  label: string | null
  isDefault: boolean
  sortOrder: number
}

export async function insertTransitStop({ stop, quayId, quayDescription, label, isDefault, sortOrder }: InsertTransitStopInput): Promise<void> {
  const user = await requireUser()
  const isAddress = !stop.id.startsWith('NSR:')
  const { error } = await supabase.from('user_transit_stops').insert({
    user_id:          user.id,
    stop_id:          stop.id,
    stop_name:        stop.name,
    stop_locality:    stop.locality ?? null,
    label,
    is_default:       isDefault,
    sort_order:       sortOrder,
    quay_id:          quayId,
    quay_description: quayDescription,
    lat:              isAddress ? stop.lat ?? null : null,
    lon:              isAddress ? stop.lon ?? null : null,
  })
  if (error) throw error
}

export interface TransitStopPatch { label?: string | null; quayId?: string | null; quayDescription?: string | null }

export async function updateTransitStop(id: string, patch: TransitStopPatch): Promise<void> {
  const { error } = await supabase
    .from('user_transit_stops')
    .update({
      ...(patch.label           !== undefined ? { label: patch.label } : {}),
      ...(patch.quayId          !== undefined ? { quay_id: patch.quayId } : {}),
      ...(patch.quayDescription !== undefined ? { quay_description: patch.quayDescription } : {}),
    })
    .eq('id', id)
  if (error) throw error
}

/** Deletes a stop; if it was the default, the next remaining stop becomes the default. */
export async function deleteTransitStop(id: string, promoteId: string | null): Promise<void> {
  const { error } = await supabase.from('user_transit_stops').delete().eq('id', id)
  if (error) throw error
  if (promoteId) {
    const { error: promoteError } = await supabase.from('user_transit_stops').update({ is_default: true }).eq('id', promoteId)
    if (promoteError) throw new Error('Stop removed, but the default stop could not be updated')
  }
}

export async function setDefaultTransitStop(id: string): Promise<void> {
  // Two steps (clear all, then set one) so a unique "one default" rule is never violated mid-way.
  const { error: clearError } = await supabase.from('user_transit_stops').update({ is_default: false }).neq('id', id)
  if (clearError) throw clearError
  const { error: setError } = await supabase.from('user_transit_stops').update({ is_default: true }).eq('id', id)
  if (setError) throw setError
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function fetchTransitRoutes(): Promise<UserTransitRoute[]> {
  const { data, error } = await supabase.from('user_transit_routes').select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data as UserTransitRoute[]
}

export async function insertTransitRoute(label: string, from: StopResult, to: StopResult, sortOrder: number): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('user_transit_routes').insert({
    user_id:        user.id,
    label,
    from_stop_id:   from.id,
    from_stop_name: from.name,
    to_stop_id:     to.id,
    to_stop_name:   to.name,
    sort_order:     sortOrder,
  })
  if (error) throw error
}

export async function deleteTransitRoute(id: string): Promise<void> {
  const { error } = await supabase.from('user_transit_routes').delete().eq('id', id)
  if (error) throw error
}

export async function updateTransitRouteLabel(id: string, label: string): Promise<void> {
  const { error } = await supabase.from('user_transit_routes').update({ label }).eq('id', id)
  if (error) throw error
}

// ─── Recent searches ──────────────────────────────────────────────────────────

export async function fetchRecentSearches(): Promise<RecentSearch[]> {
  const { data, error } = await supabase
    .from('transit_recent_searches')
    .select('*')
    .order('searched_at', { ascending: false })
    .limit(MAX_RECENT_SEARCHES)
  if (error) throw error
  return data as RecentSearch[]
}

/** Records one stop→stop search and trims the table to the newest MAX_RECENT_SEARCHES (it has no cap of its own). */
export async function recordRecentSearch(from: { id: string; name: string }, to: { id: string; name: string }): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('transit_recent_searches').insert({
    user_id:        user.id,
    from_stop_id:   from.id,
    from_stop_name: from.name,
    to_stop_id:     to.id,
    to_stop_name:   to.name,
  })
  if (error) throw error
  const { data: all } = await supabase.from('transit_recent_searches').select('id').order('searched_at', { ascending: false })
  if (all && all.length > MAX_RECENT_SEARCHES) {
    await supabase.from('transit_recent_searches').delete().in('id', all.slice(MAX_RECENT_SEARCHES).map(r => r.id))
  }
}
