import { useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useMutationWithFeedback } from './useMutationWithFeedback'

type Feedback<O, R> =
  /** What the owner is told when the order is saved (undefined: silent for that save). */
  | { successMessage: string | ((result: R, order: O) => string | undefined); silent?: never }
  /** Why the save says nothing itself (the list shows the new order). */
  | { silent: string; successMessage?: never }

type Options<O, D, R> = Feedback<O, R> & {
  action: string
  /** The cached read that shows this order. */
  queryKey: QueryKey
  /** That read with the new order in it (pure). */
  show: (data: D | undefined, order: O) => D | undefined
  /** The write: one call for the whole new order. */
  send: (order: O) => Promise<R>
  /** After a save the server took (a warning about skipped rows). */
  onSaved?: (result: R, order: O) => void
}

/**
 * Saves a new order of an ordered list: every drop, ↑ ↓ and menu move of a
 * `DragReorderList` goes through it. It shows at once; while a save is on its
 * way, further moves go on the shown order and only the newest order is sent
 * when that save is done (one call, never two racing). A refused save puts
 * back the last order the server took and drops what waited; the hook's
 * toast says why.
 */
export function useOrderSave<O, D, R = unknown>({ action, successMessage, silent, queryKey, show, send, onSaved }: Options<O, D, R>) {
  const qc = useQueryClient()
  const saved = useRef<D | undefined>(undefined) // the order the server has
  const sending = useRef(false)
  const waiting = useRef<O | null>(null)
  const m = useMutationWithFeedback<R, O>({
    action,
    ...(silent != null ? { silent } : { successMessage: successMessage! }),
    mutationFn: send,
    onMutate: async () => { await qc.cancelQueries({ queryKey }) },
    onSuccess: (r, order) => {
      saved.current = show(saved.current, order)
      onSaved?.(r, order)
    },
    onError: () => {
      waiting.current = null
      if (saved.current !== undefined) qc.setQueryData(queryKey, saved.current)
    },
    onSettled: () => {
      const next = waiting.current
      waiting.current = null
      if (next) { m.mutate(next); return }
      sending.current = false
      void qc.invalidateQueries({ queryKey })
    },
  })
  const save = (order: O) => {
    if (!sending.current) saved.current = qc.getQueryData<D>(queryKey)
    qc.setQueryData<D | undefined>(queryKey, d => show(d, order))
    if (sending.current) { waiting.current = order; return }
    sending.current = true
    m.mutate(order)
  }
  return { save, saving: m.isPending }
}
