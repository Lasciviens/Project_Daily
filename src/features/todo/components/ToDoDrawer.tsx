import { useState } from 'react'
import { useUIStore } from '../../../app/store'
import { useTasksBySection, useSyncFromTodoist } from '../hooks/useTodos'
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
  const sync    = useSyncFromTodoist()
  const [toast, setToast] = useState<string | null>(null)

  async function handleSync() {
    try {
      const imported = await sync.mutateAsync()
      const msg = imported > 0 ? `${imported} task${imported !== 1 ? 's' : ''} imported` : 'Already up to date'
      setToast(msg)
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      setToast(msg.length > 40 ? 'Sync failed' : msg)
      setTimeout(() => setToast(null), 4000)
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isToDoOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/10"
          onClick={closeToDo}
        />
      )}

      {/* Panel — bottom sheet on mobile, right side on desktop */}
      <div
        className={[
          'fixed z-50 bg-white overflow-y-auto transition-transform duration-200 border-ink-200',
          // Mobile: bottom sheet
          'bottom-0 left-0 right-0 h-[75vh] rounded-t-2xl border-t',
          // Desktop: right side panel (overrides mobile styles)
          'lg:left-auto lg:right-0 lg:top-14 lg:h-auto lg:bottom-0 lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l',
          // Open / closed
          isToDoOpen
            ? 'translate-y-0 lg:translate-x-0'
            : 'translate-y-full lg:translate-y-0 lg:translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-800">To-Do</h2>
            {toast && (
              <span className="text-[10px] text-accent-600 font-medium">{toast}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSync}
              disabled={sync.isPending}
              className="text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 px-2 py-1 rounded disabled:opacity-40"
              title="Sync from Todoist"
            >
              {sync.isPending ? '↻' : '⇅'} Sync
            </button>
            <button
              onClick={closeToDo}
              className="w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none rounded"
            >
              ×
            </button>
          </div>
        </div>

        {/* Sections */}
        <div className="py-1 divide-y divide-ink-100">
          {SECTIONS.map(s => (
            <SectionLoader key={s.id} {...s} />
          ))}
        </div>
      </div>
    </>
  )
}

function SectionLoader({
  id,
  label,
  defaultOpen,
}: {
  id: TaskSection
  label: string
  defaultOpen: boolean
}) {
  const { data: tasks = [], isLoading } = useTasksBySection(id)

  if (isLoading) {
    return (
      <div className="px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-300 mb-2">
          {label}
        </div>
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-7 bg-cream-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <ToDoSection
      title={label}
      section={id}
      tasks={tasks}
      defaultOpen={defaultOpen}
    />
  )
}
