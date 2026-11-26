import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useOrderSave } from '../../../shared/hooks/useOrderSave'
import { qk } from '../../../shared/query/keys'
import { addToTraktList, createTraktList, fetchTraktLists, removeFromTraktList, reorderTraktList, type ListItemRef, type TraktListItem } from '../trakt/traktApi'
import { useTraktLists, useTraktListItems } from '../trakt/useTraktExtras'
import { QUEUE_NAME, findQueueList, sortQueue } from './queueModel'

/** The Queue list (if it exists yet) and its items in order. */
export function useQueue() {
  const lists = useTraktLists()
  const list = findQueueList(lists.data)
  const items = useTraktListItems(list?.id ?? null)
  const ordered = useMemo(() => sortQueue(items.data ?? []), [items.data])
  const position = (type: 'movie' | 'show', tmdb: number) => {
    const i = ordered.findIndex(x => x.type === type && x.tmdb === tmdb)
    return i < 0 ? null : i + 1
  }
  return { list, items: ordered, loading: lists.isLoading || (!!list && items.isLoading), position }
}

/** Adds a title to the end of the Queue — creating the Trakt list the first time — or takes it out. */
export function useToggleQueue() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'media_queue_toggle',
    mutationFn: async ({ item, remove }: { item: ListItemRef; title: string; remove?: boolean }) => {
      const lists = await fetchTraktLists()
      let list = findQueueList(lists)
      if (remove) { if (list) await removeFromTraktList(list.id, [item]); return list?.id ?? null }
      if (!list) list = await createTraktList(QUEUE_NAME, 'What to watch next, in order — kept by Lasci\'s Board.', { queue: true })
      await addToTraktList(list.id, [item])
      return list.id
    },
    successMessage: (_r, v) => (v.remove ? `“${v.title}” left the Queue` : `“${v.title}” is in the Queue`),
    onSuccess: id => { if (id) void qc.invalidateQueries({ queryKey: qk.trakt.listItems(id) }) },
    invalidates: [qk.trakt.lists()],
  })
}

/**
 * Saves a new order of the Queue on Trakt, through the shared `useOrderSave`
 * (shown at once; moves during a save wait and only the newest is sent; a
 * refused save puts back the last order Trakt took).
 */
export function useReorderQueue(listId: number | null) {
  const ranked = (order: TraktListItem[]) => order.map((i, n) => ({ ...i, rank: n + 1 }))
  return useOrderSave<TraktListItem[], TraktListItem[], Awaited<ReturnType<typeof reorderTraktList>>>({
    action: 'media_queue_reorder',
    queryKey: qk.trakt.listItems(listId ?? 0),
    show: (_d, order) => ranked(order),
    send: ordered => reorderTraktList(listId!, ordered.map(i => i.listItemId)),
    // Rows Trakt skipped are said as a warning (onSaved), never as a plain "saved".
    successMessage: r => (r.skipped.length ? undefined : 'Queue order saved'),
    onSaved: r => {
      if (r.skipped.length) toast.warning(`Queue order saved · Trakt skipped ${r.skipped.length} title${r.skipped.length === 1 ? '' : 's'}`)
    },
  })
}
