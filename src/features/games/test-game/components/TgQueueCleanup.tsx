import { useMemo } from 'react'
import { ListX } from 'lucide-react'
import { useRemoveManyFromQueue } from '../../hooks/useGames'
import { queueInsights, type TgGame } from '../testGameModel'

/**
 * "Remove 3 finished": Completed or Dropped games that stayed in the Play
 * Queue (a status change never touches the queue). One tap, one write; the
 * games themselves are untouched. Nothing renders when there are none.
 */
export function TgQueueCleanup({ games, compact = false }: { games: readonly TgGame[]; compact?: boolean }) {
  const { finished } = useMemo(() => queueInsights(games), [games])
  const remove = useRemoveManyFromQueue()
  if (!finished.length) return null
  const names = finished.map(g => g.title).join(', ')
  return (
    <button
      type="button"
      onClick={() => remove.mutate(finished.map(g => g.id))}
      disabled={remove.isPending}
      title={`Completed or dropped, still queued: ${names}`}
      aria-label={`Remove ${finished.length} finished ${finished.length === 1 ? 'game' : 'games'} from the queue: ${names}`}
      className={`tg-btn tg-btn-secondary shrink-0 ${compact ? '!px-3 !text-[12.5px]' : '!px-3.5 !text-[13px]'}`}
    >
      <ListX aria-hidden className="h-4 w-4" strokeWidth={2} />
      Remove {finished.length} finished
    </button>
  )
}
