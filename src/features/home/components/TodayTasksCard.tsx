import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ListTodo, Plus } from 'lucide-react'
import { Card, CardHeader, EmptyState, IconButton, Skeleton } from '../../../shared/ui'
import { useTasksForDay, useCreateTask } from '../../todo/hooks/useTodos'
import { closedOn, isOverdue } from '../../todo/taskRules'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useNewIds } from '../../../shared/hooks/useNewIds'

const SHOWN = 5

/**
 * Today's open tasks with the full row behaviour (toggle, cancel, swipe to
 * delete; tapping opens the shared task popup) plus a quick-add. Uses the
 * same day query as Daily; cancelled never counts, done only when it was closed
 * today (completed_at — not updated_at, which any sync or reorder moves).
 */
export function TodayTasksCard() {
  const { data = [], isLoading } = useTasksForDay(new Date(), 'today')
  const create = useCreateTask()
  const [title, setTitle] = useState('')

  const countable = data.filter(t => t.status !== 'cancelled' && (t.status !== 'done' || closedOn(t, todayStr())))
  const done = countable.filter(t => t.status === 'done').length
  const open = countable
    .filter(t => t.status !== 'done')
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)))
  const progress = countable.length ? (done / countable.length) * 100 : 0
  const fresh = useNewIds(data.map(t => t.id), 'today', !isLoading)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) return
    setTitle('')
    // Errors are toasted by the hook; the new row appears via invalidation.
    create.mutate({ title: value, section: 'today', domain: 'personal', priority: 'medium' })
  }

  return (
    <Card>
      <CardHeader
        icon={<ListTodo />}
        title="Today's tasks"
        subtitle={countable.length ? `${done} of ${countable.length} done` : undefined}
        action={<Link to="/daily" className="inline-flex min-h-[44px] items-center px-1 text-meta font-semibold text-accent-600">Open Daily</Link>}
      />

      {countable.length > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={countable.length} aria-valuenow={done} aria-label="Tasks done today">
          <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-11 w-full" rounded="rounded-row" />)}</div>
      ) : open.length === 0 ? (
        <EmptyState
          title={done ? 'All done for today' : 'Nothing on the list'}
          description={done ? `${done} task${done === 1 ? '' : 's'} finished.` : 'Add a task below.'}
          className="py-5"
        />
      ) : (
        // Two columns once the card is wide (a wide Home main track).
        <div className="@container">
          <div className="-mx-3 grid grid-cols-1 gap-x-4 gap-y-0.5 @[44rem]:grid-cols-2">
            {open.slice(0, SHOWN).map(t => <ToDoItem key={t.id} task={t} isNew={fresh.has(t.id)} />)}
          </div>
        </div>
      )}
      {open.length > SHOWN && (
        <Link to="/daily" className="mt-1 inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
          {open.length - SHOWN} more open
        </Link>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Add a task for today"
          aria-label="New task title"
          className="input min-w-0 flex-1"
        />
        <IconButton type="submit" label="Add task" bordered disabled={!title.trim() || create.isPending}>
          <Plus />
        </IconButton>
      </form>
    </Card>
  )
}
