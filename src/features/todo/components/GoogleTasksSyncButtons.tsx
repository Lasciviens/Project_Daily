import { useState } from 'react'
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
// Mirrors FitbitSyncButton's small-pill styling for a consistent "extra sync
// action under a connected integration" pattern.
export function GoogleTasksSyncButtons() {
  const { data: tasks = [] } = useAllTasks()
  const pull = useSyncFromGoogleTasks()
  const push = usePushToGoogleTasks()
  const [listsOpen, setListsOpen] = useState(false)

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => pull.mutate()}
          disabled={pull.isPending}
          title="Import tasks written directly in the Google Tasks app"
          className="min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors press-feedback disabled:opacity-50"
        >
          <span className={pull.isPending ? 'animate-spin' : ''}>↓</span>
          Import
        </button>
        <button
          type="button"
          onClick={() => push.mutate(tasks)}
          disabled={push.isPending}
          title="Push tasks not yet in Google Tasks (e.g. created before Google was connected)"
          className="min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors press-feedback disabled:opacity-50"
        >
          <span className={push.isPending ? 'animate-spin' : ''}>↑</span>
          Push
        </button>
        <button
          type="button"
          onClick={() => setListsOpen(true)}
          title="Manage Google Task lists"
          className="min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors press-feedback"
        >
          📋 Lists
        </button>
      </div>
      <GoogleTaskListsSheet open={listsOpen} onClose={() => setListsOpen(false)} />
    </>
  )
}
