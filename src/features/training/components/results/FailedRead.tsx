import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../../shared/ui'

/** A Results card whose read failed: one compact line naming what didn't load, and Try again (it re-asks every read
 *  that failed — the card's own among them). Never an empty answer or a loading copy that stays (THEME §5). */
export function FailedRead({ what }: { what: string }) {
  const client = useQueryClient()
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 py-1">
      <p className="min-w-0 flex-1 text-body text-fg-muted">Couldn&apos;t load {what}.</p>
      <Button size="sm" icon={<RefreshCw />} tip={`Try again: load ${what} again`}
        onClick={() => { void client.refetchQueries({ predicate: q => q.state.status === 'error' }) }}>Try again</Button>
    </div>
  )
}
