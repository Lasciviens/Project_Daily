import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ListTodo, Plus } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, IconButton, Skeleton } from '../../../shared/ui'
import { useDayTasks, useCreateTask } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useNewIds } from '../../../shared/hooks/useNewIds'

const SHOWN = 5

/**
 * Today's open tasks with the full row behaviour (toggle, cancel, swipe to
 * delete; tapping opens the shared task popup) plus a quick-add. The same day
 * list as Daily (useDayTasks): open ones overdue first, done = closed today,
 * cancelled never counts.
 */
export function TodayTasksCard() {
  const { open, counts, isLoading, isError, refetch } = useDayTasks(todayStr())
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [showAll, setShowAll] = useState(false)

  const done = counts.done
  const total = counts.open + counts.done
  const progress = total ? (done / total) * 100 : 0
  const fresh = useNewIds(open.map(t => t.id), 'today', !isLoading)

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
        subtitle={total ? `${done} of ${total} done` : undefined}
        action={<Link to="/daily" className="inline-flex min-h-[44px] items-center px-1 text-meta font-semibold text-accent-600">Open Daily</Link>}
      />

      {total > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Tasks done today">
          <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-11 w-full" rounded="rounded-row" />)}</div>
      ) : isError ? (
        // A failed read must never look like "Nothing on the list".
        <p className="flex flex-wrap items-center gap-2 py-3 text-body text-fg-muted">
          Couldn't load today's tasks.
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>Try again</Button>
        </p>
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
            {(showAll ? open : open.slice(0, SHOWN)).map(t => <ToDoItem key={t.id} task={t} isNew={fresh.has(t.id)} />)}
          </div>
        </div>
      )}
      {!showAll && open.length > SHOWN && (
        // Shows the rest here; Home never jumps to Daily on its own.
        <button type="button" onClick={() => setShowAll(true)} className="mt-1 inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
          {open.length - SHOWN} more open
        </button>
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
