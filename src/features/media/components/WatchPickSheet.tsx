import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpToLine, CalendarDays } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { isPlaceholder, sortWatches, watchDate, type Watch, type WatchPick } from '../watches'

export interface WatchPickAsk {
  title: string
  /** One episode or movie: its watches, each a choice (placeholders shown, not choosable). */
  watches?: readonly Watch[]
  /** Trakt connected: placeholders wait for Trakt's dates. */
  traktConnected?: boolean
  /** Several episodes: how many of them were watched more than once. */
  several?: number
}

/** The answer: the latest or first watch (of each), or one watch's id. */
export type WatchPickAnswer = WatchPick | { id: string }

function Choice({ icon, label, hint, disabled, onClick }: { icon: ReactNode; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex min-h-[48px] w-full items-center gap-3 px-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-60 disabled:hover:bg-transparent [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-fg-muted">
      {icon}
      <span className="min-w-0 flex-1 text-body font-semibold tabular-nums text-fg">{label}</span>
      {hint && <span className="text-meta text-fg-muted">{hint}</span>}
    </button>
  )
}

/**
 * Which watch gets the new date, asked before "Change date" when there are
 * several (migration 149: every watch keeps its own date, so a change moves
 * one of them). One title lists its watches, latest first; several episodes
 * choose the latest or the first watch of each.
 */
export function WatchPickSheet({ ask, onDone }: { ask: WatchPickAsk; onDone: (a: WatchPickAnswer | null) => void }) {
  const list = ask.watches ? sortWatches(ask.watches).reverse() : null
  // The latest one that can move (a placeholder waits for Trakt's dates).
  const latestEditable = list?.find(w => !isPlaceholder(w, !!ask.traktConnected))
  return (
    <ModalShell onClose={() => onDone(null)} size="xs" layer="confirm" title={ask.title} subtitle="Which watch gets the new date?" bodyClassName="p-2">
      <div className="divide-y divide-line overflow-hidden rounded-row border border-line">
        {list ? list.map((w, i) => {
          const waits = isPlaceholder(w, !!ask.traktConnected)
          return (
            <Choice key={w.id} icon={<CalendarDays />} label={watchDate(w)} disabled={waits}
              hint={waits ? "waiting for Trakt's dates" : w === latestEditable ? 'Latest' : i === list.length - 1 ? 'First' : undefined}
              onClick={() => onDone({ id: w.id })} />
          )
        }) : (
          <>
            <Choice icon={<ArrowDownToLine />} label="The latest watch of each" hint="Default" onClick={() => onDone('latest')} />
            <Choice icon={<ArrowUpToLine />} label="The first watch of each" onClick={() => onDone('first')} />
          </>
        )}
      </div>
      {ask.several != null && (
        <p className="px-2 pt-2 text-meta text-fg-muted">
          {ask.several} of them {ask.several === 1 ? 'was' : 'were'} watched more than once. The other watches keep their dates.
        </p>
      )}
    </ModalShell>
  )
}
