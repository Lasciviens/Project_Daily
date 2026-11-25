import { useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
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
 * Saves a new order. It shows at once; while a save is on its way, further
 * moves go on the shown order and only the newest order is sent when that
 * save is done (one call, never two racing). A refused save puts back the
 * last order Trakt took and drops what waited; the hook's toast says why.
 */
export function useReorderQueue(listId: number | null) {
  const qc = useQueryClient()
  const key = qk.trakt.listItems(listId ?? 0)
  const ranked = (order: TraktListItem[]) => order.map((i, n) => ({ ...i, rank: n + 1 }))
  const saved = useRef<TraktListItem[] | undefined>(undefined) // the order Trakt has
  const sending = useRef(false)
  const waiting = useRef<TraktListItem[] | null>(null)
  const m = useMutationWithFeedback({
    action: 'media_queue_reorder',
    // Rows Trakt skipped are said as a warning (onSuccess), never as a plain "saved".
    successMessage: r => (r.skipped.length ? undefined : 'Queue order saved'),
    mutationFn: (ordered: TraktListItem[]) => reorderTraktList(listId!, ordered.map(i => i.listItemId)),
    onMutate: async () => { await qc.cancelQueries({ queryKey: key }) },
    onSuccess: (r, ordered) => {
      saved.current = ranked(ordered)
      if (r.skipped.length) toast.warning(`Queue order saved · Trakt skipped ${r.skipped.length} title${r.skipped.length === 1 ? '' : 's'}`)
    },
    onError: () => {
      waiting.current = null
      if (saved.current) qc.setQueryData(key, saved.current)
    },
    onSettled: () => {
      const next = waiting.current
      waiting.current = null
      if (next) { m.mutate(next); return }
      sending.current = false
      void qc.invalidateQueries({ queryKey: key })
    },
  })
  const save = (order: TraktListItem[]) => {
    if (!sending.current) saved.current = qc.getQueryData<TraktListItem[]>(key)
    qc.setQueryData<TraktListItem[]>(key, ranked(order))
    if (sending.current) { waiting.current = order; return }
    sending.current = true
    m.mutate(order)
  }
  return { save, saving: m.isPending }
}
