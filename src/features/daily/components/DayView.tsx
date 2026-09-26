import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { useDayData } from '../hooks/useDayData'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, ToneDot, TonePill, cx } from '../../../shared/ui'
import { completedWithinLast24h } from '../../todo/taskRules'
import { useOpenWishes } from '../../wishes/hooks/useWishes'
import { wishPeriodLabel } from '../../wishes/wishRules'
import type { WishItem } from '../../wishes/types'
import type { Task } from '../../todo/types'

interface Props { date: Date }

// Resurfacing row for wishes whose reminder period is open RIGHT NOW — the one
// thing that keeps a July-written "go to the hytte this winter" from being
// invisible until the user goes looking for it in December.
//
// Why HERE and nowhere else (verified in DailyPage.tsx's DaySection): the day
// band stacks WeekStrip → DayAgenda → DayView, so at 393px this pane is about
// one screenful down, while the glance board (TodaySummary) sits below the whole
// band and DayQuickRail is `hidden xl:flex` — neither is a phone surface. Do not
// "tidy" this into either of them.
//
// Deliberately quieter than the "N open" pill beside the Tasks heading: a wish
// is a nudge, the day's tasks are the work.
function OpenWishesRow({ wishes }: { wishes: WishItem[] }) {
  if (wishes.length === 0) return null

  const labels = [...new Set(wishes.map(wishPeriodLabel).filter((l): l is string => !!l))]
  // Several periods can be open at once (a season plus a hand-picked range), so
  // name the first and admit to the rest instead of silently showing one.
  const lead = labels.length === 0 ? 'Open now'
    : labels.length === 1 ? labels[0]
    : `${labels[0]} +${labels.length - 1} more`

  return (
    <Link
      to="/wishes"
      className="mb-3 flex min-h-[44px] items-center gap-2 rounded-row border border-line bg-surface-2 px-3 text-body text-fg-2 transition-colors duration-150 hover:bg-surface-hover"
    >
      <ToneDot tone="highlight" />
      <span className="truncate">{lead}</span>
      <span className="text-fg-faint" aria-hidden>·</span>
      <span className="shrink-0 tabular-nums text-fg-muted">
        {wishes.length} {wishes.length === 1 ? 'thing' : 'things'}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </Link>
  )
}

// Renders as a chrome-less pane inside Daily's hero surface (the hero owns
// the card border + accent bar). The undated "this week" tasks moved here
// from the old WeekWidget column so nothing was lost in the consolidation.
export function DayView({ date }: Props) {
  const { tasks, isLoading, section } = useDayData(date)
  const { data: openWishes = [] } = useOpenWishes()
  const modal = useEntityModal()
  const [showWeek, setShowWeek] = useState(false)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const { data: weekTasks = [] } = useTasksByWeek(weekStart, endOfWeek(weekStart, { weekStartsOn: 1 }))
  const floating = weekTasks.filter(
    (t): t is Task => !t.due_date && t.status !== 'done' && t.status !== 'cancelled',
  )

  const openTasks      = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks      = tasks.filter(t => t.status === 'done' && completedWithinLast24h(t.updated_at))
  // A cancelled task stays visible (same 24h window as Done) so it doesn't
  // look identical to a silent delete; counts elsewhere still exclude it.
  const cancelledTasks = tasks.filter(t => t.status === 'cancelled' && completedWithinLast24h(t.updated_at))

  const addTask = () => {
    const day = format(date, 'yyyy-MM-dd')
    modal.open({ kind: 'task', config: { heading: 'New task' }, defaults: { section, date: day, dueDate: day } })
  }

  return (
    <div className="p-4 sm:p-5">
      <OpenWishesRow wishes={openWishes} />

      <div className="mb-2 flex min-h-[28px] items-center justify-between gap-2">
        <h2 className="section-label">Tasks</h2>
        <div className="flex items-center gap-2">
          {doneTasks.length > 0 && <span className="text-meta tabular-nums text-fg-muted">{doneTasks.length} done</span>}
          {openTasks.length > 0 && <TonePill tone="accent">{openTasks.length} open</TonePill>}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" rounded="rounded-row" />)}
        </div>
      ) : (
        <div>
          {openTasks.length === 0 && doneTasks.length === 0 && (
            <p className="py-3 text-body text-fg-muted">No tasks for this day.</p>
          )}
          {openTasks.length === 0 && doneTasks.length > 0 && (
            <p className="flex items-center gap-2 py-3 text-body font-medium text-fg-2">
              <ToneDot tone="success" /> All done
            </p>
          )}

          {openTasks.map(task => <ToDoItem key={task.id} task={task} />)}

          <button
            type="button"
            onClick={addTask}
            className="mt-1 flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 text-left text-body font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-accent-600"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add task
          </button>

          <TaskGroup label="Done" tasks={doneTasks} />
          <TaskGroup label="Cancelled" tasks={cancelledTasks} />
        </div>
      )}

      {/* Undated this-week tasks (relocated from the old WeekWidget column) */}
      {floating.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setShowWeek(s => !s)}
            aria-expanded={showWeek}
            className="flex min-h-[44px] w-full items-center justify-between rounded-row text-left"
          >
            <span className="section-label">This week — no date</span>
            <span className="flex items-center gap-1 text-meta tabular-nums text-fg-muted">
              {floating.length}
              <ChevronDown className={cx('h-4 w-4 transition-transform duration-150', showWeek && 'rotate-180')} aria-hidden />
            </span>
          </button>
          {showWeek && (
            <div className="mt-1">
              {floating.slice(0, 6).map(t => <ToDoItem key={t.id} task={t} />)}
              {floating.length > 6 && <p className="mt-1 text-meta text-fg-muted">+{floating.length - 6} more</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TaskGroup({ label, tasks }: { label: string; tasks: Task[] }) {
  if (tasks.length === 0) return null
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="section-label mb-1 px-3">{label}</p>
      <div className="opacity-60">
        {tasks.map(task => <ToDoItem key={task.id} task={task} />)}
      </div>
    </div>
  )
}
