import type { Task, TaskStatus } from '../../todo/types'
import {
  BOARD_COLUMNS, OVERDUE_COLOR, PRIORITY_META, STATUS_CYCLE,
  dueLabel, isCompletedToday, isOverdue,
} from './workMeta'

interface Props {
  tasks: Task[]                 // already search/priority-filtered by the page
  focusedTaskIds: string[]
  onStatusChange: (id: string, status: TaskStatus) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
}

const STATUS_RANK: Record<string, number> = { in_progress: 1, waiting: 2, open: 3, done: 4 }
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function statusMeta(task: Task) {
  if (isOverdue(task)) return { label: 'Overdue', color: OVERDUE_COLOR }
  const col = BOARD_COLUMNS.find(c => c.id === task.status)
  return col ? { label: col.label, color: col.color } : { label: task.status, color: '#94A3B8' }
}

// Dense triage view: one row per task, overdue first, then by activity/priority.
// Click the status dot to cycle status; click the row to edit.
export default function WorkListView({
  tasks, focusedTaskIds, onStatusChange, onDelete, onEdit, onFocus,
}: Props) {
  const rows = tasks
    .filter(t => t.status !== 'done' || isCompletedToday(t))
    .sort((a, b) => {
      const oa = isOverdue(a) ? 0 : 1
      const ob = isOverdue(b) ? 0 : 1
      if (oa !== ob) return oa - ob
      const sa = STATUS_RANK[a.status] ?? 3
      const sb = STATUS_RANK[b.status] ?? 3
      if (sa !== sb) return sa - sb
      const pa = PRIORITY_RANK[a.priority] ?? 1
      const pb = PRIORITY_RANK[b.priority] ?? 1
      if (pa !== pb) return pa - pb
      return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
    })

  if (rows.length === 0) {
    return (
      <div className="text-center py-14 border border-dashed border-ink-200 rounded-2xl text-ink-400 text-sm">
        No tasks match
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white overflow-hidden divide-y divide-ink-50">
      {rows.map(task => {
        const isDone  = task.status === 'done'
        const meta    = statusMeta(task)
        const due     = dueLabel(task)
        const prio    = PRIORITY_META[task.priority]
        const focused = focusedTaskIds.includes(task.id)

        return (
          <div
            key={task.id}
            onClick={() => onEdit(task)}
            className="group flex items-center gap-2.5 px-3 min-h-[48px] py-1.5 cursor-pointer hover:bg-cream-50 transition-colors"
          >
            {/* Status cycle button */}
            <button
              onClick={e => {
                e.stopPropagation()
                const idx  = STATUS_CYCLE.indexOf(task.status)
                const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
                onStatusChange(task.id, next)
              }}
              title={`${meta.label} — click to advance`}
              className="min-w-[44px] min-h-[44px] md:min-w-[24px] md:min-h-[24px] flex items-center justify-center flex-shrink-0"
            >
              <span className="w-3 h-3 rounded-full border-2 block" style={{ borderColor: meta.color, backgroundColor: isDone ? meta.color : 'transparent' }} />
            </button>

            <span className={`text-[10px] leading-none flex-shrink-0 ${prio.cls}`} title={`${prio.label} priority`}>{prio.icon}</span>

            <span className={`text-sm flex-1 min-w-0 truncate ${isDone ? 'line-through text-ink-400' : 'text-ink-800'}`}>
              {focused && <span className="text-accent-500 mr-1">⚡</span>}
              {task.title}
            </span>

            {task.status === 'waiting' && task.waiting_for && (
              <span className="hidden sm:inline text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-full flex-shrink-0 max-w-[140px] truncate">
                ⏳ {task.waiting_for}
              </span>
            )}

            <span
              className="hidden md:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: meta.color + '1A', color: meta.color }}
            >
              {meta.label}
            </span>

            {due && !isDone && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${due.urgent ? 'bg-red-50 text-red-600' : 'bg-ink-100 text-ink-500'}`}>
                {due.text}
              </span>
            )}

            {/* Hover actions */}
            <div
              className="flex items-center gap-0.5 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => onStatusChange(task.id, isDone ? 'open' : 'done')}
                title={isDone ? 'Reopen' : 'Mark done'}
                className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                {isDone ? '↩' : '✓'}
              </button>
              <button
                onClick={() => onFocus(task)}
                title={focused ? 'Remove focus' : 'Focus'}
                className={`min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] transition-colors ${
                  focused ? 'text-accent-500 bg-accent-50' : 'text-ink-400 hover:bg-ink-100'
                }`}
              >
                ⚡
              </button>
              <button
                onClick={() => onDelete(task.id)}
                title="Delete"
                className="min-h-[44px] min-w-[44px] md:min-h-[26px] md:min-w-[26px] flex items-center justify-center rounded-md text-[11px] text-ink-300 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
