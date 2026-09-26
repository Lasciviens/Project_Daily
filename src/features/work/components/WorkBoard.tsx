import { useState } from 'react'
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core'
import type { Task, TaskStatus } from '../../todo/types'
import { ChevronDown, Plus } from 'lucide-react'
import { cx } from '../../../shared/ui'
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
      data-tone={col.tone}
      className={cx(
        'flex min-w-0 flex-col rounded-card border transition-colors',
        isDropTarget
          ? 'border-dashed border-[rgb(var(--tone))] bg-[rgb(var(--tone-soft))]'
          : 'border-line bg-surface-2/60',
      )}
    >
      {/* Column header — tap collapses on phones only */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2 lg:cursor-default"
      >
        <span className="flex items-center gap-2">
          <span className="tone-dot" aria-hidden />
          <span className="section-label">{col.label}</span>
          <span className="count-badge">{colTasks.length}</span>
        </span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-faint transition-transform lg:hidden', collapsed && '-rotate-90')} />
      </button>

      {/* Column body — capped with its own scroll from lg, so a long column
          never pushes the other three off screen. */}
      <div className={cx(
        collapsed ? 'hidden lg:flex' : 'flex',
        'flex-col gap-2 px-2 pb-2 lg:max-h-[max(24rem,calc(100dvh-22rem))] lg:overflow-y-auto',
      )}>
        {colTasks.length === 0 && (
          <p className="py-1.5 pl-1 text-meta text-fg-faint">
            {isDoneCol ? 'Nothing completed today' : isDropTarget ? 'Drop here' : 'No tasks'}
          </p>
        )}
        {colTasks.map(task => (
          <WorkTaskCard
            key={task.id}
            task={task}
            accentTone={col.tone}
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
            type="button"
            onClick={onAddTask}
            className="flex min-h-[44px] items-center justify-center gap-1 rounded-row border border-dashed border-line-strong text-meta font-medium text-fg-muted transition-colors lg:min-h-[36px] [@media(hover:hover)]:hover:border-accent-500 [@media(hover:hover)]:hover:bg-accent-50 [@media(hover:hover)]:hover:text-accent-600"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" /> Add task
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
      {/* Explicit 4-column kanban from lg, each column capped so cards keep a
          readable width on a wide monitor; stacked sections below lg. */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[repeat(4,minmax(0,22rem))] lg:items-start lg:gap-3">
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
