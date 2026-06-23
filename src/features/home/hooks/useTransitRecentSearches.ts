import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'

export interface RecentSearch {
  id:             string
  from_stop_id:   string
  from_stop_name: string
  to_stop_id:     string
  to_stop_name:   string
  searched_at:    string
}

const MAX_SEARCHES = 6
const QK = ['transit', 'recent-searches'] as const

export function useTransitRecentSearches() {
  const qc = useQueryClient()

  const { data: searches = [] } = useQuery({
    queryKey: QK,
    queryFn: async (): Promise<RecentSearch[]> => {
      const { data, error } = await supabase
        .from('transit_recent_searches')
        .select('*')
        .order('searched_at', { ascending: false })
        .limit(MAX_SEARCHES)
      if (error) throw error
      return data as RecentSearch[]
    },
  })

  async function addSearch(fromId: string, fromName: string, toId: string, toName: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const existing = searches.find(s => s.from_stop_id === fromId && s.to_stop_id === toId)
    if (existing) {
      await supabase
        .from('transit_recent_searches')
        .update({ searched_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase.from('transit_recent_searches').insert({
        user_id:        user.id,
        from_stop_id:   fromId,
        from_stop_name: fromName,
        to_stop_id:     toId,
        to_stop_name:   toName,
      })
      // Enforce MAX: delete oldest entry if over limit
      if (searches.length >= MAX_SEARCHES) {
        const oldest = [...searches].sort(
          (a, b) => new Date(a.searched_at).getTime() - new Date(b.searched_at).getTime()
        )[0]
        if (oldest) {
          await supabase.from('transit_recent_searches').delete().eq('id', oldest.id)
        }
      }
    }
    await qc.invalidateQueries({ queryKey: QK })
  }

  async function removeSearch(id: string) {
    await supabase.from('transit_recent_searches').delete().eq('id', id)
    await qc.invalidateQueries({ queryKey: QK })
  }

  return { searches, addSearch, removeSearch }
}
