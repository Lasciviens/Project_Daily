import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRemoveFromQueue, useReorderQueue } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'
import { swapUpdates, withOrderOverrides } from './TgQueueViewOrder'
import { TgQueueViewRow } from './TgQueueViewRow'

interface Props {
  /** Already in play order. */
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function TgQueueView({ games, selectedId, onSelect }: Props) {
  const qc = useQueryClient()
  const { mutateAsync: reorder } = useReorderQueue()
  const { mutate: removeFromQueue } = useRemoveFromQueue()
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const inFlight = useRef(0)
  const listRef = useRef<HTMLOListElement>(null)

  const ordered = useMemo(() => withOrderOverrides(games, overrides), [games, overrides])

  // Keep the selected row in view when the selection changes from elsewhere
  // (the detail sheet, a search that narrows the list).
  useEffect(() => {
    if (!selectedId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-queue-id="${CSS.escape(selectedId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const move = useCallback((id: string, dir: -1 | 1) => {
    const from = ordered.findIndex(g => g.id === id)
    const updates = from === -1 ? null : swapUpdates(ordered, from, from + dir)
    if (!updates) return
    setOverrides(prev => ({ ...prev, ...Object.fromEntries(updates.map(u => [u.id, u.play_order])) }))
    inFlight.current += 1
    // mutateAsync, not mutate: a per-call mutate callback only fires for the
    // LATEST call, so quick repeated presses would strand their overrides.
    // useReorderQueue refreshes only the old queue query; this page reads the
    // library queries, so the whole namespace is refreshed here.
    void reorder(updates)
      .catch(() => undefined) // already toasted and logged by the hook
      .then(() => qc.invalidateQueries({ queryKey: ['games'] }))
      .finally(() => {
        inFlight.current -= 1
        if (inFlight.current === 0) setOverrides({})
      })
  }, [ordered, reorder, qc])

  const remove = useCallback((id: string) => removeFromQueue(id), [removeFromQueue])

  return (
    <ol ref={listRef} aria-label="Play queue" className="tg-panel tg-scroll-y h-full space-y-1 p-1.5 sm:p-2">
      {ordered.map((g, i) => (
        <TgQueueViewRow
          key={g.id}
          game={g}
          position={i + 1}
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
