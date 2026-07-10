import { useState } from 'react'
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core'
import type { Task, TaskStatus } from '../../todo/types'
import WorkTaskCard from './WorkTaskCard'
import { BOARD_COLUMNS, isCompletedToday, isOverdue, sortTasks, type BoardStatus, type StatusMeta } from './workMeta'

interface BoardColumnProps {
  col: StatusMeta
  colTasks: Task[]
  isDropTarget: boolean
  collapsed: boolean
  focusedTaskIds: string[]
  draggingId: string | null
  onToggleCollapse: () => void
  onStatusChange: (id: string, status: TaskStatus, waitingFor?: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
  onAddTask: () => void
}

// Split out so useDroppable (a hook) isn't called inside BOARD_COLUMNS.map's
// callback in the parent — hooks can only run at a component's top level.
function BoardColumn({
  col, colTasks, isDropTarget, collapsed, focusedTaskIds, draggingId,
  onToggleCollapse, onStatusChange, onDelete, onEdit, onFocus, onAddTask,
}: BoardColumnProps) {
  const isDoneCol = col.id === 'done'
  const { setNodeRef } = useDroppable({ id: col.id })

  return (
    <div
      ref={setNodeRef}
      className={[
        'rounded-2xl border flex flex-col lg:flex-1 lg:min-w-0 lg:min-h-0 transition-colors',
        isDropTarget ? 'border-transparent' : 'border-ink-200 bg-cream-50/70',
      ].join(' ')}
      style={isDropTarget ? { backgroundColor: col.color + '14', outline: `2px dashed ${col.color}`, outlineOffset: '-2px' } : undefined}
    >
      {/* Column header — tap collapses on mobile only */}
      <button
        type="button"
        onClick={onToggleCollapse}
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
}

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

  // dnd-kit (not native HTML5 draggable) — native drag-and-drop never fires
  // on touch at all, so column-to-column drag was desktop-only in practice.
  // A short tap still opens the edit modal normally since PointerSensor's
  // distance constraint only arms a drag once the pointer actually moves.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

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

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
  }

  function handleDragOver(e: DragOverEvent) {
    setDragOverCol((e.over?.id as BoardStatus) ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setDraggingId(null)
    setDragOverCol(null)
    if (over) onStatusChange(String(active.id), over.id as BoardStatus)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setDraggingId(null); setDragOverCol(null) }}
    >
      <div className="flex flex-col lg:flex-row gap-2 lg:gap-3 lg:h-full lg:min-h-0">
        {BOARD_COLUMNS.map(col => (
          <BoardColumn
            key={col.id}
            col={col}
            colTasks={columnTasks[col.id]}
            isDropTarget={dragOverCol === col.id}
            collapsed={!!mobileCollapsed[col.id]}
            focusedTaskIds={focusedTaskIds}
            draggingId={draggingId}
            onToggleCollapse={() => setMobileCollapsed(prev => ({ ...prev, [col.id]: !prev[col.id] }))}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onEdit={onEdit}
            onFocus={onFocus}
            onAddTask={onAddTask}
          />
        ))}
      </div>
    </DndContext>
  )
}
