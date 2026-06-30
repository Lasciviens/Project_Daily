import { useState, useCallback } from 'react'
import { format } from 'date-fns'
import { useWorkTasks, useUpdateTask, useDeleteTask, useToggleTask } from '../../todo/hooks/useTodos'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import WorkKanban from '../components/WorkKanban'
import HeroTaskWidget from '../components/HeroTaskWidget'
import WorkDayTimeline from '../components/WorkDayTimeline'
import QuickNotesWidget from '../components/QuickNotesWidget'
import WeeklyGoalsWidget from '../components/WeeklyGoalsWidget'
import PinnedLinksWidget from '../components/PinnedLinksWidget'
import EODSummaryWidget from '../components/EODSummaryWidget'
import { DeveloperPage } from '../../developer/pages/DeveloperPage'
import { toast } from '../../../app/store'
import type { Task, TaskStatus } from '../../todo/types'

type WorkTab    = 'board' | 'developer'
type SidebarTab = 'notes' | 'goals' | 'links' | 'summary'

const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'notes',   label: '📝 Notes' },
  { id: 'goals',   label: '🎯 Goals' },
  { id: 'links',   label: '🔗 Links' },
  { id: 'summary', label: '📊 EOD' },
]

const WORK_TABS: { id: WorkTab; label: string }[] = [
  { id: 'board',     label: '📋 Board' },
  { id: 'developer', label: '👨‍💻 Developer' },
]

export function WorkPage() {
  const { data: tasks = [], isLoading } = useWorkTasks()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const toggleTask = useToggleTask()

  const [addOpen,    setAddOpen]   = useState(false)
  const [editTask,   setEditTask]  = useState<Task | null>(null)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('notes')
  const [workTab,    setWorkTab]   = useState<WorkTab>('board')

  // Focused tasks come directly from DB (is_focused column)
  const focusedTasks = tasks.filter(t => t.is_focused)

  const toggleFocus = useCallback((task: Task) => {
    const patch: Partial<Task> = {
      is_focused: !task.is_focused,
      // Auto set in_progress when focusing
      ...((!task.is_focused && task.status === 'open') ? { status: 'in_progress' as TaskStatus } : {}),
    }
    updateTask.mutate({ id: task.id, patch })
  }, [updateTask])

  const clearFocus = useCallback((id: string) => {
    updateTask.mutate({ id, patch: { is_focused: false } })
  }, [updateTask])

  const handleStatusChange = useCallback(async (id: string, status: TaskStatus, waitingFor?: string) => {
    const tid = toast.loading('Updating…')
    try {
      await updateTask.mutateAsync({
        id,
        patch: {
          status,
          ...(waitingFor !== undefined ? { waiting_for: waitingFor } : {}),
          // Auto-clear focus when done/cancelled
          ...(status === 'done' || status === 'cancelled' ? { is_focused: false } : {}),
        },
      })
      toast.dismiss(tid); toast.success('Updated ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [updateTask])

  const handleMarkDone = useCallback(async (id: string) => {
    const tid = toast.loading('Marking done…')
    try {
      await toggleTask.mutateAsync({ id, isDone: true })
      // Also clear focus
      await updateTask.mutateAsync({ id, patch: { is_focused: false } })
      toast.dismiss(tid); toast.success('Done! ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [toggleTask, updateTask])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this task?')) return
    const tid = toast.loading('Deleting…')
    try {
      await deleteTask.mutateAsync(id)
      toast.dismiss(tid); toast.success('Deleted')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [deleteTask])

  const today = format(new Date(), 'EEEE, d MMM yyyy')

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-ink-100 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-ink-900">Work</h1>
            <p className="text-xs text-ink-400 mt-0.5">{today}</p>
          </div>
          {/* Work tab switcher */}
          <div className="flex items-center gap-0.5 bg-cream-100 rounded-xl p-1">
            {WORK_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setWorkTab(tab.id)}
                className={[
                  'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[44px] whitespace-nowrap',
                  workTab === tab.id
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-700',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {workTab === 'board' && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-white px-4 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[44px]"
          >
            <span className="text-lg leading-none">+</span>
            <span>New task</span>
          </button>
        )}
      </div>

      {/* ── Developer tab ── */}
      {workTab === 'developer' && <DeveloperPage />}

      {/* ── Board tab ── */}
      {workTab === 'board' && (
        <div className="flex-1 overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">

          {/* Main: timeline + hero + kanban */}
          <div className="flex flex-col overflow-hidden">
            {/* Day timeline */}
            <div className="px-4 sm:px-6 pt-4 pb-2">
              <WorkDayTimeline workTasks={tasks} />
            </div>

            {/* Multi-focus hero */}
            <div className="px-4 sm:px-6 pb-2">
              <HeroTaskWidget
                tasks={focusedTasks}
                onMarkDone={handleMarkDone}
                onClearFocus={clearFocus}
                onEdit={setEditTask}
              />
            </div>

            {/* Kanban */}
            <div className="flex-1 overflow-hidden px-2 sm:px-4 pb-4">
              <WorkKanban
                tasks={tasks}
                focusedTaskIds={focusedTasks.map(t => t.id)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onEdit={setEditTask}
                onFocus={toggleFocus}
                onAddTask={() => setAddOpen(true)}
              />
            </div>
          </div>

          {/* Sidebar — desktop with horizontal tabs */}
          <aside className="hidden lg:flex flex-col overflow-hidden border-l border-ink-100 bg-cream-50/60">
            {/* Tab bar */}
            <div className="flex overflow-x-auto gap-0.5 p-2 border-b border-ink-100 bg-white no-scrollbar">
              {SIDEBAR_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSidebarTab(tab.id)}
                  className={[
                    'flex-1 min-w-0 whitespace-nowrap text-[11px] font-medium px-2 py-2 rounded-lg transition-colors min-h-[44px]',
                    sidebarTab === tab.id
                      ? 'bg-accent-500 text-white'
                      : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {sidebarTab === 'notes'   && <QuickNotesWidget />}
              {sidebarTab === 'goals'   && <WeeklyGoalsWidget />}
              {sidebarTab === 'links'   && <PinnedLinksWidget />}
              {sidebarTab === 'summary' && <EODSummaryWidget tasks={tasks} />}
            </div>
          </aside>
        </div>
      )}

      {/* Mobile sidebar — only shown on board tab */}
      {workTab === 'board' && <MobileSidebar tasks={tasks} />}

      {/* Modals */}
      <UnifiedPlanModal
        open={addOpen || !!editTask}
        onClose={() => { setAddOpen(false); setEditTask(null) }}
        config={{ tabs: ['task', 'schedule'], heading: editTask ? 'Edit Task' : 'New Task' }}
        defaults={{ domain: 'work', section: 'today' }}
        task={editTask ?? undefined}
      />
    </div>
  )
}

// ── Mobile sidebar ─────────────────────────────────────────────────
function MobileSidebar({ tasks }: { tasks: Task[] }) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('notes')
  const [open, setOpen]           = useState(false)

  return (
    <div className="lg:hidden border-t border-ink-100">
      {/* Toggle bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink-700 hover:bg-cream-50 transition-colors min-h-[44px]"
      >
        <span>📋 Notes & Tools</span>
        <span className="text-ink-300 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* Horizontal tabs */}
          <div className="flex overflow-x-auto gap-1 px-3 pb-2 no-scrollbar">
            {SIDEBAR_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex-shrink-0 text-xs font-medium px-3 py-2 rounded-lg transition-colors min-h-[44px]',
                  activeTab === tab.id
                    ? 'bg-accent-500 text-white'
                    : 'text-ink-500 bg-cream-50 border border-ink-200 hover:bg-ink-100',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="px-4 pb-4 bg-cream-50/50">
            {activeTab === 'notes'   && <QuickNotesWidget />}
            {activeTab === 'goals'   && <WeeklyGoalsWidget />}
            {activeTab === 'links'   && <PinnedLinksWidget />}
            {activeTab === 'summary' && <EODSummaryWidget tasks={tasks} />}
          </div>
        </>
      )}
    </div>
  )
}
