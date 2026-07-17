import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// ─────────────────────────────────────────────────────────────────────────────
//  Recent stop→stop route searches (transit_recent_searches, migration 021).
//  The table existed but had no hook wired to it — recent searches were never
//  actually shown anywhere. Only stop→stop pairs are recorded (the table has
//  no lat/lon columns), so a search starting/ending at an address or your live
//  location is simply not recorded — recent searches are for repeat trips
//  between named stops, which is the common case.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RECENT = 6

export interface RecentSearch {
  id:             string
  from_stop_id:   string
  from_stop_name: string
  to_stop_id:     string
  to_stop_name:   string
  searched_at:    string
}

export function useTransitRecentSearches() {
  const qc = useQueryClient()

  const { data: recent = [] } = useQuery({
    queryKey: ['transit', 'recent-searches'],
    queryFn: async (): Promise<RecentSearch[]> => {
      const { data, error } = await supabase
        .from('transit_recent_searches')
        .select('*')
        .order('searched_at', { ascending: false })
        .limit(MAX_RECENT)
      if (error) throw error
      return data as RecentSearch[]
    },
    staleTime: 60_000,
  })

  // Best-effort: a search should never fail to plan just because recording it
  // for later didn't work, so failures here are swallowed (not surfaced as a
  // toast) — this is a convenience feature, not a core action.
  async function recordSearch(from: { id: string; name: string }, to: { id: string; name: string }): Promise<void> {
    if (recent[0]?.from_stop_id === from.id && recent[0]?.to_stop_id === to.id) return
    try {
      const user = await requireUser()
      await supabase.from('transit_recent_searches').insert({
        user_id:        user.id,
        from_stop_id:   from.id,
        from_stop_name: from.name,
        to_stop_id:     to.id,
        to_stop_name:   to.name,
      })
      // FIFO trim beyond MAX_RECENT — the table has no cap of its own.
      const { data: all } = await supabase
        .from('transit_recent_searches')
        .select('id')
        .order('searched_at', { ascending: false })
      if (all && all.length > MAX_RECENT) {
        await supabase.from('transit_recent_searches').delete().in('id', all.slice(MAX_RECENT).map(r => r.id))
      }
      await qc.invalidateQueries({ queryKey: ['transit', 'recent-searches'] })
    } catch {
      // swallow — see comment above
    }
  }

  return { recent, recordSearch }
}
