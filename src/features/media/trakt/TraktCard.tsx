import { useEffect, useRef, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import { toast } from '../../../app/store'
import { ConnectionCard, type Status } from '../../developer/components/ConnectionCard'
import { takePendingTrakt } from './traktCallback'
import { useDisconnectTrakt, useFinishTraktConnect, useStartTraktConnect, useTraktStatus } from './useTrakt'
import { TraktPreviewSheet } from './TraktPreviewSheet'

// Trakt on Settings → Subscriptions: connect, the first-import preview,
// disconnect (docs/trakt/PLAN.md, phase 1). The Connections rule: this is
// the only place Trakt is connected or disconnected.
export function TraktCard() {
  const status = useTraktStatus()
  const start = useStartTraktConnect()
  const finish = useFinishTraktConnect()
  const disconnect = useDisconnectTrakt()
  const [previewOpen, setPreviewOpen] = useState(false)
  const finishedOnce = useRef(false)

  // Back from Trakt's consent page (traktCallback parked the code).
  useEffect(() => {
    if (finishedOnce.current) return
    finishedOnce.current = true
    const pending = takePendingTrakt()
    if (!pending) return
    if ('error' in pending) toast.error(pending.error)
    else finish.mutate(pending.code)
  }, [finish])

  const s = status.data
  const state: Status = status.isLoading || finish.isPending ? 'unknown' : s?.connected ? 'connected' : 'disconnected'
  return (
    <>
      <ConnectionCard
        service="trakt" kind="user" account={s?.username} icon={<Clapperboard />} name="Trakt"
        description="Your watch history, ratings, watchlist, favorites and dropped shows — Trakt is the source, the app stays in sync."
        status={state}
        statusNote={s?.notConfigured ? 'Not set up on the server' : undefined}
        details={[s?.connectedAt && `Since ${formatDate(s.connectedAt)}`, s?.lastSyncAt && `Last sync ${formatDateTime(s.lastSyncAt)}`]}
        footer={s?.connected ? 'Nothing is imported yet: the preview shows what an import would change, without writing anything.' : undefined}
      >
        {!s?.notConfigured && (
          <div className="flex flex-wrap gap-2">
            {s?.connected ? (
              <>
                <Button variant="primary" onClick={() => setPreviewOpen(true)}>Preview import</Button>
                <Button variant="secondary" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending || status.isLoading || finish.isPending}>Connect Trakt</Button>
            )}
          </div>
        )}
      </ConnectionCard>
      <TraktPreviewSheet open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </>
  )
}
