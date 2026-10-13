import { useState } from 'react'
import { ArrowUpFromLine, ListTree, RefreshCw } from 'lucide-react'
import { Button, ToneDot, Truncate, type Tone } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { useAllTasks } from '../hooks/useTodos'
import { useGoogleTasksSyncState, usePushToGoogleTasks, useSyncFromGoogleTasks } from '../hooks/useGoogleTasksSync'
import { googleTasksSyncHealth, type GoogleTasksSyncHealth } from '../api/googleTasksRules'
import { GoogleTaskListsSheet } from './GoogleTaskListsSheet'

// The Google Tasks controls on Settings → Subscriptions' Google card. Saves
// reach Google on their own (the outbox) and Google's changes come in every
// 20 minutes and when the app opens; these are for the rest:
// - Sync now: one full run of the server sync (the cron's own code) right now.
// - Push: tasks made before Google was connected, or whose first send failed.
// - Lists: add, rename and delete Google Task lists.
// The line below says how the server's last run went, so "no sync" has a
// visible reason (an expired Google grant, Tasks not allowed, …).
export function GoogleTasksSyncButtons() {
  const { data: tasks = [] } = useAllTasks()
  const sync = useSyncFromGoogleTasks()
  const push = usePushToGoogleTasks()
  const { data: state, isLoading } = useGoogleTasksSyncState()
  const [listsOpen, setListsOpen] = useState(false)

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm" icon={<RefreshCw />} loading={sync.isPending} onClick={() => sync.mutate()}
          title="Send waiting changes and read every Google Tasks list now"
        >Sync now</Button>
        <Button
          size="sm" icon={<ArrowUpFromLine />} loading={push.isPending} onClick={() => push.mutate(tasks)}
          title="Push tasks not yet in Google Tasks (e.g. created before Google was connected)"
        >Push</Button>
        <Button size="sm" icon={<ListTree />} onClick={() => setListsOpen(true)} title="Manage Google Task lists">
          Lists
        </Button>
      </div>
      {!isLoading && <SyncStatusLine health={googleTasksSyncHealth(state)} />}
      <GoogleTaskListsSheet open={listsOpen} onClose={() => setListsOpen(false)} />
    </>
  )
}

const HEALTH_TONE: Record<GoogleTasksSyncHealth['kind'], Tone> = {
  never: 'neutral', ok: 'success', partial: 'warn', failed: 'danger',
}

function healthText(h: GoogleTasksSyncHealth): string {
  switch (h.kind) {
    case 'never': return 'Google Tasks has not synced yet'
    case 'ok': return `Google Tasks synced ${formatDateTime(h.at)}`
    case 'partial': return `Google Tasks synced ${formatDateTime(h.at)} · ${h.error}`
    case 'failed': return `Google Tasks sync failed ${formatDateTime(h.at)}: ${h.error}`
      + (h.lastSuccessAt ? ` · last good ${formatDateTime(h.lastSuccessAt)}` : '')
  }
}

function SyncStatusLine({ health }: { health: GoogleTasksSyncHealth }) {
  return (
    <p className="flex basis-full items-start gap-1.5 text-meta text-fg-muted" role={health.kind === 'failed' ? 'alert' : undefined}>
      <ToneDot tone={HEALTH_TONE[health.kind]} className="mt-1 shrink-0" />
      <Truncate lines={2} className="min-w-0 flex-1">{healthText(health)}</Truncate>
    </p>
  )
}
