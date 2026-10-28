import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, MoreHorizontal, RotateCcw, Trash2, Zap } from 'lucide-react'
import type { Task, TaskStatus } from '../../todo/types'
import { EmptyState, TonePill, cx, Truncate } from '../../../shared/ui'
import { STATUS_CYCLE, isOverdue, taskStatusMeta } from './workMeta'
import { closedOn, isOpenTask } from '../../todo/taskRules'
import { todayStr } from '../../../shared/utils/dateUtils'
import { DueChip, PriorityMark, WaitingChip } from './WorkTaskBits'

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

const ACTION = 'grid place-items-center rounded-control min-h-[44px] min-w-[44px] md:min-h-[28px] md:min-w-[28px] transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5'

// Dense triage view: one row per task, overdue first, then by activity/priority.
// Click the status dot to cycle status; click the row to edit.
export default function WorkListView({
  tasks, focusedTaskIds, onStatusChange, onDelete, onEdit, onFocus,
}: Props) {
  const today = todayStr()
  const rows = tasks
    .filter(t => t.status !== 'done' || closedOn(t, today))
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
    return <EmptyState bordered title="No tasks match" description="Clear the search or priority filter to see everything." className="max-w-xl" />
  }

  return (
    <ul className="card max-w-5xl divide-y divide-line overflow-hidden">
      {rows.map(task => {
        const isDone  = task.status === 'done'
        const meta    = taskStatusMeta(task)
        const focused = focusedTaskIds.includes(task.id)

        return (
          <li
            key={task.id}
            onClick={() => onEdit(task)}
            className="group flex min-h-[48px] cursor-pointer items-center gap-2.5 px-2 py-1 transition-colors sm:px-3 [@media(hover:hover)]:hover:bg-surface-hover"
          >
            {/* Status cycle button */}
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                const idx  = STATUS_CYCLE.indexOf(task.status)
                const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
                onStatusChange(task.id, next)
              }}
              aria-label={`${meta.label} — advance status`}
              title={`${meta.label} — click to advance`}
              className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center md:min-h-[28px] md:min-w-[28px]"
            >
              <span
                data-tone={meta.tone}
                className={cx('block h-3 w-3 rounded-full border-2 border-[rgb(var(--tone))]', isDone && 'bg-[rgb(var(--tone))]')}
              />
            </button>

            <PriorityMark task={task} />

            <Truncate fullText={task.title} className={cx('flex-1 text-body', isDone ? 'text-fg-faint line-through' : 'text-fg')}>
              {focused && <Zap aria-label="Focused" className="-mt-0.5 mr-1 inline h-3.5 w-3.5 fill-current text-accent-600" />}
              {task.title}
            </Truncate>

            {task.status === 'waiting' && task.waiting_for && (
              <WaitingChip text={task.waiting_for} className="hidden sm:inline-flex" />
            )}

            <TonePill tone={meta.tone} className="hidden shrink-0 md:inline-flex">{meta.label}</TonePill>

            <DueChip task={task} />

            <WorkRowActions task={task} focused={focused} onStatusChange={onStatusChange} onFocus={onFocus} onDelete={onDelete} />
          </li>
        )
      })}
    </ul>
  )
}

interface RowActionProps {
  task: Task
  focused: boolean
  onStatusChange: (id: string, status: TaskStatus) => void
  onFocus: (task: Task) => void
  onDelete: (id: string) => void
}

// Done, Focus and Delete. On a phone, and on any touch screen, they sit in one
// ⋯ menu so the title keeps the row's width; from `md` with a mouse they are a
// button row, revealed on hover.
function WorkRowActions({ task, focused, onStatusChange, onFocus, onDelete }: RowActionProps) {
  const isDone = task.status === 'done'
  const toggleDone = () => onStatusChange(task.id, isDone ? 'open' : 'done')
  return (
    <div className="flex shrink-0 items-center" onClick={e => e.stopPropagation()}>
      <Menu>
        <MenuButton
          aria-label="More actions"
          className={cx(ACTION, 'text-fg-faint data-[open]:bg-surface-hover data-[open]:text-fg md:[@media(hover:hover)]:hidden')}
        >
          <MoreHorizontal />
        </MenuButton>
        <MenuItems
          anchor="bottom end"
          transition
          className="menu min-w-[10rem] [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0"
        >
          <MenuItem>
            <button type="button" onClick={toggleDone} className="menu-item">
              {isDone ? <RotateCcw aria-hidden className="h-4 w-4" /> : <Check aria-hidden className="h-4 w-4" />}
              {isDone ? 'Reopen' : 'Mark done'}
            </button>
          </MenuItem>
          {isOpenTask(task) && (
            <MenuItem>
              <button type="button" onClick={() => onFocus(task)} className="menu-item">
                <Zap aria-hidden className="h-4 w-4" /> {focused ? 'Remove focus' : 'Focus'}
              </button>
            </MenuItem>
          )}
          <div className="menu-sep" />
          <MenuItem>
            <button type="button" onClick={() => onDelete(task.id)} className="menu-item is-danger">
              <Trash2 aria-hidden className="h-4 w-4" /> Delete
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>

      <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:[@media(hover:hover)]:flex">
        <button
          type="button"
          onClick={toggleDone}
          aria-label={isDone ? 'Reopen' : 'Mark done'}
          title={isDone ? 'Reopen' : 'Mark done'}
          data-tone="success"
          className={cx(ACTION, 'tone-text [@media(hover:hover)]:hover:bg-success-soft')}
        >
          {isDone ? <RotateCcw /> : <Check />}
        </button>
        {isOpenTask(task) && <button
          type="button"
          onClick={() => onFocus(task)}
          aria-label={focused ? 'Remove focus' : 'Focus'}
          aria-pressed={focused}
          title={focused ? 'Remove focus' : 'Focus'}
          className={cx(ACTION, focused ? 'bg-accent-50 text-accent-600' : 'text-fg-faint [@media(hover:hover)]:hover:bg-surface-hover')}
        >
          <Zap />
        </button>}
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete"
          title="Delete"
          className={cx(ACTION, 'text-fg-faint [@media(hover:hover)]:hover:bg-danger-soft [@media(hover:hover)]:hover:text-danger')}
        >
          <Trash2 />
        </button>
      </div>
    </div>
  )
}
