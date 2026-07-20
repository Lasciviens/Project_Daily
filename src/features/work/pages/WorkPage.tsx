import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useWorkTasks, useUpdateTask, useDeleteTask, useToggleTask, useCreateTask } from '../../todo/hooks/useTodos'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import WorkBoard from '../components/WorkBoard'
import WorkListView from '../components/WorkListView'
import WorkTaskCard from '../components/WorkTaskCard'
import FocusStrip from '../components/FocusStrip'
import WorkDayTimeline from '../components/WorkDayTimeline'
import WorkSidebar from '../components/WorkSidebar'
import { isOverdue, isCompletedToday, matchesSearch, sortTasks, OVERDUE_COLOR } from '../components/workMeta'
import { toast } from '../../../app/store'
import type { Task, TaskStatus, TaskPriority } from '../../todo/types'

type ViewMode = 'board' | 'list'

function usePersisted<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { return (localStorage.getItem(key) as T) ?? initial } catch { return initial }
  })
  const set = (v: T) => {
    setValue(v)
    try { localStorage.setItem(key, v) } catch { /* ignore */ }
  }
  return [value, set]
}

// Ticking clock — isolated so the 1s re-render stays inside this tiny component.
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="text-xl font-bold text-ink-900 tabular-nums" title={format(now, 'EEEE, d MMMM yyyy')}>
      {format(now, 'HH:mm')}
      <span className="text-ink-300">:{format(now, 'ss')}</span>
    </span>
  )
}

export function WorkPage() {
  const { data: tasks = [], isLoading } = useWorkTasks()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const toggleTask = useToggleTask()
  const createTask = useCreateTask()

  const [addOpen,   setAddOpen]  = useState(false)
  const [editTask,  setEditTask] = useState<Task | null>(null)
  const [search,    setSearch]   = useState('')
  const [prioFilter, setPrioFilter] = useState<'all' | TaskPriority>('all')
  const [quickTitle, setQuickTitle] = useState('')
  const [overdueOpen, setOverdueOpen] = useState(true)
  const [view, setView]         = usePersisted<ViewMode>('work_view', 'board')
  const [rail, setRail]         = usePersisted<'open' | 'closed'>('work_rail', 'open')

  const focusedTasks = tasks.filter(t => t.is_focused)

  const filtered = useMemo(() => tasks.filter(t =>
    matchesSearch(t, search) && (prioFilter === 'all' || t.priority === prioFilter)
  ), [tasks, search, prioFilter])

  const overdueTasks = useMemo(
    () => sortTasks(filtered.filter(t => isOverdue(t) && t.status !== 'in_progress')),
    [filtered]
  )

  const doneToday = tasks.filter(t => t.status === 'done' && isCompletedToday(t)).length
  const wip       = tasks.filter(t => t.status === 'in_progress').length
  const overdueCount = tasks.filter(isOverdue).length

  const toggleFocus = useCallback((task: Task) => {
    updateTask.mutate({ id: task.id, patch: {
      is_focused: !task.is_focused,
      ...((!task.is_focused && task.status === 'open') ? { status: 'in_progress' as TaskStatus } : {}),
    } })
  }, [updateTask])

  const clearFocus = useCallback((id: string) => {
    updateTask.mutate({ id, patch: { is_focused: false } })
  }, [updateTask])

  const handleStatusChange = useCallback(async (id: string, status: TaskStatus, waitingFor?: string) => {
    const tid = toast.loading('Updating…')
    try {
      await updateTask.mutateAsync({ id, patch: {
        status,
        ...(waitingFor !== undefined ? { waiting_for: waitingFor } : {}),
        ...(status === 'done' || status === 'cancelled' ? { is_focused: false } : {}),
      } })
      toast.dismiss(tid); toast.success('Updated ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }, [updateTask])

  const handleMarkDone = useCallback(async (id: string) => {
    const tid = toast.loading('Marking done…')
    try {
      await toggleTask.mutateAsync({ id, isDone: true })
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

  function handleQuickAdd(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !quickTitle.trim()) return
    const title = quickTitle.trim()
    setQuickTitle('')
    createTask.mutate({ title, section: 'today', domain: 'work', priority: 'medium' })
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  const railOpen = rail === 'open'

  return (
    <div className="flex flex-col h-full">
      {/* ── Command bar ── */}
      <div className="flex items-center gap-3 flex-wrap px-4 sm:px-6 py-2.5 sm:py-3 border-b border-ink-100 bg-cream-50 sticky top-0 z-10">
        <div className="flex items-baseline gap-3 min-w-0">
          {/* Redundant on mobile — the bottom tab bar already labels Work. */}
          <h1 className="hidden sm:block text-xl font-bold text-ink-900">Work</h1>
          <LiveClock />
          <span className="hidden sm:inline text-xs text-ink-400">{format(new Date(), 'EEE, d MMM')}</span>
        </div>

        {/* Day stats */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">✓ {doneToday}</span>
          <span className="px-2 py-1 rounded-full bg-accent-50 text-accent-700">⚡ {wip}</span>
          {overdueCount > 0 && (
            <span className="px-2 py-1 rounded-full bg-red-50 text-red-600">⚠ {overdueCount}</span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-white px-4 rounded-xl text-sm font-semibold transition-colors duration-150 min-h-[44px]"
          >
            <span className="text-lg leading-none">+</span>
            <span className="hidden sm:inline">New task</span>
          </button>
          <button
            onClick={() => setRail(railOpen ? 'closed' : 'open')}
            title={railOpen ? 'Hide side panel' : 'Show side panel'}
            className="hidden lg:flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-ink-200 text-ink-400 hover:text-ink-700 hover:border-ink-400 transition-colors"
          >
            {railOpen ? '⇥' : '⇤'}
          </button>
        </div>
      </div>

      <div className={`flex-1 min-h-0 lg:grid ${railOpen ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : 'lg:grid-cols-[minmax(0,1fr)_44px]'}`}>
        {/* ── Main column ── */}
        <div className="flex flex-col min-h-0 overflow-y-auto lg:overflow-hidden">
          <div className="px-4 sm:px-6 pt-3 pb-2 space-y-2">
            <WorkDayTimeline workTasks={tasks} />
            <FocusStrip
              tasks={focusedTasks}
              onMarkDone={handleMarkDone}
              onClearFocus={clearFocus}
              onEdit={setEditTask}
            />

            {/* Overdue alert strip */}
            {overdueTasks.length > 0 && (
              <div className="rounded-2xl border" style={{ borderColor: OVERDUE_COLOR + '55', backgroundColor: OVERDUE_COLOR + '0D' }}>
                <button
                  type="button"
                  onClick={() => setOverdueOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 min-h-[44px]"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: OVERDUE_COLOR }}>
                    ⚠ Overdue · {overdueTasks.length}
                  </span>
                  <span className="text-[10px]" style={{ color: OVERDUE_COLOR }}>{overdueOpen ? '▼' : '▶'}</span>
                </button>
                {overdueOpen && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 px-2 pb-2">
                    {overdueTasks.map(task => (
                      <WorkTaskCard
                        key={task.id}
                        task={task}
                        accentColor={OVERDUE_COLOR}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onEdit={setEditTask}
                        onFocus={toggleFocus}
                        isFocused={task.is_focused}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Board controls: view toggle + quick add + filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-0.5 p-0.5 bg-cream-50 border border-ink-200 rounded-lg">
                {(['board', 'list'] as ViewMode[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 min-h-[44px] rounded-md text-xs font-semibold capitalize transition-colors ${
                      view === v ? 'bg-ink-950 text-white' : 'text-ink-500 hover:text-ink-900'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <input
                value={quickTitle}
                onChange={e => setQuickTitle(e.target.value)}
                onKeyDown={handleQuickAdd}
                placeholder="Quick add task… (Enter)"
                disabled={createTask.isPending}
                className="flex-1 min-w-[140px] max-w-xs text-sm px-3 min-h-[44px] rounded-xl border border-ink-200 bg-cream-50 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-300 disabled:opacity-50"
              />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search…"
                className="flex-1 min-w-[120px] max-w-[200px] text-sm px-3 min-h-[44px] rounded-xl border border-ink-200 bg-cream-50 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
              <select
                value={prioFilter}
                onChange={e => setPrioFilter(e.target.value as 'all' | TaskPriority)}
                className="min-h-[44px] text-xs border border-ink-200 rounded-xl px-2 bg-cream-50 text-ink-700"
              >
                <option value="all">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Board / List */}
          <div className={`px-4 sm:px-6 pb-4 lg:flex-1 lg:min-h-0 ${view === 'board' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto'}`}>
            {view === 'board' ? (
              <WorkBoard
                tasks={filtered}
                focusedTaskIds={focusedTasks.map(t => t.id)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onEdit={setEditTask}
                onFocus={toggleFocus}
                onAddTask={() => setAddOpen(true)}
              />
            ) : (
              <WorkListView
                tasks={filtered}
                focusedTaskIds={focusedTasks.map(t => t.id)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onEdit={setEditTask}
                onFocus={toggleFocus}
              />
            )}
          </div>

          {/* Mobile: rail below content */}
          <div className="lg:hidden px-4 pb-4">
            <WorkSidebar tasks={tasks} />
          </div>
        </div>

        {/* ── Desktop rail ── */}
        {railOpen ? (
          <aside className="hidden lg:block overflow-y-auto border-l border-ink-100 bg-cream-50/60 p-3">
            <WorkSidebar tasks={tasks} />
          </aside>
        ) : (
          <aside className="hidden lg:flex items-start justify-center border-l border-ink-100 bg-cream-50/60 pt-3">
            <button
              onClick={() => setRail('open')}
              title="Show side panel"
              className="min-h-[44px] min-w-[36px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors"
            >
              ⇤
            </button>
          </aside>
        )}
      </div>

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
