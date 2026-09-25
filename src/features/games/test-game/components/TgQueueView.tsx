import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRemoveFromQueue, useReorderQueue } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'
import { displayRanks, effectiveOrder, swapUpdates, withOrderOverrides } from './TgQueueViewOrder'
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
}

export function TgQueueView({ games, ranks, selectedId, onSelect, fill }: Props) {
  const qc = useQueryClient()
  const { mutateAsync: reorder } = useReorderQueue()
  const { mutate: removeFromQueue } = useRemoveFromQueue()
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  // Moves are written one after another: two parallel writes to the same row
  // can land in either order and leave two rows on one slot.
  const writes = useRef<{ queued: number; failed: boolean; chain: Promise<void> }>({
    queued: 0, failed: false, chain: Promise.resolve(),
  })
  const listRef = useRef<HTMLOListElement>(null)

  const ordered = useMemo(() => withOrderOverrides(games, overrides), [games, overrides])
  const shownRanks = useMemo(() => displayRanks(games, ranks, overrides), [games, ranks, overrides])

  // Keep the selected row in view when the selection changes from elsewhere
  // (the detail sheet, a search that narrows the list).
  useEffect(() => {
    if (!selectedId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-queue-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const move = useCallback((id: string, dir: -1 | 1) => {
    const list = effectiveOrder(ordered, overrides)
    const from = list.findIndex(g => g.id === id)
    const updates = from === -1 ? null : swapUpdates(list, from, from + dir)
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
        // Refresh once, after the last queued move. `cancelRefetch: false` joins
        // the refetch the mutation already started instead of restarting it; the
        // overrides stay until it lands, so the rows never snap back.
        if (w.queued === 1) await qc.invalidateQueries({ queryKey: ['games'] }, { cancelRefetch: false })
      })
      .finally(() => {
        w.queued -= 1
        if (w.queued === 0) { w.failed = false; setOverrides({}) }
      })
  }, [ordered, overrides, reorder, qc])

  const remove = useCallback((id: string) => removeFromQueue(id), [removeFromQueue])

  return (
    <ol
      ref={listRef}
      aria-label="Play queue"
      className={`tg-panel space-y-1 p-1.5 sm:p-2 ${fill ? 'tg-scroll-y h-full' : ''}`}
    >
      {ordered.map((g, i) => (
        <TgQueueViewRow
          key={g.id}
          game={g}
          position={shownRanks.get(g.id) ?? i + 1}
          selected={g.id === selectedId}
          canMoveUp={i > 0}
          canMoveDown={i < ordered.length - 1}
          onSelect={onSelect}
          onMove={move}
          onRemove={remove}
        />
      ))}
    </ol>
  )
}
