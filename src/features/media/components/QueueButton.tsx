import { Button } from '../../../shared/ui'
import { useTraktStatus } from '../trakt/useTrakt'
import { useQueue, useToggleQueue } from '../queue/useQueue'

/** "+ Queue" / "Queue #3" on a title page. The Queue is a Trakt list; hidden without Trakt. */
export function QueueButton({ type, tmdb, title }: { type: 'movie' | 'show'; tmdb: number; title: string }) {
  const { data: trakt } = useTraktStatus()
  const queue = useQueue()
  const toggle = useToggleQueue()
  if (!trakt?.connected) return null
  const pos = queue.position(type, tmdb)
  return (
    <Button size="sm" variant={pos ? 'primary' : 'ghost'} loading={toggle.isPending}
      title={pos ? 'Tap to take it out of the Queue' : 'Put it at the end of your Queue (a list on Trakt)'}
      aria-label={pos ? `In Queue, number ${pos}` : 'Add to Queue'}
      onClick={() => toggle.mutate({ item: { type, tmdb }, title, remove: !!pos })}>
      {/* Short, so the title page's action row stays one line. */}
      {pos ? `Queue #${pos}` : '+ Queue'}
    </Button>
  )
}
