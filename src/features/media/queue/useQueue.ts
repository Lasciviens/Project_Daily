import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
      if (!list) list = await createTraktList(QUEUE_NAME, 'What to watch next, in order — kept by Lasci\'s Board.')
      await addToTraktList(list.id, [item])
      return list.id
    },
    successMessage: (_r, v) => (v.remove ? `“${v.title}” left the Queue` : `“${v.title}” is in the Queue`),
    onSuccess: id => { if (id) void qc.invalidateQueries({ queryKey: qk.trakt.listItems(id) }) },
    invalidates: [qk.trakt.lists()],
  })
}

/** Saves a new order (optimistic; rolls back if Trakt refuses). */
export function useReorderQueue(listId: number | null) {
  const qc = useQueryClient()
  const key = qk.trakt.listItems(listId ?? 0)
  return useMutationWithFeedback({
    action: 'media_queue_reorder',
    mutationFn: (ordered: TraktListItem[]) => reorderTraktList(listId!, ordered.map(i => i.listItemId)),
    onMutate: async (ordered: TraktListItem[]) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<TraktListItem[]>(key)
      qc.setQueryData<TraktListItem[]>(key, ordered.map((i, n) => ({ ...i, rank: n + 1 })))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev) },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }) },
  })
}
