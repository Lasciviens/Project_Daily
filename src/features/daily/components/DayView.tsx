import { useState } from 'react'
import { format } from 'date-fns'
import { useDayData } from '../hooks/useDayData'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'

interface Props { date: Date }

export function DayView({ date }: Props) {
  const { tasks, isLoading, section } = useDayData(date)
  const [modalOpen, setModalOpen] = useState(false)

  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks = tasks.filter(t => t.status === 'done')

  return (
    <>
      <div className="card overflow-hidden">
        {/* Accent bar gives the card a clear visual anchor in the page hierarchy */}
        <div className="h-0.5 bg-accent-500" />
        <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Tasks</h2>
          {openTasks.length > 0 && (
            <span className="bg-accent-50 text-accent-600 text-[11px] font-semibold px-2 py-0.5 rounded-full">
              {openTasks.length} open
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 bg-cream-200 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div>
            {openTasks.length === 0 && (
              <p className="text-sm text-ink-400 italic py-1">No tasks for this day.</p>
            )}

            {openTasks.map(task => <ToDoItem key={task.id} task={task} />)}

            <button
              onClick={() => setModalOpen(true)}
              className="mt-1 w-full text-left text-sm text-ink-400 hover:text-accent-600 transition-colors duration-150 py-1.5 flex items-center gap-1.5"
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

          </div>
        )}
        </div>
      </div>

      <AddTaskModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultSection={section}
        defaultDate={format(date, 'yyyy-MM-dd')}
      />

    </>
  )
}
