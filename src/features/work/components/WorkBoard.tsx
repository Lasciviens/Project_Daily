import { useState } from 'react'
import type { Task, TaskStatus } from '../../todo/types'
import WorkTaskCard from './WorkTaskCard'
import { BOARD_COLUMNS, isCompletedToday, isOverdue, sortTasks, type BoardStatus } from './workMeta'

interface Props {
  tasks: Task[]                 // already search/priority-filtered by the page
  focusedTaskIds: string[]
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  onAddTask: () => void
}

// True horizontal kanban on desktop (each column scrolls independently);
// stacked collapsible sections on mobile. Overdue is NOT a column — it's a
// property, shown as the alert strip above the board (see WorkPage).
export default function WorkBoard({
  tasks, focusedTaskIds, onStatusChange, onDelete, onEdit, onFocus, onAddTask,
}: Props) {
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<BoardStatus | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState<Partial<Record<BoardStatus, boolean>>>({ done: true })

  const columnTasks = Object.fromEntries(
    BOARD_COLUMNS.map(col => {
      let colTasks = tasks.filter(t => t.status === col.id)
      if (col.id === 'done') colTasks = colTasks.filter(isCompletedToday)
      // Overdue tasks live in the alert strip, not in To-do/Waiting columns…
      // except in_progress: actively-worked tasks stay visible on the board.
      if (col.id === 'open' || col.id === 'waiting') colTasks = colTasks.filter(t => !isOverdue(t))
      return [col.id, sortTasks(colTasks)]
    })
  ) as Record<BoardStatus, Task[]>

  function handleDrop(e: React.DragEvent<HTMLDivElement>, colId: BoardStatus) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    setDragOverCol(null)
    setDraggingId(null)
    if (taskId) onStatusChange(taskId, colId)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-2 lg:gap-3 lg:h-full lg:min-h-0">
      {BOARD_COLUMNS.map(col => {
        const colTasks     = columnTasks[col.id]
        const isDropTarget = dragOverCol === col.id
        const isDoneCol    = col.id === 'done'
        const collapsed    = !!mobileCollapsed[col.id]

        return (
          <div
            key={col.id}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col.id) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null) }}
            onDrop={e => handleDrop(e, col.id)}
            className={[
              'rounded-2xl border flex flex-col lg:flex-1 lg:min-w-0 lg:min-h-0 transition-colors',
              isDropTarget ? 'border-transparent' : 'border-ink-200 bg-cream-50/70',
            ].join(' ')}
            style={isDropTarget ? { backgroundColor: col.color + '14', outline: `2px dashed ${col.color}`, outlineOffset: '-2px' } : undefined}
          >
            {/* Column header — tap collapses on mobile only */}
            <button
              type="button"
              onClick={() => setMobileCollapsed(prev => ({ ...prev, [col.id]: !prev[col.id] }))}
              className="flex items-center justify-between px-3 py-2 min-h-[44px] lg:cursor-default"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-600">{col.label}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: col.color }}>
                  {colTasks.length}
                </span>
              </div>
              <span className="text-ink-300 text-[10px] lg:hidden">{collapsed ? '▶' : '▼'}</span>
            </button>

            {/* Column body — independent scroll on desktop */}
            <div className={[
              collapsed ? 'hidden lg:flex' : 'flex',
              'flex-col gap-1.5 px-2 pb-2 lg:flex-1 lg:min-h-0 lg:overflow-y-auto',
            ].join(' ')}>
              {colTasks.length === 0 && (
                <p className="text-[11px] text-ink-300 py-1.5 pl-1">
                  {isDoneCol ? 'Nothing completed today' : isDropTarget ? 'Drop here' : 'No tasks'}
                </p>
              )}
              {colTasks.map(task => (
                <WorkTaskCard
                  key={task.id}
                  task={task}
                  accentColor={col.color}
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
              {!isDoneCol && (
                <button
                  onClick={onAddTask}
                  className="min-h-[44px] lg:min-h-[36px] flex items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300 text-[11px] text-ink-400 hover:border-accent-400 hover:text-accent-500 hover:bg-accent-50 transition-colors"
                >
                  + Add
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
