import { useState } from 'react'
import { format } from 'date-fns'
import { useDayData } from '../hooks/useDayData'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { completedWithinLast24h } from '../../todo/taskRules'

interface Props { date: Date }

export function DayView({ date }: Props) {
  const { tasks, isLoading, section } = useDayData(date)
  const [modalOpen, setModalOpen] = useState(false)

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
      <div className="card overflow-hidden">
        {/* Accent bar gives the card a clear visual anchor in the page hierarchy */}
        <div className="h-0.5 bg-accent-500" />
        <div className="p-5">
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
              <span className="text-[11px] text-ink-300">no tasks</span>
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
                <p className="text-xs text-ink-300 mt-0.5">Click below to add one</p>
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
        </div>
      </div>

      <UnifiedPlanModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        config={{ tabs: ['task', 'schedule'], heading: 'New Task' }}
        defaults={{ section, date: format(date, 'yyyy-MM-dd'), dueDate: format(date, 'yyyy-MM-dd') }}
      />

    </>
  )
}
