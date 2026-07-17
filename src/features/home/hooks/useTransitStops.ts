import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { toast } from '../../../app/store'
import type { StopResult } from '../api/ruterApi'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// Thrown by addStop when the exact same (stop, direction) is already saved —
// callers should offer to update the existing favorite instead of just
// surfacing a raw "duplicate key" database error (a real bug this replaces:
// the unique index didn't even cover the quay before migration 049, so saving
// a second direction of the same stop was outright impossible).
export class DuplicateStopError extends Error {
  existing: UserTransitStop
  constructor(existing: UserTransitStop) {
    super('This stop and direction is already saved')
    this.name = 'DuplicateStopError'
    this.existing = existing
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransitStops(): {
  stops:      UserTransitStop[]
  isLoading:  boolean
  addStop:    (stop: StopResult, quayId?: string, quayDescription?: string, label?: string) => Promise<void>
  updateStop: (id: string, patch: { label?: string | null; quayId?: string | null; quayDescription?: string | null }) => Promise<void>
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

  async function addStop(stop: StopResult, quayId?: string, quayDescription?: string, label?: string): Promise<void> {
    const user = await requireUser()

    // Same stop + same direction (quay) already saved? Surface it as a typed
    // conflict instead of letting the DB's unique-index violation bubble up
    // as a raw "duplicate key value violates unique constraint" message.
    const normalizedQuay = quayId ?? null
    const existing = stops.find(s => s.stop_id === stop.id && (s.quay_id ?? null) === normalizedQuay)
    if (existing) throw new DuplicateStopError(existing)

    const isFirst = stops.length === 0
    const isAddress = !stop.id.startsWith('NSR:')
    const { error } = await supabase.from('user_transit_stops').insert({
      user_id:          user.id,
      stop_id:          stop.id,
      stop_name:        stop.name,
      stop_locality:    stop.locality ?? null,
      label:            label ?? null,
      is_default:       isFirst,
      sort_order:       stops.length,
      quay_id:          normalizedQuay,
      quay_description: quayDescription ?? null,
      lat:              isAddress ? stop.lat ?? null : null,
      lon:              isAddress ? stop.lon ?? null : null,
    })
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  // Used to apply a saved favorite's new label/direction after the user
  // confirms overwriting an existing one (see DuplicateStopError above).
  async function updateStop(id: string, patch: { label?: string | null; quayId?: string | null; quayDescription?: string | null }): Promise<void> {
    const { error } = await supabase
      .from('user_transit_stops')
      .update({
        ...(patch.label       !== undefined ? { label: patch.label } : {}),
        ...(patch.quayId      !== undefined ? { quay_id: patch.quayId } : {}),
        ...(patch.quayDescription !== undefined ? { quay_description: patch.quayDescription } : {}),
      })
      .eq('id', id)
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  async function removeStop(id: string): Promise<void> {
    const target = stops.find(s => s.id === id)

    const { error } = await supabase.from('user_transit_stops').delete().eq('id', id)
    if (error) throw error

    // If the removed stop was default, promote the first remaining stop
    if (target?.is_default) {
      const remaining = stops.filter(s => s.id !== id)
      if (remaining.length > 0) {
        const { error: promoteError } = await supabase
          .from('user_transit_stops')
          .update({ is_default: true })
          .eq('id', remaining[0].id)
        if (promoteError) toast.error('Failed to update default stop')
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
    if (clearError) throw clearError

    const { error: setError } = await supabase
      .from('user_transit_stops')
      .update({ is_default: true })
      .eq('id', id)
    if (setError) throw setError

    await qc.invalidateQueries({ queryKey: ['transit', 'stops'] })
  }

  return { stops, isLoading, addStop, updateStop, removeStop, setDefault }
}
