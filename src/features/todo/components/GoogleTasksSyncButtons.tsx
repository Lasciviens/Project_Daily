import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ListTree } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { useAllTasks, useSyncFromGoogleTasks, usePushToGoogleTasks } from '../hooks/useTodos'
import { GoogleTaskListsSheet } from './GoogleTaskListsSheet'

// Two manual actions for the Google Tasks integration, previously defined
// but unreachable from any UI (CLAUDE.md: "known side effect" of the old
// global To-Do drawer's removal). Real-time per-task sync already covers
// create/edit/complete/delete automatically — these two exist for the cases
// that automatic sync can't reach:
// - Import: a task written directly in the Google Tasks app/widget on the
//   phone, never touched in this app.
// - Push: a task created before Google was connected, or whose create-time
//   sync silently failed (useCreateTask never blocks the Supabase write on it).
export function GoogleTasksSyncButtons() {
  const { data: tasks = [] } = useAllTasks()
  const pull = useSyncFromGoogleTasks()
  const push = usePushToGoogleTasks()
  const [listsOpen, setListsOpen] = useState(false)

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm" icon={<ArrowDownToLine />} loading={pull.isPending} onClick={() => pull.mutate()}
          title="Import tasks written directly in the Google Tasks app"
        >Import</Button>
        <Button
          size="sm" icon={<ArrowUpFromLine />} loading={push.isPending} onClick={() => push.mutate(tasks)}
          title="Push tasks not yet in Google Tasks (e.g. created before Google was connected)"
        >Push</Button>
        <Button size="sm" icon={<ListTree />} onClick={() => setListsOpen(true)} title="Manage Google Task lists">
          Lists
        </Button>
      </div>
      <GoogleTaskListsSheet open={listsOpen} onClose={() => setListsOpen(false)} />
    </>
  )
}
