import { useState } from 'react'
import type { Task, TaskStatus } from '../../todo/types'
import WorkTaskCard from './WorkTaskCard'

interface Props {
  tasks: Task[]
  focusedTaskId: string | null
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  onAddTask: (defaultStatus?: TaskStatus) => void
}

type ColumnId = 'overdue' | 'open' | 'in_progress' | 'waiting' | 'done'

interface Column {
  id: ColumnId
  label: string
  colorClass: string
  headerBadge: string
}

const COLUMNS: Column[] = [
  { id: 'overdue',     label: 'Overdue',     colorClass: 'text-red-600',    headerBadge: 'bg-red-100 text-red-600' },
  { id: 'open',        label: 'To-do',       colorClass: 'text-ink-700',    headerBadge: 'bg-ink-100 text-ink-600' },
  { id: 'in_progress', label: 'In Progress', colorClass: 'text-accent-600', headerBadge: 'bg-accent-100 text-accent-600' },
  { id: 'waiting',     label: 'Waiting',     colorClass: 'text-sky-600',    headerBadge: 'bg-sky-100 text-sky-700' },
  { id: 'done',        label: 'Done',        colorClass: 'text-green-600',  headerBadge: 'bg-green-100 text-green-700' },
]

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

const TODAY = new Date().toISOString().slice(0, 10)

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < TODAY
}

function getColumnId(task: Task): ColumnId {
  if (isOverdue(task)) return 'overdue'
  if (task.status === 'open') return 'open'
  if (task.status === 'in_progress') return 'in_progress'
  if (task.status === 'waiting') return 'waiting'
  if (task.status === 'done') return 'done'
  return 'open'
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1
    const pb = PRIORITY_ORDER[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}

// Status to apply when dropping into a column
const COLUMN_STATUS: Record<ColumnId, TaskStatus> = {
  overdue:     'open',
  open:        'open',
  in_progress: 'in_progress',
  waiting:     'waiting',
  done:        'done',
}

export default function WorkKanban({
  tasks,
  focusedTaskId,
  onStatusChange,
  onDelete,
  onEdit,
  onFocus,
  onAddTask,
}: Props) {
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null)
  const [activeTab, setActiveTab]     = useState<ColumnId>('open')

  // Group tasks into columns
  const columnTasks = Object.fromEntries(
    COLUMNS.map(col => [
      col.id,
      sortTasks(tasks.filter(t => getColumnId(t) === col.id)),
    ])
  ) as Record<ColumnId, Task[]>

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, colId: ColumnId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colId)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear if actually leaving the column (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverCol(null)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, colId: ColumnId) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    if (!taskId) return
    setDragOverCol(null)
    setDraggingId(null)
    const newStatus = COLUMN_STATUS[colId]
    onStatusChange(taskId, newStatus)
  }

  function renderColumn(col: Column) {
    const colTasks = columnTasks[col.id]
    const isDropTarget = dragOverCol === col.id
    const isDoneCol = col.id === 'done'

    return (
      <div
        key={col.id}
        onDragOver={e => handleDragOver(e, col.id)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, col.id)}
        className={[
          'flex flex-col rounded-xl border bg-cream-50 transition-colors',
          'min-w-[220px] max-w-[260px] flex-shrink-0',
          isDropTarget
            ? 'border-dashed border-accent-400 bg-accent-50'
            : 'border-ink-200',
        ].join(' ')}
      >
        {/* Column header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-ink-100">
          <span className={['text-xs font-bold uppercase tracking-wide', col.colorClass].join(' ')}>
            {col.label}
          </span>
          <span className={['text-[11px] font-semibold px-1.5 py-0.5 rounded-full', col.headerBadge].join(' ')}>
            {colTasks.length}
          </span>
        </div>

        {/* Task list */}
        <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto max-h-[60vh]">
          {colTasks.length === 0 && (
            <p className="text-xs text-ink-300 text-center py-4">No tasks</p>
          )}
          {colTasks.map(task => (
            <WorkTaskCard
              key={task.id}
              task={task}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onEdit={onEdit}
              onFocus={onFocus}
              isFocused={task.id === focusedTaskId}
              isDragging={task.id === draggingId}
            />
          ))}
        </div>

        {/* Footer add button */}
        {!isDoneCol && (
          <div className="px-2 pb-2 pt-1">
            <button
              onClick={() => onAddTask(COLUMN_STATUS[col.id])}
              className="w-full min-h-[44px] flex items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-xs text-ink-400 hover:border-accent-400 hover:text-accent-500 hover:bg-accent-50 transition-colors"
            >
              + Add
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* ── Desktop: horizontal scroll ── */}
      <div className="hidden md:flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map(col => renderColumn(col))}
      </div>

      {/* ── Mobile: tab bar + single column ── */}
      <div className="md:hidden flex flex-col gap-3">
        {/* Tab bar */}
        <div className="flex overflow-x-auto gap-1 pb-1 no-scrollbar">
          {COLUMNS.map(col => {
            const count = columnTasks[col.id].length
            const isActive = activeTab === col.id
            return (
              <button
                key={col.id}
                onClick={() => setActiveTab(col.id)}
                className={[
                  'min-h-[44px] flex-shrink-0 flex items-center gap-1.5 px-3 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-500 text-white'
                    : 'bg-cream-50 text-ink-600 border border-ink-200',
                ].join(' ')}
              >
                {col.label}
                <span
                  className={[
                    'text-[11px] font-bold px-1.5 py-0.5 rounded-full',
                    isActive ? 'bg-white/20' : col.headerBadge,
                  ].join(' ')}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Active column content */}
        {COLUMNS.filter(col => col.id === activeTab).map(col => {
          const colTasks = columnTasks[col.id]
          const isDoneCol = col.id === 'done'
          return (
            <div
              key={col.id}
              onDragOver={e => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, col.id)}
              className={[
                'flex flex-col gap-2 rounded-xl border p-2 min-h-[120px] transition-colors',
                dragOverCol === col.id
                  ? 'border-dashed border-accent-400 bg-accent-50'
                  : 'border-ink-200 bg-cream-50',
              ].join(' ')}
            >
              {colTasks.length === 0 && (
                <p className="text-xs text-ink-300 text-center py-4">No tasks</p>
              )}
              {colTasks.map(task => (
                <WorkTaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onFocus={onFocus}
                  isFocused={task.id === focusedTaskId}
                  isDragging={task.id === draggingId}
                />
              ))}
              {!isDoneCol && (
                <button
                  onClick={() => onAddTask(COLUMN_STATUS[col.id])}
                  className="w-full min-h-[44px] flex items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-xs text-ink-400 hover:border-accent-400 hover:text-accent-500 transition-colors"
                >
                  + Add
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
