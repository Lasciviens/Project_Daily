import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchTransitStops, insertTransitStop, updateTransitStop, deleteTransitStop, setDefaultTransitStop,
  type UserTransitStop, type TransitStopPatch,
} from '../api/transitStoreApi'
import type { StopResult } from '../api/ruterApi'

export type { UserTransitStop }

/**
 * Thrown by addStop when the exact same (stop, direction) is already saved, so
 * the caller can offer to update that favourite instead of surfacing a raw
 * "duplicate key" error. Raised before any write, so no error toast fires.
 */
export class DuplicateStopError extends Error {
  existing: UserTransitStop
  constructor(existing: UserTransitStop) {
    super('This stop and direction is already saved')
    this.name = 'DuplicateStopError'
    this.existing = existing
  }
}

const INVALIDATES = [qk.transit.stops()]

export function useTransitStops() {
  const { data: stops = [], isLoading } = useQuery({
    queryKey: qk.transit.stops(),
    queryFn:  fetchTransitStops,
    staleTime: STALE.default,
  })

  const add = useMutationWithFeedback({
    action: 'add_transit_stop', successMessage: 'Stop saved',
    mutationFn: insertTransitStop, invalidates: INVALIDATES,
  })
  const update = useMutationWithFeedback({
    action: 'update_transit_stop', successMessage: 'Stop updated',
    mutationFn: ({ id, patch }: { id: string; patch: TransitStopPatch }) => updateTransitStop(id, patch),
    invalidates: INVALIDATES,
  })
  const remove = useMutationWithFeedback({
    action: 'remove_transit_stop', successMessage: 'Stop removed',
    mutationFn: ({ id, promoteId }: { id: string; promoteId: string | null }) => deleteTransitStop(id, promoteId),
    invalidates: INVALIDATES,
  })
  const makeDefault = useMutationWithFeedback({
    action: 'set_default_transit_stop',
    mutationFn: setDefaultTransitStop, invalidates: INVALIDATES,
  })

  // Errors are toasted by the mutations; these reject only so a caller can stop its flow.
  async function addStop(stop: StopResult, quayId?: string, quayDescription?: string, label?: string): Promise<void> {
    const normalizedQuay = quayId ?? null
    const existing = stops.find(s => s.stop_id === stop.id && (s.quay_id ?? null) === normalizedQuay)
    if (existing) throw new DuplicateStopError(existing)
    await add.mutateAsync({
      stop, quayId: normalizedQuay, quayDescription: quayDescription ?? null, label: label ?? null,
      isDefault: stops.length === 0, sortOrder: stops.length,
    })
  }

  const updateStop = (id: string, patch: TransitStopPatch) => update.mutateAsync({ id, patch })

  function removeStop(id: string) {
    const target = stops.find(s => s.id === id)
    const promoteId = target?.is_default ? stops.find(s => s.id !== id)?.id ?? null : null
    return remove.mutateAsync({ id, promoteId })
  }

  const setDefault = (id: string) => makeDefault.mutateAsync(id)

  return { stops, isLoading, addStop, updateStop, removeStop, setDefault }
}
