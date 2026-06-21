import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { useWorkTasks, useUpdateTask, useDeleteTask, useToggleTask } from '../../todo/hooks/useTodos'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'
import WorkKanban from '../components/WorkKanban'
import HeroTaskWidget from '../components/HeroTaskWidget'
import QuickNotesWidget from '../components/QuickNotesWidget'
import WeeklyGoalsWidget from '../components/WeeklyGoalsWidget'
import PinnedLinksWidget from '../components/PinnedLinksWidget'
import EODSummaryWidget from '../components/EODSummaryWidget'
import { toast } from '../../../app/store'
import type { Task, TaskStatus } from '../../todo/types'

const FOCUSED_KEY = 'work_focused_task_id'

export function WorkPage() {
  const { data: tasks = [], isLoading } = useWorkTasks()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const toggleTask = useToggleTask()

  const [addOpen,      setAddOpen]      = useState(false)
  const [editTask,     setEditTask]     = useState<Task | null>(null)
  const [focusedId,    setFocusedId]    = useState<string | null>(
    () => localStorage.getItem(FOCUSED_KEY)
  )

  // Auto-clear focus when focused task is done/deleted
  useEffect(() => {
    if (!focusedId) return
    const t = tasks.find(t => t.id === focusedId)
    if (!t || t.status === 'done' || t.status === 'cancelled') {
      setFocusedId(null)
      localStorage.removeItem(FOCUSED_KEY)
    }
  }, [tasks, focusedId])

  const setFocus = useCallback((task: Task) => {
    setFocusedId(task.id)
    localStorage.setItem(FOCUSED_KEY, task.id)
    if (task.status !== 'in_progress') {
      updateTask.mutate({ id: task.id, patch: { status: 'in_progress' } })
    }
  }, [updateTask])

  const clearFocus = useCallback(() => {
    setFocusedId(null)
    localStorage.removeItem(FOCUSED_KEY)
  }, [])

  const handleStatusChange = useCallback(async (id: string, status: TaskStatus, waitingFor?: string) => {
    const tid = toast.loading('Updating…')
    try {
      await updateTask.mutateAsync({
        id,
        patch: { status, ...(waitingFor !== undefined ? { waiting_for: waitingFor } : {}) },
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
      if (focusedId === id) { setFocusedId(null); localStorage.removeItem(FOCUSED_KEY) }
      toast.dismiss(tid); toast.success('Done! ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [toggleTask, focusedId])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this task?')) return
    const tid = toast.loading('Deleting…')
    try {
      await deleteTask.mutateAsync(id)
      if (focusedId === id) { setFocusedId(null); localStorage.removeItem(FOCUSED_KEY) }
      toast.dismiss(tid); toast.success('Deleted')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [deleteTask, focusedId])

  const focusedTask = focusedId ? (tasks.find(t => t.id === focusedId) ?? null) : null
  const today       = format(new Date(), 'EEEE, d MMM yyyy')

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
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-ink-100 bg-white sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Work</h1>
          <p className="text-xs text-ink-400 mt-0.5">{today}</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-white px-4 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[44px]"
        >
          <span className="text-lg leading-none">+</span>
          <span>New task</span>
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden lg:grid lg:grid-cols-[1fr_272px]">

        {/* Main: hero + kanban */}
        <div className="flex flex-col overflow-hidden">
          <div className="px-4 sm:px-6 pt-4 pb-2">
            <HeroTaskWidget
              task={focusedTask}
              onMarkDone={handleMarkDone}
              onClearFocus={clearFocus}
            />
          </div>

          <div className="flex-1 overflow-hidden px-2 sm:px-4 pb-4">
            <WorkKanban
              tasks={tasks}
              focusedTaskId={focusedId}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onEdit={setEditTask}
              onFocus={setFocus}
              onAddTask={() => setAddOpen(true)}
            />
          </div>
        </div>

        {/* Sidebar (desktop only) */}
        <aside className="hidden lg:flex flex-col gap-4 overflow-y-auto p-4 border-l border-ink-100 bg-cream-50/60">
          <QuickNotesWidget />
          <div className="border-t border-ink-100 pt-4">
            <WeeklyGoalsWidget />
          </div>
          <div className="border-t border-ink-100 pt-4">
            <PinnedLinksWidget />
          </div>
          <div className="border-t border-ink-100 pt-4">
            <EODSummaryWidget tasks={tasks} />
          </div>
        </aside>
      </div>

      {/* Mobile sidebar accordion */}
      <MobileSidebar tasks={tasks} />

      {/* Modals */}
      {(addOpen || editTask) && (
        <AddTaskModal
          isOpen={addOpen || !!editTask}
          defaultDomain="work"
          defaultSection="today"
          task={editTask ?? undefined}
          onClose={() => { setAddOpen(false); setEditTask(null) }}
        />
      )}
    </div>
  )
}

// ── Mobile sidebar accordion ───────────────────────────────────────
function MobileSidebar({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (id: string) => setOpen(o => o === id ? null : id)

  const sections = [
    { id: 'goals', label: '🎯 This Week',   node: <WeeklyGoalsWidget /> },
    { id: 'notes', label: '📝 Notes',        node: <QuickNotesWidget /> },
    { id: 'links', label: '🔗 Pinned Links', node: <PinnedLinksWidget /> },
    { id: 'eod',   label: '📊 Summary',      node: <EODSummaryWidget tasks={tasks} /> },
  ]

  return (
    <div className="lg:hidden border-t-2 border-ink-100">
      {sections.map(({ id, label, node }) => (
        <div key={id} className="border-b border-ink-100">
          <button
            onClick={() => toggle(id)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink-700 hover:bg-cream-50 transition-colors duration-100 min-h-[44px]"
          >
            <span>{label}</span>
            <span className="text-ink-300 text-xs">{open === id ? '▲' : '▼'}</span>
          </button>
          {open === id && (
            <div className="px-4 pb-4 bg-cream-50/50">
              {node}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
