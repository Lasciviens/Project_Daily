import { useState } from 'react'
import { useUIStore } from '../../../app/store'
import { useTasksBySection, useSyncFromGoogleTasks, usePushToGoogleTasks } from '../hooks/useTodos'
import { fetchTasksBySection } from '../api/tasksApi'
import { ToDoSection } from './ToDoSection'
import type { TaskSection } from '../types'

const SECTIONS: { id: TaskSection; label: string; defaultOpen: boolean }[] = [
  { id: 'inbox',     label: 'Inbox',     defaultOpen: true  },
  { id: 'today',     label: 'Today',     defaultOpen: true  },
  { id: 'this_week', label: 'This Week', defaultOpen: false },
  { id: 'backlog',   label: 'Backlog',   defaultOpen: false },
]

export function ToDoDrawer() {
  const { isToDoOpen, closeToDo } = useUIStore()
  const pull  = useSyncFromGoogleTasks()
  const push  = usePushToGoogleTasks()
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)

  function showToast(msg: string, error = false) {
    setToast({ msg, error })
    setTimeout(() => setToast(null), error ? 5000 : 3000)
  }

  async function handlePull() {
    try {
      const imported = await pull.mutateAsync()
      showToast(imported > 0 ? `${imported} tasks imported` : 'Already up to date')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', true)
    }
  }

  async function handlePush() {
    try {
      const allTasks = (await Promise.all(
        SECTIONS.map(s => fetchTasksBySection(s.id))
      )).flat()
      const { pushed, failed } = await push.mutateAsync(allTasks)
      if (failed > 0) {
        showToast(`${pushed} synced, ${failed} failed`, true)
      } else if (pushed > 0) {
        showToast(`${pushed} tasks synced to Google`)
      } else {
        showToast('All already synced')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', true)
    }
  }

  const isBusy = pull.isPending || push.isPending

  return (
    <>
      {isToDoOpen && (
        <div className="fixed inset-0 z-40 bg-ink-900/10" onClick={closeToDo} />
      )}

      <div
        className={[
          'fixed z-50 bg-white overflow-y-auto transition-transform duration-200 border-ink-200',
          'bottom-0 left-0 right-0 h-[75vh] rounded-t-2xl border-t',
          'lg:left-auto lg:right-0 lg:top-14 lg:h-auto lg:bottom-0 lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l',
          isToDoOpen
            ? 'translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-800">Tasks</h2>
            {toast && (
              <span className={`text-[10px] font-medium ${toast.error ? 'text-red-500' : 'text-accent-600'}`}>
                {toast.msg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Pull: Google Tasks → Board */}
            <button
              onClick={handlePull}
              disabled={isBusy}
              className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] px-2 rounded disabled:opacity-40"
              title="Import from Google Tasks"
            >
              {pull.isPending ? '↻' : '↓'} Google
            </button>
            {/* Push: Board → Google Tasks */}
            <button
              onClick={handlePush}
              disabled={isBusy}
              className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] px-2 rounded disabled:opacity-40"
              title="Sync to Google Tasks"
            >
              {push.isPending ? '↻' : '↑'} Google
            </button>
            <button
              onClick={closeToDo}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none rounded"
            >
              ×
            </button>
          </div>
        </div>

        <div className="py-1 divide-y divide-ink-100">
          {SECTIONS.map(s => (
            <SectionLoader key={s.id} {...s} />
          ))}
        </div>
      </div>
    </>
  )
}

function SectionLoader({ id, label, defaultOpen }: { id: TaskSection; label: string; defaultOpen: boolean }) {
  const { data: tasks = [], isLoading } = useTasksBySection(id)

  if (isLoading) {
    return (
      <div className="px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-300 mb-2">{label}</div>
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-7 bg-cream-200 rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  return <ToDoSection title={label} section={id} tasks={tasks} defaultOpen={defaultOpen} />
}
