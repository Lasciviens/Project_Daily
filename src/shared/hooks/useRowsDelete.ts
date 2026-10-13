import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useMutationWithFeedback } from './useMutationWithFeedback'
import { confirmDelete } from '../modals/deleteFlow'
import type { InvalidationGroup } from '../query/invalidate'
import { removeRowsFromCache } from '../query/cachePatch'
import {
  deleteRows, notRestoredNote, restoreRows, rowsOf,
  type DeletedRows, type RestoreResult, type RowOverrides,
} from '../utils/deletedRows'

export interface RowsDeleteOptions {
  /** The table the rows are deleted from (migration 144 follows what goes with them). */
  table: string
  /** logError context of the delete ("delete_wish"); the restore logs as restore_<table>. */
  action: string
  invalidates: readonly (InvalidationGroup | QueryKey)[]
  /** Cached lists the deleted rows leave at once (from the delete's own answer). */
  cache?: QueryKey
  /** Runs right after the delete (Google copies, a Trakt sync). */
  afterDelete?: (snapshot: DeletedRows) => Promise<void> | void
  /** Columns to replace when the rows go back (ids of things deleted outside the app). */
  overrides?: (snapshot: DeletedRows) => RowOverrides
  /** Runs after Undo; may return a note on what didn't come back. */
  afterRestore?: (snapshot: DeletedRows, result: RestoreResult) => Promise<string | void> | string | void
  /** Plain names for tables in "Not brought back: …" ("ScreenScraper history"). */
  names?: Record<string, string>
}

export interface DeleteQuestion {
  title: string
  message?: string
  confirmLabel?: string
  /** false: already confirmed by the screen's own dialog. */
  ask?: boolean
  done: string | ((snapshot: DeletedRows) => string)
  restored?: string
}

/**
 * THE delete for rows in the app's database: ask → delete (one call that
 * returns what went with the rows) → "Wish deleted · Undo" → Undo puts the
 * same rows back. Every screen's delete goes through this, so they all ask,
 * answer and undo the same way (owner, 12–13.10.2026).
 *
 *   const del = useRowsDelete({ table: 'wish_items', action: 'delete_wish', invalidates: [qk.wishes.all], cache: qk.wishes.all })
 *   del.run([wish.id], { title: 'Delete this wish?', message: wish.title, done: 'Wish deleted' })
 */
export function useRowsDelete(o: RowsDeleteOptions) {
  const qc = useQueryClient()
  const remove = useMutationWithFeedback<DeletedRows | null, readonly string[]>({
    action: o.action,
    silent: 'the delete flow reports the result',
    mutationFn: async ids => {
      const snapshot = await deleteRows(o.table, ids)
      if (snapshot) await o.afterDelete?.(snapshot)
      return snapshot
    },
    onSuccess: snapshot => {
      if (snapshot && o.cache) removeRowsFromCache(qc, o.cache, new Set(rowsOf<{ id: string }>(snapshot, o.table).map(r => String(r.id))))
    },
    invalidates: o.invalidates,
  })
  const restore = useMutationWithFeedback<string, DeletedRows>({
    action: `restore_${o.table}`,
    silent: 'the delete flow reports the result',
    mutationFn: async snapshot => {
      const result = await restoreRows(snapshot, o.overrides?.(snapshot) ?? {})
      const extra = await o.afterRestore?.(snapshot, result)
      return [notRestoredNote(snapshot, result, o.names), extra].filter(Boolean).join(' · ')
    },
    invalidates: o.invalidates,
  })

  function run(ids: readonly string[], q: DeleteQuestion) {
    return confirmDelete<DeletedRows | null>({
      title: q.title,
      message: q.message,
      confirmLabel: q.confirmLabel,
      ask: q.ask,
      remove: () => remove.mutateAsync(ids),
      restore: snapshot => restore.mutateAsync(snapshot as DeletedRows),
      canUndo: snapshot => !snapshot?.too_big,
      done: snapshot => (typeof q.done === 'function' ? q.done(snapshot as DeletedRows) : q.done),
      restored: q.restored,
    })
  }

  return { run, remove, restore, busy: remove.isPending || restore.isPending }
}
