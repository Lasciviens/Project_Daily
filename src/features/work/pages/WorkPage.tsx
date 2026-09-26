import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, Check, PanelRightClose, PanelRightOpen, Plus, Zap } from 'lucide-react'
import { useWorkTasks, useUpdateTask, useDeleteTask, useToggleTask, useCreateTask } from '../../todo/hooks/useTodos'
import { useEntityModal } from '../../../shared/modals'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { Button, IconButton, PageContainer, PageHeader, Skeleton, TonePill, cx } from '../../../shared/ui'
import WorkBoard from '../components/WorkBoard'
import WorkListView from '../components/WorkListView'
import FocusStrip from '../components/FocusStrip'
import OverdueStrip from '../components/OverdueStrip'
import WorkSidebar from '../components/WorkSidebar'
import WorkToolbar, { type PrioFilter, type ViewMode } from '../components/WorkToolbar'
import { isOverdue, isCompletedToday, matchesSearch, sortTasks } from '../components/workMeta'
import { STATUS_TONE } from '../../todo/taskTones'
import type { Task, TaskStatus } from '../../todo/types'

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
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const toggleTask = useToggleTask()
  const createTask = useCreateTask()

  const modal = useEntityModal()
  const openNew  = useCallback(() => modal.open({ kind: 'task', config: { heading: 'New task' }, defaults: { domain: 'work', section: 'today' } }), [modal])
  const openEdit = useCallback((task: Task) => modal.open({ kind: 'task', id: task.id, config: { heading: 'Edit task' } }), [modal])

  const [search, setSearch]         = useState('')
  const [prioFilter, setPrioFilter] = useState<PrioFilter>('all')
  const [view, setView]             = usePersisted<ViewMode>('work_view', 'board')
  const [rail, setRail]             = usePersisted<'open' | 'closed'>('work_rail', 'open')

  const focusedTasks = tasks.filter(t => t.is_focused)
  const focusedIds = focusedTasks.map(t => t.id)

  const filtered = useMemo(() => tasks.filter(t =>
    matchesSearch(t, search) && (prioFilter === 'all' || t.priority === prioFilter)
  ), [tasks, search, prioFilter])

  const overdueTasks = useMemo(
    () => sortTasks(filtered.filter(t => isOverdue(t) && t.status !== 'in_progress')),
    [filtered]
  )

  const doneToday    = tasks.filter(t => t.status === 'done' && isCompletedToday(t)).length
  const wip          = tasks.filter(t => t.status === 'in_progress').length
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
    await withProgress(() => updateTask.mutateAsync({ id, patch: {
      status,
      ...(waitingFor !== undefined ? { waiting_for: waitingFor } : {}),
      ...(status === 'done' || status === 'cancelled' ? { is_focused: false } : {}),
    } }), { loading: 'Updating…', success: 'Updated' })
  }, [updateTask])

  const handleMarkDone = useCallback(async (id: string) => {
    await withProgress(async () => {
      await toggleTask.mutateAsync({ id, isDone: true })
      await updateTask.mutateAsync({ id, patch: { is_focused: false } })
    }, { loading: 'Marking done…', success: 'Marked done' })
  }, [toggleTask, updateTask])

  const handleDelete = useCallback(async (id: string) => {
    if (!(await modal.confirm({ title: 'Delete this task?', confirmLabel: 'Delete', destructive: true }))) return
    await withProgress(() => deleteTask.mutateAsync(id), { loading: 'Deleting…', success: 'Deleted' })
  }, [deleteTask, modal])

  const handleQuickAdd = useCallback((title: string) => {
    createTask.mutate({ title, section: 'today', domain: 'work', priority: 'medium' })
  }, [createTask])

  const railOpen = rail === 'open'
  const cardActions = { onStatusChange: handleStatusChange, onDelete: handleDelete, onEdit: openEdit, onFocus: toggleFocus }

  return (
    <PageContainer width="full" className="pt-0 sm:pt-0">
      {/* Sticky command bar: stays put while the board scrolls in <main>. */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-canvas/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <PageHeader
          className="mb-0"
          title="Work"
          subtitle={<span className="hidden sm:inline">{format(new Date(), 'EEEE d MMMM')}</span>}
          actions={
            <>
              <span className="flex items-center gap-1.5" aria-label="Today at a glance">
                <TonePill tone={STATUS_TONE.done} className="tabular-nums"><Check aria-hidden className="h-3 w-3" />{doneToday} done</TonePill>
                <TonePill tone={STATUS_TONE.in_progress} className="tabular-nums"><Zap aria-hidden className="h-3 w-3" />{wip} active</TonePill>
                {overdueCount > 0 && (
                  <TonePill tone="danger" className="tabular-nums"><AlertTriangle aria-hidden className="h-3 w-3" />{overdueCount} overdue</TonePill>
                )}
              </span>
              <Button variant="primary" icon={<Plus />} onClick={openNew} className="ml-auto sm:ml-0">New task</Button>
              <IconButton
                label={railOpen ? 'Hide side panel' : 'Show side panel'}
                bordered
                onClick={() => setRail(railOpen ? 'closed' : 'open')}
                className="hidden 2xl:grid"
              >
                {railOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </IconButton>
            </>
          }
        />
      </div>

      {isLoading ? (
        <div className="grid max-w-[91rem] gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-64" />)}
        </div>
      ) : (
        // Rail beside the board only on wide monitors; below 2xl it stacks
        // under the board so the four columns keep a usable width.
        <div className={cx('grid items-start gap-5', railOpen && '2xl:grid-cols-[minmax(0,91rem)_20rem]')}>
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

          <aside className={cx('min-w-0 max-w-[91rem]', !railOpen && '2xl:hidden')}>
            <WorkSidebar tasks={tasks} />
          </aside>
        </div>
      )}
    </PageContainer>
  )
}
