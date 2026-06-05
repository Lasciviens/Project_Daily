import { useState } from 'react'
import { addDays, format, isToday, startOfWeek } from 'date-fns'
import { useWorkTasks, useToggleTask, useDeleteTask, useSwapTaskOrder } from '../../todo/hooks/useTodos'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'
import type { Task, TaskSection } from '../../todo/types'

const SECTIONS: { id: TaskSection; label: string; defaultOpen: boolean }[] = [
  { id: 'inbox',     label: 'Inbox',     defaultOpen: true  },
  { id: 'today',     label: 'Today',     defaultOpen: true  },
  { id: 'this_week', label: 'This Week', defaultOpen: true  },
  { id: 'backlog',   label: 'Backlog',   defaultOpen: false },
]

const PRIORITY_DOT: Record<Task['priority'], string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-red-400 ring-1 ring-red-300',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function WorkPage() {
  const [modal,        setModal]        = useState<TaskSection | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const { data: tasks = [], isLoading } = useWorkTasks()

  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const highPrio  = openTasks.filter(t => t.priority === 'high').length
  const dueToday  = openTasks.filter(t => t.due_date === format(new Date(), 'yyyy-MM-dd')).length

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')
  const isSelectedToday = isToday(selectedDate)

  // Work tasks due on the selected date (only shown when not today)
  const tasksForSelectedDate = !isSelectedToday
    ? tasks.filter(t => t.due_date === selectedDateStr && (t.status === 'open' || t.status === 'in_progress'))
    : []

  // Week row: Mon–Sun of the current week
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="max-w-screen-lg mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Work</h1>
          <p className="text-sm text-ink-400 mt-0.5">Task board for work items</p>
        </div>
        <button
          onClick={() => setModal('inbox')}
          className="btn-primary flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Add task
        </button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setSelectedDate(d => addDays(d, -1))}
          className="w-7 h-7 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors duration-150"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-ink-800 min-w-[140px] text-center">
          {isSelectedToday ? 'Today' : format(selectedDate, 'EEEE, MMM d')}
        </span>
        <button
          onClick={() => setSelectedDate(d => addDays(d, 1))}
          className="w-7 h-7 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors duration-150"
        >
          ›
        </button>
        {!isSelectedToday && (
          <button
            onClick={() => setSelectedDate(new Date())}
            className="text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors duration-150 ml-1"
          >
            Today
          </button>
        )}
      </div>

      {/* Mini work week calendar */}
      <div className="flex items-center gap-1 mb-6 p-3 card">
        {weekDays.map((day, i) => {
          const dayStr    = format(day, 'yyyy-MM-dd')
          const hasTasks  = tasks.some(t => t.due_date === dayStr && (t.status === 'open' || t.status === 'in_progress'))
          const isSelected = dayStr === selectedDateStr
          const isTodayDay = isToday(day)
          return (
            <button
              key={dayStr}
              onClick={() => setSelectedDate(day)}
              className={`flex-1 flex flex-col items-center py-1.5 rounded-lg transition-colors duration-150 ${
                isSelected
                  ? 'bg-accent-500 text-white'
                  : isTodayDay
                  ? 'bg-accent-50 text-accent-700 hover:bg-accent-100'
                  : 'hover:bg-ink-100 text-ink-600'
              }`}
            >
              <span className="text-[10px] font-medium">{DAY_LABELS[i]}</span>
              <span className={`text-xs font-semibold mt-0.5 ${isSelected ? 'text-white' : isTodayDay ? 'text-accent-700' : 'text-ink-800'}`}>
                {format(day, 'd')}
              </span>
              <span className={`w-1 h-1 rounded-full mt-1 ${hasTasks ? (isSelected ? 'bg-white' : 'bg-accent-400') : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      {/* Tasks for selected date (only when not today) */}
      {!isSelectedToday && (
        <div className="mb-6 card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-ink-100">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Work tasks for {format(selectedDate, 'MMMM d')}
            </span>
            {tasksForSelectedDate.length > 0 && (
              <span className="ml-2 text-[10px] bg-accent-50 text-accent-600 font-semibold px-1.5 py-0.5 rounded-full">
                {tasksForSelectedDate.length}
              </span>
            )}
          </div>
          <div className="p-2">
            {tasksForSelectedDate.length === 0 ? (
              <p className="text-sm text-ink-300 text-center py-4">No work tasks due on this date</p>
            ) : (
              tasksForSelectedDate.map(task => (
                <DateTaskRow key={task.id} task={task} />
              ))
            )}
          </div>
        </div>
      )}

      {/* Stats strip */}
      {!isLoading && (
        <div className="flex items-center gap-4 mb-6 p-4 card">
          <Stat label="Open" value={openTasks.length} color="text-ink-800" />
          <div className="w-px h-8 bg-ink-100" />
          <Stat label="Done" value={doneTasks.length} color="text-green-600" />
          <div className="w-px h-8 bg-ink-100" />
          <Stat label="High priority" value={highPrio} color={highPrio > 0 ? 'text-red-500' : 'text-ink-400'} />
          <div className="w-px h-8 bg-ink-100" />
          <Stat label="Due today" value={dueToday} color={dueToday > 0 ? 'text-accent-600' : 'text-ink-400'} />
        </div>
      )}

      {/* Sections */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-5">
              <div className="h-4 w-24 bg-cream-200 rounded animate-pulse mb-4" />
              <div className="space-y-3">
                {[1, 2].map(j => <div key={j} className="h-8 bg-cream-200 rounded-lg animate-pulse" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map(s => {
            const sectionTasks = tasks.filter(t => t.section === s.id)
            return (
              <WorkSection
                key={s.id}
                section={s.id}
                label={s.label}
                tasks={sectionTasks}
                defaultOpen={s.defaultOpen}
                onAdd={() => setModal(s.id)}
              />
            )
          })}
        </div>
      )}

      <AddTaskModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        defaultSection={modal ?? 'inbox'}
        defaultDomain="work"
      />
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-ink-400 mt-0.5">{label}</p>
    </div>
  )
}

function DateTaskRow({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />
      <span className="text-sm text-ink-800 truncate">{task.title}</span>
      <span className="ml-auto text-[10px] text-ink-400 flex-shrink-0 capitalize">{task.section.replace('_', ' ')}</span>
    </div>
  )
}

function WorkSection({
  label, tasks, defaultOpen, onAdd,
}: {
  section: TaskSection
  label: string
  tasks: Task[]
  defaultOpen: boolean
  onAdd: () => void
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const toggle = useToggleTask()
  const remove = useDeleteTask()
  const swap   = useSwapTaskOrder()

  const openTasks = [...tasks.filter(t => t.status === 'open' || t.status === 'in_progress')]
    .sort((a, b) => a.sort_order - b.sort_order)
  const doneTasks = tasks.filter(t => t.status === 'done')

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setIsOpen(p => !p)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-cream-50 transition-colors duration-150 border-b border-ink-100"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</span>
          {openTasks.length > 0 && (
            <span className="text-[10px] bg-accent-50 text-accent-600 font-semibold px-1.5 py-0.5 rounded-full">
              {openTasks.length}
            </span>
          )}
        </div>
        <span className={`text-ink-300 text-sm transition-transform duration-150 inline-block ${isOpen ? 'rotate-90' : ''}`}>›</span>
      </button>

      {isOpen && (
        <div className="p-2">
          {openTasks.length === 0 && doneTasks.length === 0 && (
            <p className="text-sm text-ink-300 text-center py-4">No tasks here</p>
          )}

          {openTasks.map((task, idx) => (
            <WorkTaskRow
              key={task.id}
              task={task}
              canMoveUp={idx > 0}
              canMoveDown={idx < openTasks.length - 1}
              onMoveUp={() => swap.mutate({ id1: task.id, id2: openTasks[idx - 1].id })}
              onMoveDown={() => swap.mutate({ id1: task.id, id2: openTasks[idx + 1].id })}
              onToggle={() => toggle.mutate({ id: task.id, isDone: true })}
              onDelete={() => remove.mutate(task.id)}
            />
          ))}

          <button
            onClick={onAdd}
            className="w-full text-left px-3 py-2 text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 flex items-center gap-1"
          >
            <span className="text-base leading-none">+</span> Add task
          </button>

          {doneTasks.length > 0 && (
            <div className="mt-1 pt-2 border-t border-ink-100 opacity-50">
              {doneTasks.map(task => (
                <WorkTaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggle.mutate({ id: task.id, isDone: false })}
                  onDelete={() => remove.mutate(task.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WorkTaskRow({
  task, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onToggle, onDelete,
}: {
  task: Task
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const [hovered,  setHovered]  = useState(false)
  const [editing,  setEditing]  = useState(false)
  const isDone = task.status === 'done'

  return (
    <>
      <div
        className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors duration-150 ${hovered ? 'bg-cream-100' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          onClick={onToggle}
          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
            isDone ? 'bg-accent-500 border-accent-500 text-white' : 'border-ink-300 hover:border-accent-400'
          }`}
        >
          {isDone && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority]}`} />

        <div className="flex-1 min-w-0">
          <span className={`text-sm leading-snug truncate block ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}>
            {task.title}
          </span>
          {task.due_date && !isDone && (
            <span className="text-[10px] text-ink-400">
              {format(new Date(task.due_date + 'T00:00:00'), 'MMM d')}
            </span>
          )}
        </div>

        {hovered && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {onMoveUp && (
              <button onClick={onMoveUp} disabled={!canMoveUp}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              >↑</button>
            )}
            {onMoveDown && (
              <button onClick={onMoveDown} disabled={!canMoveDown}
                className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-ink-600 disabled:opacity-20 transition-colors duration-150 text-xs"
              >↓</button>
            )}
            <button onClick={() => setEditing(true)}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-accent-500 transition-colors duration-150 text-[11px]"
              title="Edit"
            >✎</button>
            <button onClick={onDelete}
              className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
            >✕</button>
          </div>
        )}
      </div>

      <AddTaskModal isOpen={editing} onClose={() => setEditing(false)} task={task} />
    </>
  )
}
