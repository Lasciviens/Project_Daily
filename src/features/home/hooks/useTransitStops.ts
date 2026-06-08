import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import type { StopResult } from '../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserTransitStop {
  id:            string
  stop_id:       string        // NSR:StopPlace:...
  stop_name:     string
  stop_locality: string | null
  label:         string | null
  is_default:    boolean
  sort_order:    number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransitStops(): {
  stops:      UserTransitStop[]
  isLoading:  boolean
  addStop:    (stop: StopResult, label?: string) => Promise<void>
  removeStop: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
} {
  const qc = useQueryClient()

  const { data: stops = [], isLoading } = useQuery({
    queryKey: ['transit', 'stops'],
    queryFn: async (): Promise<UserTransitStop[]> => {
      const { data, error } = await supabase
        .from('user_transit_stops')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data as UserTransitStop[]
    },
  })

  async function addStop(stop: StopResult, label?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const isFirst = stops.length === 0
    const { error } = await supabase.from('user_transit_stops').insert({
      user_id:       user.id,
      stop_id:       stop.id,
      stop_name:     stop.name,
      stop_locality: stop.locality ?? null,
      label:         label ?? null,
      is_default:    isFirst,
      sort_order:    stops.length,
    })
    if (error) {
      console.error('[useTransitStops] addStop failed:', error.message)
      throw error
    }
    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  async function removeStop(id: string): Promise<void> {
    const target = stops.find(s => s.id === id)

    const { error } = await supabase.from('user_transit_stops').delete().eq('id', id)
    if (error) {
      console.error('[useTransitStops] removeStop failed:', error)
      throw error
    }

    // If the removed stop was default, promote the first remaining stop
    if (target?.is_default) {
      const remaining = stops.filter(s => s.id !== id)
      if (remaining.length > 0) {
        const { error: promoteError } = await supabase
          .from('user_transit_stops')
          .update({ is_default: true })
          .eq('id', remaining[0].id)
        if (promoteError) console.error('[useTransitStops] promote default failed:', promoteError)
      }
    }

    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  async function setDefault(id: string): Promise<void> {
    // Two-step: clear all, then set the chosen one — avoids unique constraint issues
    const { error: clearError } = await supabase
      .from('user_transit_stops')
      .update({ is_default: false })
      .neq('id', id)
    if (clearError) {
      console.error('[useTransitStops] setDefault clear failed:', clearError)
      throw clearError
    }

    const { error: setError } = await supabase
      .from('user_transit_stops')
      .update({ is_default: true })
      .eq('id', id)
    if (setError) {
      console.error('[useTransitStops] setDefault set failed:', setError)
      throw setError
    }

    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  return { stops, isLoading, addStop, removeStop, setDefault }
}
