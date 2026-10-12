import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { AlertTriangle, Check, PanelRightClose, PanelRightOpen, Plus, Zap } from 'lucide-react'
import { useWorkTasks, useCreateTask } from '../../todo/hooks/useTodos'
import { useTaskActions } from '../../todo/hooks/useTaskActions'
import { useEntityModal } from '../../../shared/modals'
import { Button, IconButton, PageBoard, PageContainer, PageHeader, Skeleton, TonePill, usePageStep } from '../../../shared/ui'
import WorkBoard from '../components/WorkBoard'
import WorkListView from '../components/WorkListView'
import FocusStrip from '../components/FocusStrip'
import OverdueStrip from '../components/OverdueStrip'
import WorkSidebar from '../components/WorkSidebar'
import { WorkHeroArt } from '../components/WorkHeroArt'
import WorkToolbar, { type PrioFilter, type ViewMode } from '../components/WorkToolbar'
import { matchesSearch, sortTasks } from '../components/workMeta'
import { countTasks, isFocusedOpen, isOverdueOn } from '../../todo/taskRules'
import { todayStr } from '../../../shared/utils/dateUtils'
import { STATUS_TONE } from '../../todo/taskTones'
import type { Task, TaskStatus } from '../../todo/types'
import { railToggleFrom, workHeaderCapRem, workLayout, type WorkSection } from '../workBoard'

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

export function WorkPage() {
  const { data: tasks = [], isLoading } = useWorkTasks()
  const createTask = useCreateTask()
  // THE task actions (useTaskActions) — the same as Daily's and Home's rows.
  const act = useTaskActions()
  const today = todayStr()

  const modal = useEntityModal()
  const openNew  = useCallback(() => modal.open({ kind: 'task', config: { heading: 'New task' }, defaults: { domain: 'work', section: 'today' } }), [modal])
  const openEdit = act.edit

  const [search, setSearch]         = useState('')
  const [prioFilter, setPrioFilter] = useState<PrioFilter>('all')
  const [view, setView]             = usePersisted<ViewMode>('work_view', 'board')
  const [rail, setRail]             = usePersisted<'open' | 'closed'>('work_rail', 'open')

  // Focus is for work still to do; a closed task leaves it (migration 143).
  const focusedTasks = tasks.filter(isFocusedOpen)
  const focusedIds = focusedTasks.map(t => t.id)

  const filtered = useMemo(() => tasks.filter(t =>
    matchesSearch(t, search) && (prioFilter === 'all' || t.priority === prioFilter)
  ), [tasks, search, prioFilter])

  const overdueTasks = useMemo(
    () => sortTasks(filtered.filter(t => isOverdueOn(t, today) && t.status !== 'in_progress')),
    [filtered, today]
  )

  // The same counts as Daily and Home (taskRules): done = closed today.
  const counts = countTasks(tasks, today, today)

  // Cards and rows hand over an id; the actions take the task.
  const byId = useCallback((id: string) => tasks.find(t => t.id === id), [tasks])
  const handleStatusChange = useCallback((id: string, status: TaskStatus, waitingFor?: string) => {
    const task = byId(id)
    if (task) void act.setStatus(task, status, { waitingFor })
  }, [act, byId])
  const handleMarkDone = useCallback((id: string) => {
    const task = byId(id)
    if (task) void act.setDone(task, true)
  }, [act, byId])
  const clearFocus = useCallback((id: string) => {
    const task = byId(id)
    if (task?.is_focused) void act.toggleFocus(task)
  }, [act, byId])
  const handleDelete = useCallback((id: string) => {
    const task = byId(id)
    if (task) void act.remove(task)
  }, [act, byId])
  const toggleFocus = useCallback((task: Task) => { void act.toggleFocus(task) }, [act])

  const handleQuickAdd = useCallback((title: string) => {
    createTask.mutate({ title, section: 'today', domain: 'work', priority: 'medium' })
  }, [createTask])

  const railOpen = rail === 'open'
  const cardActions = { onStatusChange: handleStatusChange, onDelete: handleDelete, onEdit: openEdit, onFocus: toggleFocus }
  // The command bar spans the page's content width, so it measures the same
  // step as the board below it: the rail toggle only exists in Board view
  // where the rail sits beside the work, and the header stops where the
  // board's last card does (workBoard.ts).
  const { ref: barRef, step } = usePageStep<HTMLDivElement>()
  const toggleFrom = railToggleFrom(view)
  const canHideRail = toggleFrom != null && (step ?? 1) >= toggleFrom
  const headerCap = step == null ? null : workHeaderCapRem(view, railOpen, step)

  const sections: Record<WorkSection, ReactNode> = {
    work: isLoading ? (
      <div className="grid gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-64" />)}
      </div>
    ) : (
      <div className="flex min-w-0 flex-col gap-4">
        <FocusStrip tasks={focusedTasks} onMarkDone={handleMarkDone} onClearFocus={clearFocus} onEdit={openEdit} />
        <OverdueStrip tasks={overdueTasks} {...cardActions} />
        <WorkToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          prio={prioFilter}
          onPrioChange={setPrioFilter}
          onQuickAdd={handleQuickAdd}
          quickAddBusy={createTask.isPending}
        />
        {view === 'board'
          ? <WorkBoard tasks={filtered} focusedTaskIds={focusedIds} onAddTask={openNew} {...cardActions} />
          : <WorkListView tasks={filtered} focusedTaskIds={focusedIds} {...cardActions} />}
      </div>
    ),
    rail: isLoading ? null : <aside aria-label="Work side panel" className="min-w-0"><WorkSidebar tasks={tasks} /></aside>,
  }

  return (
    <PageContainer className="pt-0 sm:pt-0">
      {/* Sticky command bar: stays put while the board scrolls in <main>. */}
      <div ref={barRef} className="sticky top-0 z-10 -mx-4 mb-4 bg-canvas/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div style={headerCap != null ? { maxWidth: `${headerCap}rem` } : undefined}>
          <PageHeader
            className="mb-0 sm:mb-0"
            title="Work"
            art={<WorkHeroArt />}
            subtitle={<span className="hidden sm:inline">{formatWeekdayDate(new Date(), 'long')}</span>}
            actions={
              <>
                <span className="flex items-center gap-1.5" aria-label="Today at a glance">
                  <TonePill tone={STATUS_TONE.done} className="tabular-nums"><Check aria-hidden className="h-3 w-3" />{counts.done} done</TonePill>
                  <TonePill tone={STATUS_TONE.in_progress} className="tabular-nums"><Zap aria-hidden className="h-3 w-3" />{counts.inProgress} active</TonePill>
                  {counts.overdue > 0 && (
                    <TonePill tone="danger" className="tabular-nums"><AlertTriangle aria-hidden className="h-3 w-3" />{counts.overdue} overdue</TonePill>
                  )}
                </span>
                <Button variant="primary" icon={<Plus />} onClick={openNew} className="ml-auto sm:ml-0">New task</Button>
                {canHideRail && (
                  <IconButton
                    label={railOpen ? 'Hide side panel' : 'Show side panel'}
                    bordered
                    onClick={() => setRail(railOpen ? 'closed' : 'open')}
                  >
                    {railOpen ? <PanelRightClose /> : <PanelRightOpen />}
                  </IconButton>
                )}
              </>
            }
          />
        </div>
      </div>

      <PageBoard sections={sections} layout={workLayout(view, railOpen)} stackGap="gap-5" />
    </PageContainer>
  )
}
