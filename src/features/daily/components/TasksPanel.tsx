import { useMemo } from 'react'
import { useAllTasks } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { completedWithinLast24h } from '../../todo/taskRules'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { EmptyState } from '../../../shared/components/EmptyState'
import type { Task } from '../../todo/types'

// Aggregated "all my tasks" view for the Daily page (dev request "Tasks":
// tasklarımı göremiyorum artık — geçmiş/açık/ilerideki tasklarımı güzel bir UI
// ile göster). Groups every active task by due date; ToDoItem already carries
// the complete checkbox + Cancel (≠ delete) actions.

function Section({ title, tasks, tone }: { title: string; tasks: Task[]; tone: string }) {
  if (tasks.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-1.5 flex items-center gap-1.5 ${tone}`}>
        {title}
        <span className="text-ink-500 tabular-nums font-normal">{tasks.length}</span>
      </h3>
      <div className="flex flex-col gap-1">
        {tasks.map(t => <ToDoItem key={t.id} task={t} />)}
      </div>
    </div>
  )
}

export function TasksPanel() {
  const { data: tasks = [], isLoading } = useAllTasks()
  const today = formatLocalDate(new Date())

  const g = useMemo(() => {
    const active = tasks.filter(t => t.status !== 'done')
    // A live window: start_date has arrived and due_date is still ahead. The
    // last day of a window is deliberately NOT here — on due_date the deadline
    // is what matters, so it belongs in Today, and Open now only ever takes
    // rows away from Upcoming (nothing renders twice).
    //
    // Computed off useAllTasks' existing select('*'), so it needs no query and
    // no column name in any select list: before migration 069 start_date simply
    // reads undefined and this group stays empty.
    const openNow = (t: Task) =>
      !!t.start_date && !!t.due_date && t.start_date <= today && t.due_date > today
    // yyyy-mm-dd strings compare lexicographically, so a plain string compare
    // is a correct date compare here (no timezone parsing needed).
    return {
      overdue:  active.filter(t => t.due_date && t.due_date < today),
      openNow:  active.filter(openNow),
      today:    active.filter(t => t.due_date === today),
      upcoming: active.filter(t => t.due_date && t.due_date > today && !openNow(t)),
      noDate:   active.filter(t => !t.due_date),
      done:     tasks.filter(t => t.status === 'done' && completedWithinLast24h(t.updated_at)),
    }
  }, [tasks, today])

  if (isLoading) {
    return (
      <div className="max-w-2xl flex flex-col gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-cream-200 animate-pulse" />)}
      </div>
    )
  }

  const empty = g.overdue.length + g.openNow.length + g.today.length
    + g.upcoming.length + g.noDate.length + g.done.length === 0
  if (empty) {
    return <EmptyState icon="✅" title="No tasks" description="You're all caught up — new tasks show up here across every day." />
  }

  return (
    <div className="max-w-2xl stagger-in">
      <Section title="⚠ Overdue"   tasks={g.overdue}  tone="text-red-500" />
      <Section title="Open now"     tasks={g.openNow}  tone="text-ink-600" />
      <Section title="Today"        tasks={g.today}    tone="text-accent-600" />
      <Section title="Upcoming"     tasks={g.upcoming} tone="text-ink-500" />
      <Section title="No date"      tasks={g.noDate}   tone="text-ink-500" />
      <Section title="Recently done" tasks={g.done}    tone="text-green-600" />
    </div>
  )
}
