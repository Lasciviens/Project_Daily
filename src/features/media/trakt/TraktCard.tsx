import { useEffect, useRef, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { ErrorNotice } from '../../../shared/components/ErrorNotice'
import { Button } from '../../../shared/ui'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import { toast } from '../../../app/store'
import { entityModal } from '../../../shared/modals'
import { ConnectionCard, type Status } from '../../developer/components/ConnectionCard'
import { takePendingTrakt } from './traktCallback'
import { useDisconnectTrakt, useFinishTraktConnect, useStartTraktConnect, useSyncTrakt, useTraktStatus } from './useTrakt'
import { TraktPreviewSheet } from './TraktPreviewSheet'

// Trakt on Settings → Subscriptions: connect, sync status + Sync now, the
// import preview, disconnect (docs/trakt/PLAN.md). The Connections rule: this
// is the only place Trakt is connected or disconnected. Syncing itself runs on
// its own — every 30 minutes and a few seconds after a change here.
export function TraktCard() {
  const status = useTraktStatus()
  const start = useStartTraktConnect()
  const finish = useFinishTraktConnect()
  const disconnect = useDisconnectTrakt()
  const sync = useSyncTrakt()
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
  const heldBack = s?.lastResult?.heldBack ?? 0
  const applyRemovals = async () => {
    const ok = await entityModal.confirm({
      title: `Remove ${heldBack} item${heldBack === 1 ? '' : 's'} Trakt no longer has?`,
      message: 'A sync found more removals than usual and waited for you. Check trakt.tv first if this looks wrong — the removed titles and episodes can only come back by adding them again.',
      confirmLabel: 'Remove them', destructive: true,
    })
    if (ok) sync.mutate({ full: true, force: true })
  }
  return (
    <>
      <ConnectionCard
        service="trakt" kind="user" account={s?.username} icon={<Clapperboard />} name="Trakt"
        description="Your watch history, ratings, watchlist, dropped shows and notes — kept the same here and on Trakt, both ways."
        status={state}
        statusNote={s?.notConfigured ? 'Not set up on the server' : undefined}
        details={[
          s?.connectedAt && `Since ${formatDate(s.connectedAt)}`,
          s?.lastSyncAt && `Last sync ${formatDateTime(s.lastSyncAt)}`,
          s?.connected && (s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to send` : 'Nothing waiting to send'),
          // Notes Trakt did not take (e.g. a free account's note limit) stay in the app only.
          s?.connected && s.lastResult?.notes?.warning && `Notes: ${s.lastResult.notes.warning}`,
          s?.connected && !!s.lastResult?.notes?.left && `Notes: ${s.lastResult.notes.left} still to send to Trakt — the next sync goes on`,
        ]}
        footer={s?.connected ? 'Syncs by itself every 30 minutes and a few seconds after you change something here.' : undefined}
      >
        {s?.connected && s.lastError && (
          <ErrorNotice where="Settings → Trakt → last sync" title="The last sync failed." error={new Error(s.lastError)} />
        )}
        {s?.connected && heldBack > 0 && (
          <div className="flex w-fit flex-col gap-2 rounded-control bg-surface-2 px-3 py-2 text-meta text-fg" data-tone="warn">
            <p>{heldBack} removal{heldBack === 1 ? '' : 's'} from Trakt are waiting — more than a sync makes on its own.</p>
            <Button size="sm" variant="secondary" className="w-fit" onClick={applyRemovals} disabled={sync.isPending}>Review and apply</Button>
          </div>
        )}
        {!s?.notConfigured && (
          <div className="flex flex-wrap gap-2">
            {s?.connected ? (
              <>
                <Button variant="primary" onClick={() => sync.mutate({ full: true })} loading={sync.isPending} disabled={s.syncing}>Sync now</Button>
                <Button variant="secondary" onClick={() => setPreviewOpen(true)}>Preview import</Button>
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
