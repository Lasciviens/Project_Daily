import { useMemo } from 'react'
import { ListX } from 'lucide-react'
import { useRemoveManyFromQueue } from '../../hooks/useGames'
import { queueInsights, type TgGame } from '../testGameModel'

/**
 * "Remove 3 finished": Completed or Dropped games that stayed in the Play
 * Queue (a status change never touches the queue). One tap, one write; the
 * games themselves are untouched. Nothing renders when there are none. A text
 * action beside the queue's count (like Clear filters), 44px tall on touch.
 */
export function TgQueueCleanup({ games }: { games: readonly TgGame[] }) {
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
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold text-[var(--tg-accent)] disabled:opacity-60 [@media(hover:hover)]:hover:underline [@media(pointer:coarse)]:min-h-[44px]"
    >
      <ListX aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
      Remove {finished.length} finished
    </button>
  )
}
