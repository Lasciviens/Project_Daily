import { useState } from 'react'
import type { Task, TaskStatus } from '../../todo/types'
import WorkTaskCard from './WorkTaskCard'

interface Props {
  tasks: Task[]
  focusedTaskIds: string[]
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  onAddTask: (defaultStatus?: TaskStatus) => void
}

type ColumnId = 'overdue' | 'open' | 'in_progress' | 'waiting' | 'done'

interface Column {
  id:        ColumnId
  label:     string
  color:     string
  textColor: string
}

// Status colors — medium darkness, full red for overdue
const COLUMNS: Column[] = [
  { id: 'overdue',     label: 'Overdue',     color: '#DC2626', textColor: '#fff' },
  { id: 'open',        label: 'To-do',       color: '#D97706', textColor: '#fff' },
  { id: 'in_progress', label: 'In Progress', color: '#16A34A', textColor: '#fff' },
  { id: 'waiting',     label: 'Waiting',     color: '#0284C7', textColor: '#fff' },
  { id: 'done',        label: 'Done today',  color: '#6B7280', textColor: '#fff' },
]

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
const TODAY = new Date().toISOString().slice(0, 10)

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return task.due_date < TODAY
}

function isCompletedToday(task: Task): boolean {
  return task.updated_at?.slice(0, 10) === TODAY
}

function getColumnId(task: Task): ColumnId {
  if (isOverdue(task))               return 'overdue'
  if (task.status === 'open')        return 'open'
  if (task.status === 'in_progress') return 'in_progress'
  if (task.status === 'waiting')     return 'waiting'
  if (task.status === 'done')        return 'done'
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

const COLUMN_STATUS: Record<ColumnId, TaskStatus> = {
  overdue: 'open', open: 'open', in_progress: 'in_progress',
  waiting: 'waiting', done: 'done',
}

export default function WorkKanban({
  tasks, focusedTaskIds, onStatusChange, onDelete, onEdit, onFocus, onAddTask,
}: Props) {
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null)
  const [collapsed,   setCollapsed]   = useState<Partial<Record<ColumnId, boolean>>>({
    done: true,
  })

  const columnTasks = Object.fromEntries(
    COLUMNS.map(col => {
      let colTasks = tasks.filter(t => getColumnId(t) === col.id)
      if (col.id === 'done') colTasks = colTasks.filter(isCompletedToday)
      return [col.id, sortTasks(colTasks)]
    })
  ) as Record<ColumnId, Task[]>

  function toggle(colId: ColumnId) {
    setCollapsed(prev => ({ ...prev, [colId]: !prev[colId] }))
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, colId: ColumnId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colId)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, colId: ColumnId) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    if (!taskId) return
    setDragOverCol(null)
    setDraggingId(null)
    onStatusChange(taskId, COLUMN_STATUS[colId])
  }

  return (
    <div className="flex flex-col gap-1">
      {COLUMNS.map(col => {
        const colTasks     = columnTasks[col.id]
        const isCollapsed  = !!collapsed[col.id]
        const isDropTarget = dragOverCol === col.id
        const isDoneCol    = col.id === 'done'

        return (
          <div
            key={col.id}
            onDragOver={e => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, col.id)}
            className={[
              'rounded-xl border border-ink-200 border-l-4 transition-colors',
              isDropTarget ? 'ring-2 bg-opacity-10' : 'bg-cream-50',
            ].join(' ')}
            style={{
              borderLeftColor: col.color,
              ...(isDropTarget ? { backgroundColor: col.color + '15', outline: `2px dashed ${col.color}` } : {}),
            }}
          >
            {/* Section header */}
            <button
              onClick={() => toggle(col.id)}
              className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] hover:bg-ink-50/50 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: col.color }}
                >
                  {col.label}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: col.color, color: col.textColor }}
                >
                  {colTasks.length}
                </span>
              </div>
              <span className="text-ink-300 text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
            </button>

            {/* Task grid */}
            {!isCollapsed && (
              <div className="px-2 pb-2">
                {colTasks.length === 0 ? (
                  <p className="text-[11px] text-ink-300 py-1.5 pl-1">
                    {isDoneCol ? 'Nothing completed today' : 'No tasks'}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
                    {colTasks.map(task => (
                      <WorkTaskCard
                        key={task.id}
                        task={task}
                        columnColor={col.color}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                        onEdit={onEdit}
                        onFocus={onFocus}
                        isFocused={focusedTaskIds.includes(task.id)}
                        isDragging={task.id === draggingId}
                        onDragStart={id => setDraggingId(id)}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    ))}
                  </div>
                )}
                {!isDoneCol && (
                  <button
                    onClick={() => onAddTask(COLUMN_STATUS[col.id])}
                    className="mt-1.5 w-full min-h-[44px] flex items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-[11px] text-ink-400 hover:border-accent-400 hover:text-accent-500 hover:bg-accent-50 transition-colors"
                  >
                    + Add
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
