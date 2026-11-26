import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRemoveFromQueue, useReorderQueue, useSetPlayStatus } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'
import { displayRanks, effectiveOrder, moveUpdates, withOrderOverrides } from './TgQueueViewOrder'
import { DragReorderList } from '../../../../shared/ui/dragReorder/DragReorderList'
import { TgQueueViewRow } from './TgQueueViewRow'

interface Props {
  /** Already in play order. */
  games: TgGame[]
  /** Each game's place in the whole queue (hidden rows left out) — `queueRanks`. */
  ranks: ReadonlyMap<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
  /** Tablet/desktop: fill the column and scroll inside it. The phone lets the page scroll. */
  fill: boolean
  /** Plan a session in the calendar (the shell's planner). */
  onPlan?: (game: TgGame) => void
}

export function TgQueueView({ games, ranks, selectedId, onSelect, fill, onPlan }: Props) {
  const qc = useQueryClient()
  const { mutateAsync: reorder } = useReorderQueue()
  const { mutate: removeFromQueue } = useRemoveFromQueue()
  const { mutate: setPlayStatus } = useSetPlayStatus()
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  // Moves are written one after another: two parallel writes to the same row
  // can land in either order and leave two rows on one slot.
  const writes = useRef<{ queued: number; failed: boolean; chain: Promise<void> }>({
    queued: 0, failed: false, chain: Promise.resolve(),
  })
  const listRef = useRef<HTMLDivElement>(null)

  const ordered = useMemo(() => withOrderOverrides(games, overrides), [games, overrides])
  const shownRanks = useMemo(() => displayRanks(games, ranks, overrides), [games, ranks, overrides])

  // Keep the selected row in view when the selection changes from elsewhere
  // (the detail sheet, a search that narrows the list).
  useEffect(() => {
    if (!selectedId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-queue-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Drag and drop (the shared DragReorderList), Move up / Move down and the arrow keys share one write path. The overrides
  // put the rows in their new order at once; the writes follow in the background.
  const reorderTo = useCallback((from: number, to: number) => {
    const updates = moveUpdates(effectiveOrder(ordered, overrides), from, to)
    if (!updates) return
    setOverrides(prev => ({ ...prev, ...Object.fromEntries(updates.map(u => [u.id, u.play_order])) }))

    const w = writes.current
    w.queued += 1
    w.chain = w.chain
      .then(async () => {
        // After a failed write every later swap was built on a slot that never
        // moved, so the rest are dropped and the refetch shows the truth.
        if (!w.failed) {
          try { await reorder(updates) } catch { w.failed = true } // toasted and logged by the hook
        }
        // Each write patches every cached read itself (useReorderQueue), so
        // nothing is refetched per move. After a failure the rest were
        // dropped: one full refresh, after the last queued move, shows the truth.
        if (w.queued === 1 && w.failed) await qc.invalidateQueries({ queryKey: ['games'] }, { cancelRefetch: false })
      })
      .finally(() => {
        w.queued -= 1
        if (w.queued === 0) { w.failed = false; setOverrides({}) }
      })
  }, [ordered, overrides, reorder, qc])

  // The place numbers the rows show (a search shows a subset: its places in the whole queue), in list order.
  const slots = useMemo(() => ordered.map((g, i) => shownRanks.get(g.id) ?? i + 1), [ordered, shownRanks])

  const remove = useCallback((id: string) => removeFromQueue(id), [removeFromQueue])
  // Through the status write that stamps started_at (not a bare update).
  const play = useCallback((id: string) => setPlayStatus({ id, status: 'playing' }), [setPlayStatus])

  return (
    // The wrapper holds the scroll and the Tg panel; the list inside is the shared drag's.
    <div
      ref={listRef}
      // Capped: on a monitor a full-width row put a title ~1400px from its own buttons.
      className={`tg-queue tg-panel w-full max-w-[72rem] p-1.5 sm:p-2 ${fill ? 'tg-scroll-y h-full' : ''}`}
    >
      <DragReorderList ids={ordered.map(g => g.id)} onMove={reorderTo} label="Play queue" className="space-y-1"
        nameOf={id => ordered.find(g => g.id === id)?.title ?? 'The game'}>
        {ordered.map(g => (
          <TgQueueViewRow
            key={g.id}
            game={g}
            slots={slots}
            selected={g.id === selectedId}
            onSelect={onSelect}
            onRemove={remove}
            onPlay={play}
            onPlan={onPlan}
          />
        ))}
      </DragReorderList>
    </div>
  )
}
