import type { UseQueryResult } from '@tanstack/react-query'
import { ModalShell, type ModalSize } from './ModalShell'
import { Button, SkeletonText } from '../ui'

// Shared loading pieces for entity-modal adapters (THEME.md §9): the popup
// loads its row by id, shows its own chrome with a skeleton while loading,
// and an honest error (with retry) when the row can't be read or is gone.

/** Renders the popup chrome while `query` has not produced a row yet. */
export function EntityModalPending({ query, what, title, size = 'md', onClose }: {
  query: UseQueryResult<unknown>
  what: string
  title?: string
  size?: ModalSize
  onClose: () => void
}) {
  // While a refetch runs, a cached row is waiting to be confirmed, not missing.
  const failed = query.isError && !query.isFetching
  const missing = query.isSuccess && !query.isFetching
  return (
    <ModalShell onClose={onClose} title={title ?? (failed || missing ? `Can't open this ${what}` : 'Loading…')} size={size}>
      {failed ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-fg-2">Couldn't load this {what}.</p>
          <Button size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
        </div>
      ) : missing ? (
        <p className="text-body text-fg-2">This {what} no longer exists.</p>
      ) : (
        <SkeletonText lines={4} />
      )}
    </ModalShell>
  )
}
