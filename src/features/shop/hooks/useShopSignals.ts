import { useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { formatDate } from '../../../shared/utils/dateFormat'
import {
  clearSignalState, dismissSignal, fetchDealDays, fetchPriceStats, fetchSignalStates, putSignalState, snoozeSignal,
  type DismissSignalInput, type SignalKey, type SnoozeSignalInput,
} from '../api/shopSignalsApi'
import { stateFields } from '../signalStates'
import type { ShopPriceStats, ShopSignalState, ShopSignalStateFields, ShopSignalWrite } from '../types'

// Needs a look's data (migration 190). Each write answers the row before and after: the cached list takes the
// after at once, and the toast's Undo writes the before back exactly (shop_signal_put).

/** Every row the owner snoozed or said Got it to (signalStates.isSignalHidden says which stay away today). */
export function useSignalStates() {
  return useQuery({ queryKey: qk.shop.signals(), queryFn: fetchSignalStates, staleTime: STALE.default })
}

/** The cached list holds the row as the write left it (gone when `after` is null). */
function patchSignals(qc: QueryClient, key: SignalKey, after: ShopSignalState | null): void {
  qc.setQueryData<ShopSignalState[]>(qk.shop.signals(), rows => {
    if (!rows) return rows
    const rest = rows.filter(r => !(r.signal === key.signal && r.item_id === key.item_id))
    return after ? [...rest, after] : rest
  })
}

type PutVars = SignalKey & { state: ShopSignalStateFields | null; done: string }

/** Writes a row's state back exactly — the Undo of Snooze, Got it and Show again; `done` is what it says. */
function usePutSignalState() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'put_shop_signal_state',
    successMessage: (_: ShopSignalWrite, v: PutVars) => v.done,
    mutationFn:     ({ item_id, signal, state }: PutVars) => putSignalState({ item_id, signal, state }),
    onSuccess:      (r: ShopSignalWrite, v: PutVars) => patchSignals(qc, v, r.after),
    invalidates:    [qk.shop.signals()],
  })
}

/** An Undo that writes `before` back: its fields, or no row when there was none. */
const undoState = (before: ShopSignalState | null): ShopSignalStateFields | null => (before ? stateFields(before) : null)

/** Snooze a row until a day: "Snoozed until 17.11.2026 · Undo" (Undo puts back exactly what was there). */
export function useSnoozeSignal() {
  const qc = useQueryClient()
  const put = usePutSignalState()
  return useMutationWithFeedback({
    action:      'snooze_shop_signal',
    silent:      'its own toast reports it with Undo ("Snoozed until 17.11.2026 · Undo")',
    mutationFn:  (v: SnoozeSignalInput) => snoozeSignal(v),
    onSuccess:   (r: ShopSignalWrite, v: SnoozeSignalInput) => {
      patchSignals(qc, v, r.after)
      toast.undo(`Snoozed until ${formatDate(v.until)}`,
        () => put.mutate({ item_id: v.item_id, signal: v.signal, state: undoState(r.before), done: 'Snooze undone' }))
    },
    invalidates: [qk.shop.signals()],
  })
}

/** Got it: the row comes back only when what it says changes (a new signature). "Got it · Undo". */
export function useDismissSignal() {
  const qc = useQueryClient()
  const put = usePutSignalState()
  return useMutationWithFeedback({
    action:      'dismiss_shop_signal',
    silent:      'its own toast reports it with Undo ("Got it · Undo")',
    mutationFn:  (v: DismissSignalInput) => dismissSignal(v),
    onSuccess:   (r: ShopSignalWrite, v: DismissSignalInput) => {
      patchSignals(qc, v, r.after)
      toast.undo('Got it', () => put.mutate({ item_id: v.item_id, signal: v.signal, state: undoState(r.before), done: '“Got it” undone' }))
    },
    invalidates: [qk.shop.signals()],
  })
}

/** Show again: the row's snooze and Got it go. "Back in Needs a look · Undo" (no Undo when there was nothing). */
export function useClearSignalState() {
  const qc = useQueryClient()
  const put = usePutSignalState()
  return useMutationWithFeedback({
    action:      'clear_shop_signal_state',
    silent:      'its own toast reports it, with Undo when it took something away',
    mutationFn:  (v: SignalKey) => clearSignalState(v),
    onSuccess:   (r: ShopSignalWrite, v: SignalKey) => {
      patchSignals(qc, v, null)
      const before = r.before
      if (before) toast.undo('Back in Needs a look', () => put.mutate({ item_id: v.item_id, signal: v.signal, state: stateFields(before), done: 'Undone' }))
      else toast.success('Back in Needs a look')
    },
    invalidates: [qk.shop.signals()],
  })
}

/** The deal days (reference data: changed only by a migration). dealDays.dealsAhead gives their next runs. */
export function useDealDays() {
  return useQuery({ queryKey: qk.shop.dealDays(), queryFn: fetchDealDays, staleTime: STALE.day })
}

export interface PriceStatsResult {
  /** By item id; a thing without a clean read (or not the caller's) is missing. */
  byId: ReadonlyMap<string, ShopPriceStats>
  /** True until the first answer is in (never while there are no ids). */
  loading: boolean
  /** The read failed: the figures are unknown, not "none". */
  failed: boolean
  refetch: () => void
}

/**
 * The price figures of these things in one call (shop_price_stats) — it replaces one history read per wish. The
 * same set of ids in any order is one cache entry; "Check now" refreshes every entry (qk.shop.priceStatsAll).
 */
export function usePriceStats(itemIds: readonly string[]): PriceStatsResult {
  const key = useMemo(() => [...new Set(itemIds.map(id => id.toLowerCase()))].sort().join(','), [itemIds])
  const q = useQuery({
    queryKey:  qk.shop.priceStats(key),
    queryFn:   () => fetchPriceStats(key ? key.split(',') : []),
    enabled:   key.length > 0,
    staleTime: STALE.default,
  })
  const { data, isLoading, isError, refetch } = q
  const byId = useMemo(() => new Map((data ?? []).map(s => [s.item_id, s])), [data])
  return useMemo(() => ({ byId, loading: isLoading, failed: isError, refetch: () => { void refetch() } }), [byId, isLoading, isError, refetch])
}
