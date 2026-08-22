import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { useDayData } from '../hooks/useDayData'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
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
      className="mb-3 flex min-h-[44px] items-center gap-2 rounded-xl border border-accent-100 bg-accent-50/50 px-3 text-sm text-ink-600 transition-colors duration-150 hover:bg-accent-50"
    >
      <span className="truncate">{lead}</span>
      <span className="text-ink-400">·</span>
      <span className="shrink-0 tabular-nums">
        {wishes.length} {wishes.length === 1 ? 'thing' : 'things'}
      </span>
      <span className="ml-auto shrink-0 text-ink-400" aria-hidden>→</span>
    </Link>
  )
}

// Renders as a chrome-less pane inside Daily's hero surface (the hero owns
// the card border + accent bar). The undated "this week" tasks moved here
// from the old WeekWidget column so nothing was lost in the consolidation.
export function DayView({ date }: Props) {
  const { tasks, isLoading, section } = useDayData(date)
  const { data: openWishes = [] } = useOpenWishes()
  const [modalOpen, setModalOpen] = useState(false)
  const [showWeek, setShowWeek] = useState(false)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const { data: weekTasks = [] } = useTasksByWeek(weekStart, endOfWeek(weekStart, { weekStartsOn: 1 }))
  const floating = weekTasks.filter(
    (t): t is Task => !t.due_date && t.status !== 'done' && t.status !== 'cancelled',
  )

  const openTasks      = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks      = tasks.filter(t => t.status === 'done' && completedWithinLast24h(t.updated_at))
  // Cancelled tasks used to just vanish (every other view filters status !==
  // 'cancelled' out of open/active counts) — that's right for counts, but a
  // task the user explicitly cancelled should still be visible as "cancelled"
  // somewhere rather than looking identical to a silent delete. Same 24h
  // window as Done so this doesn't accumulate forever.
  const cancelledTasks = tasks.filter(t => t.status === 'cancelled' && completedWithinLast24h(t.updated_at))

  return (
    <>
      <div className="p-4 sm:p-5">
        <OpenWishesRow wishes={openWishes} />

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Tasks</h2>
          <div className="flex items-center gap-2">
            {doneTasks.length > 0 && (
              <span className="text-[11px] text-ink-400">
                {doneTasks.length} done
              </span>
            )}
            {openTasks.length > 0 && (
              <span className="bg-accent-50 text-accent-600 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                {openTasks.length} open
              </span>
            )}
            {openTasks.length === 0 && doneTasks.length === 0 && !isLoading && (
              <span className="text-[11px] text-ink-500">no tasks</span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 bg-cream-200 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div>
            {openTasks.length === 0 && doneTasks.length === 0 && (
              <div className="py-4 text-center">
                <p className="text-sm text-ink-400">No tasks for this day</p>
                <p className="text-xs text-ink-500 mt-0.5">Click below to add one</p>
              </div>
            )}
            {openTasks.length === 0 && doneTasks.length > 0 && (
              <div className="py-3 text-center">
                <p className="text-sm text-accent-600 font-medium">All done!</p>
              </div>
            )}

            {openTasks.map(task => <ToDoItem key={task.id} task={task} />)}

            <button
              onClick={() => setModalOpen(true)}
              className="mt-1 w-full text-left text-sm text-ink-400 hover:text-accent-600 transition-colors duration-150 min-h-[44px] flex items-center gap-1.5 px-0"
            >
              <span className="text-base leading-none font-light">+</span>
              Add task
            </button>

            {doneTasks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-ink-100">
                <p className="text-[11px] uppercase tracking-wider text-ink-400 font-medium mb-1 px-3">Done</p>
                <div className="opacity-50">
                  {doneTasks.map(task => <ToDoItem key={task.id} task={task} />)}
                </div>
              </div>
            )}

            {cancelledTasks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-ink-100">
                <p className="text-[11px] uppercase tracking-wider text-ink-400 font-medium mb-1 px-3">Cancelled</p>
                <div className="opacity-50">
                  {cancelledTasks.map(task => <ToDoItem key={task.id} task={task} />)}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Undated this-week tasks (relocated from the old WeekWidget column) */}
        {floating.length > 0 && (
          <div className="mt-3 pt-3 border-t border-ink-100">
            <button
              onClick={() => setShowWeek(s => !s)}
              className="w-full flex items-center justify-between text-left min-h-[44px]"
            >
              <span className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">This week — no date</span>
              <span className="text-[10px] text-ink-400">{floating.length} {showWeek ? '▴' : '▾'}</span>
            </button>
            {showWeek && (
              <div className="mt-1">
                {floating.slice(0, 6).map(t => <ToDoItem key={t.id} task={t} />)}
                {floating.length > 6 && <p className="text-xs text-ink-400 mt-1">+{floating.length - 6} more</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <UnifiedPlanModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode="task"
        config={{ heading: 'New Task' }}
        defaults={{ section, date: format(date, 'yyyy-MM-dd'), dueDate: format(date, 'yyyy-MM-dd') }}
      />

    </>
  )
}
