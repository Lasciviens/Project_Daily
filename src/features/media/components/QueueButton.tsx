import { Button } from '../../../shared/ui'
import { useTraktStatus } from '../trakt/useTrakt'
import { useQueue, useToggleQueue } from '../queue/useQueue'
import { useQueueAddCheck } from '../queue/useQueueAddCheck'

/** "+ Queue" / "Queue #3" on a title page. The Queue is a Trakt list; hidden without Trakt. */
export function QueueButton({ type, tmdb, title }: { type: 'movie' | 'show'; tmdb: number; title: string }) {
  const { data: trakt } = useTraktStatus()
  const queue = useQueue()
  const toggle = useToggleQueue()
  const addCheck = useQueueAddCheck()
  if (!trakt?.connected) return null
  const pos = queue.position(type, tmdb)
  async function toggleQueue() {
    // A Completed film asks to start a rewatch first: it would leave the Queue at the next sync (207).
    if (!pos && !(await addCheck.check({ type, tmdb }, title))) return
    toggle.mutate({ item: { type, tmdb }, title, remove: !!pos })
  }
  return (
    <Button size="sm" variant={pos ? 'primary' : 'ghost'} loading={toggle.isPending || addCheck.busy}
      title={pos ? 'Tap to take it out of the Queue' : 'Put it at the end of your Queue (a list on Trakt)'}
      aria-label={pos ? `In Queue, number ${pos}` : 'Add to Queue'}
      onClick={() => { void toggleQueue() }}>
      {/* Short, so the title page's action row stays one line. */}
      {pos ? `Queue #${pos}` : '+ Queue'}
    </Button>
  )
}
