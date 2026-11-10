import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { fetchPricePoints } from '../api/shopApi'
import { addDays, daysBetween } from '../ownModel'
import { factsFromPoints, type PriceFacts } from '../wishTile'
import type { DealDay, LookState } from '../shopSuggestions'
import type { ShopPricePoint } from '../types'

// STAND-INS, to be replaced when the data side lands (migration 190 and its
// hooks: useSignalStates, useSnoozeSignal, useDismissSignal,
// useClearSignalState, useDealDays and usePriceStats). They have the real
// hooks' names and shapes so the page codes against them: the signal states
// live in this tab's memory only, the deal days are worked out here, and the
// price facts come from one history read per wish, as the prototype's did.

let states: LookState[] = []
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const key = (s: Pick<LookState, 'item_id' | 'signal'>) => `${s.item_id ?? '-'}|${s.signal}`
function put(next: LookState | null, at: Pick<LookState, 'item_id' | 'signal'>): LookState | null {
  const before = states.find(s => key(s) === key(at)) ?? null
  states = [...states.filter(s => key(s) !== key(at)), ...(next ? [next] : [])]
  listeners.forEach(fn => fn())
  return before
}

/** What the owner did with each Needs-a-look row (stand-in: this tab's memory). */
export function useSignalStates(): Pick<UseQueryResult<LookState[]>, 'data' | 'isLoading' | 'isError'> & { refetch: () => void } {
  const data = useSyncExternalStore(subscribe, () => states, () => states)
  return { data, isLoading: false, isError: false, refetch: () => undefined }
}

type At = { item_id: string | null; signal: string }

/** Snooze a row until a day: "Snoozed until 17.11.2026 · Undo". */
export function useSnoozeSignal() {
  return useMutationWithFeedback({
    action: 'snooze_shop_signal',
    silent: 'its Undo toast says until when',
    mutationFn: async (v: At & { until: string }) => ({ v, before: put({ item_id: v.item_id, signal: v.signal, until: v.until, signature: null }, v) }),
    onSuccess: ({ v, before }) => { toast.undo(`Snoozed until ${formatDate(v.until)}`, () => { put(before, v) }) },
  })
}

/** Got it: the row stays away until what it says changes (its signature). "Got it · Undo". */
export function useDismissSignal() {
  return useMutationWithFeedback({
    action: 'dismiss_shop_signal',
    silent: 'its Undo toast says it',
    mutationFn: async (v: At & { signature: string }) => ({ v, before: put({ item_id: v.item_id, signal: v.signal, until: null, signature: v.signature }, v) }),
    onSuccess: ({ v, before }) => { toast.undo('Got it', () => { put(before, v) }) },
  })
}

/** Show a snoozed or put-away row again. */
export function useClearSignalState() {
  return useMutationWithFeedback({
    action: 'clear_shop_signal',
    silent: 'the row coming back is the answer',
    mutationFn: async (v: At) => { put(null, v) },
  })
}

/** The Friday after the fourth Thursday of November. */
function blackFriday(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay()
  const thursday = 1 + ((4 - first + 7) % 7) + 21
  return `${year}-11-${String(thursday + 1).padStart(2, '0')}`
}

/** The next deal days from `today` (stand-in for the pure dealDays.ts). */
export function nextDealDays(today: string): DealDay[] {
  const year = Number(today.slice(0, 4))
  const next = (day: (y: number) => string) => (day(year) >= today ? day(year) : day(year + 1))
  return [
    { key: 'singles_day', name: "Singles' Day", day: next(y => `${y}-11-11`) },
    { key: 'black_friday', name: 'Black Friday', day: next(blackFriday) },
    { key: 'cyber_monday', name: 'Cyber Monday', day: next(y => addDays(blackFriday(y), 3)) },
    { key: 'mellomdagssalg', name: 'Mellomdagssalg', day: next(y => `${y}-12-27`) },
  ].sort((a, b) => daysBetween(today, a.day) - daysBetween(today, b.day))
}

export function useDealDays(): DealDay[] {
  const today = todayStr()
  return useMemo(() => nextDealDays(today), [today])
}

/** Each wish's clean price history (stand-in: one read per wish; the real one reads them all at once). */
export function usePriceStats(itemIds: readonly string[]): { data: ReadonlyMap<string, PriceFacts>; isLoading: boolean; isError: boolean; refetch: () => void } {
  const today = todayStr()
  const combine = useCallback((results: UseQueryResult<ShopPricePoint[]>[]) => {
    const data = new Map<string, PriceFacts>()
    itemIds.forEach((id, n) => {
      const points = results[n]?.data ?? []
      const cur = [...points].reverse().find(p => p.currency)?.currency ?? 'NOK'
      data.set(id, factsFromPoints(points, cur, today))
    })
    return {
      data, isLoading: results.some(r => r.isLoading), isError: results.some(r => r.isError),
      refetch: () => { for (const r of results) if (r.isError) void r.refetch() },
    }
  }, [itemIds, today])
  return useQueries({
    queries: itemIds.map(id => ({ queryKey: qk.shop.points(id), queryFn: () => fetchPricePoints(id), staleTime: STALE.default })),
    combine,
  })
}
