import type { ReactNode } from 'react'
import { Skeleton, TonePill } from '../../../../../shared/ui'
import { ReadFailed } from '../aiBits'

// Small pieces the Memory views share: a group of cards, a state pill, a date line, the read states.

export type PillTone = 'success' | 'accent' | 'neutral' | 'warn'

export function StatePill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <TonePill tone={tone} className="shrink-0">{children}</TonePill>
}

export function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="field-label px-1">{title} · {count}</h3>
      <ul className="card divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  )
}

/** The read states of a view: loading, failed (with a retry), or empty (with what will fill it). */
export function ReadState({ query, what, empty, count }: { query: { isLoading: boolean; isError: boolean; error: unknown; isFetching: boolean; refetch: () => unknown }; what: string; empty: string; count: number }) {
  if (query.isLoading) return <Skeleton rounded="rounded-card" className="h-20 w-full" />
  if (query.isError) return <ReadFailed what={what} error={query.error} onRetry={() => { void query.refetch() }} retrying={query.isFetching} />
  if (count === 0) return <p className="text-body text-fg-muted">{empty}</p>
  return null
}

/** One line of "field: value" pairs, as plain text (a value is the owner's or a model's: never markup, never a link). */
export function Pairs({ pairs }: { pairs: readonly [string, string][] }) {
  return (
    <p className="break-words text-meta text-fg-2">
      {pairs.map(([k, v], i) => <span key={k}>{i > 0 && ' · '}<span className="text-fg-muted">{k.replace(/_/g, ' ')}:</span> {v}</span>)}
    </p>
  )
}
