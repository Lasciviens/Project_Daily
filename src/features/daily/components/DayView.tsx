import { useState } from 'react'
import { format } from 'date-fns'
import { useDayData } from '../hooks/useDayData'
import { useCreateTask } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'

interface Props { date: Date }

export function DayView({ date }: Props) {
  const { tasks, isLoading, section } = useDayData(date)
  const [adding,   setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const createTask = useCreateTask()

  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks = tasks.filter(t => t.status === 'done')

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newTitle.trim()
    if (!trimmed) return
    await createTask.mutateAsync({
      title:    trimmed,
      section,
      domain:   'personal',
      due_date: format(date, 'yyyy-MM-dd'),
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Tasks</h2>
        {openTasks.length > 0 && (
          <span className="text-xs text-ink-400">{openTasks.length} open</span>
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
          {openTasks.length === 0 && !adding && (
            <p className="text-sm text-ink-400 italic py-1">No tasks for this day.</p>
          )}

          {openTasks.map(task => <ToDoItem key={task.id} task={task} />)}

          {/* Add form */}
          {adding ? (
            <form onSubmit={handleAdd} className="mt-2">
              <input
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setAdding(false)}
                placeholder="Task title…"
                className="input w-full text-sm"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={createTask.isPending}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setNewTitle('') }}
                  className="btn-ghost text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mt-1 w-full text-left text-sm text-ink-400 hover:text-amber-600 transition-colors duration-150 py-1.5 flex items-center gap-1.5"
            >
              <span className="text-base leading-none font-light">+</span>
              Add task
            </button>
          )}

          {/* Done tasks */}
          {doneTasks.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ink-100">
              <p className="text-[11px] uppercase tracking-wider text-ink-400 font-medium mb-1 px-3">
                Done
              </p>
              <div className="opacity-50">
                {doneTasks.map(task => <ToDoItem key={task.id} task={task} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
