import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { StopResult } from '../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserTransitRoute {
  id:             string
  label:          string
  from_stop_id:   string
  from_stop_name: string
  to_stop_id:     string
  to_stop_name:   string
  sort_order:     number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransitRoutes(): {
  routes:      UserTransitRoute[]
  isLoading:   boolean
  addRoute:    (label: string, from: StopResult, to: StopResult) => Promise<void>
  removeRoute: (id: string) => Promise<void>
  updateLabel: (id: string, label: string) => Promise<void>
} {
  const qc = useQueryClient()

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['transit', 'routes'],
    queryFn: async (): Promise<UserTransitRoute[]> => {
      const { data, error } = await supabase
        .from('user_transit_routes')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data as UserTransitRoute[]
    },
  })

  async function addRoute(label: string, from: StopResult, to: StopResult): Promise<void> {
    const user = await requireUser()

    const { error } = await supabase.from('user_transit_routes').insert({
      user_id:        user.id,
      label,
      from_stop_id:   from.id,
      from_stop_name: from.name,
      to_stop_id:     to.id,
      to_stop_name:   to.name,
      sort_order:     routes.length,
    })
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['transit', 'routes'] })
  }

  async function removeRoute(id: string): Promise<void> {
    const { error } = await supabase.from('user_transit_routes').delete().eq('id', id)
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['transit', 'routes'] })
  }

  async function updateLabel(id: string, label: string): Promise<void> {
    const { error } = await supabase
      .from('user_transit_routes')
      .update({ label })
      .eq('id', id)
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['transit', 'routes'] })
  }

  return { routes, isLoading, addRoute, removeRoute, updateLabel }
}
