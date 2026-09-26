import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Button, IconButton } from '../../../shared/ui'
import { useInitialHevySync } from '../hooks/useHevyPRs'
import { useIncrementalHevySync } from '../hooks/useHevyWorkouts'
import { useHevySyncState } from '../hooks/useHevySync'
import { formatTrainingTime } from '../dateFormat'

// Deliberately numeric DD/MM/YYYY (not the "12 Aug 2024" style used
// elsewhere in Training) — this is a compact "last synced" timestamp.
function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${date} at ${formatTrainingTime(d)}`
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
