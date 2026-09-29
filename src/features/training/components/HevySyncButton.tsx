import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Button, IconButton } from '../../../shared/ui'
import { useHevySyncState, useIncrementalHevySync, useInitialHevySync } from '../hooks/useHevySync'
import { formatTrainingDate, formatTrainingTime } from '../dateFormat'

// A compact "last synced" timestamp: "29.09.2026 at 14:05".
function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  return `${formatTrainingDate(d)} at ${formatTrainingTime(d)}`
}

/** Hevy sync (incremental) + a settings popover with the full re-import. */
export function HevySyncButton() {
  const initialSync     = useInitialHevySync()
  const incrementalSync = useIncrementalHevySync()
  const { data: syncState } = useHevySyncState()
  const lastSyncTime = syncState?.last_events_since ?? null
  const anyPending = initialSync.isPending || incrementalSync.isPending

  return (
    <div className="flex items-center gap-1">
      <IconButton
        label={incrementalSync.isPending ? 'Syncing Hevy…' : 'Sync Hevy'}
        bordered
        onClick={() => incrementalSync.mutate()}
        disabled={anyPending}
        className="disabled:opacity-50"
      >
        <RefreshCw className={incrementalSync.isPending ? 'animate-spin' : ''} />
      </IconButton>

      <Popover className="relative">
        <PopoverButton as={IconButton} label="Hevy sync settings" bordered>
          <Settings2 />
        </PopoverButton>
        <PopoverPanel anchor="bottom end" className="menu z-popover mt-2 flex w-72 flex-col gap-3 p-4">
          <div>
            <p className="section-label mb-0.5">Last synced</p>
            <p className="text-body text-fg-2">{lastSyncTime ? formatSyncTime(lastSyncTime) : 'Never synced'}</p>
          </div>
          <div className="border-t border-line" />
          <div>
            <p className="text-body font-semibold text-fg">Full re-sync</p>
            <p className="mb-2 text-meta text-fg-muted">Imports all data from scratch — takes about 30 s.</p>
            <Button block loading={initialSync.isPending} disabled={anyPending} onClick={() => initialSync.mutate()}>
              Import all from Hevy
            </Button>
          </div>
        </PopoverPanel>
      </Popover>
    </div>
  )
}
