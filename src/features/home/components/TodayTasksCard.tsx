import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ListTodo, Plus } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, IconButton, Skeleton } from '../../../shared/ui'
import { useDayTasks } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { useSaveItem } from '../../items/useItems'
import { parseQuickAdd } from '../../items/quickAdd'
import { itemFromQuickAdd } from '../../items/sheetRules'
import { ReadAsLine } from '../../items/components/ReadAsLine'
import { useCalendarStore } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useNewIds } from '../../../shared/hooks/useNewIds'

const SHOWN = 5

/**
 * Today's open tasks with the full row behaviour (toggle, cancel, swipe to
 * delete; tapping opens the shared task popup) plus a quick add that reads
 * "Gym 17:30 1h every Mon Wed Fri" like the Add sheet's title (quickAdd.ts),
 * says what it read and saves through the one item save. The same day list
 * as Daily (useDayTasks): open ones overdue first, done = closed today,
 * cancelled never counts.
 */
export function TodayTasksCard() {
  const today = todayStr()
  const { open, counts, isLoading, isError, refetch } = useDayTasks(today)
  const save = useSaveItem()
  const googleConnected = !!useCalendarStore(s => s.accessToken)
  const [title, setTitle] = useState('')
  const [keepText, setKeepText] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const parse = keepText ? null : parseQuickAdd(title, today)

  const done = counts.done
  const total = counts.open + counts.done
  const progress = total ? (done / total) * 100 : 0
  const fresh = useNewIds(open.map(t => t.id), 'today', !isLoading)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = itemFromQuickAdd(title, parse, today, googleConnected)
    if (!input) return
    setTitle('')
    setKeepText(false)
    // The hook says the result (and any error); the new row appears via invalidation.
    save.mutate(input)
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

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); if (!e.target.value.trim()) setKeepText(false) }}
            placeholder="Add for today — e.g. Gym 17:30 1h"
            aria-label="New item"
            autoComplete="off"
            className="input min-w-0 flex-1"
          />
          <IconButton type="submit" label="Add" bordered disabled={!(parse ? parse.title : title).trim() || save.isPending}>
            <Plus />
          </IconButton>
        </div>
        {parse && <ReadAsLine parse={parse} start={today} onKeepText={() => setKeepText(true)} />}
      </form>
    </Card>
  )
}
