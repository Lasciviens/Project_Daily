import { useState } from 'react'
import type { Task, TaskSection } from '../types'
import { ToDoItem } from './ToDoItem'
import { useCreateTask } from '../hooks/useTodos'

interface Props {
  title:       string
  section:     TaskSection
  tasks:       Task[]
  defaultOpen?: boolean
}

export function ToDoSection({ title, section, tasks, defaultOpen = true }: Props) {
  const [isOpen,  setIsOpen]  = useState(defaultOpen)
  const [adding,  setAdding]  = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const create = useCreateTask()

  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
  const doneTasks = tasks.filter(t => t.status === 'done')

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newTitle.trim()
    if (!trimmed) return
    await create.mutateAsync({ title: trimmed, section, domain: 'personal' })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div>
      {/* Header */}
      <button
        onClick={() => setIsOpen(p => !p)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-cream-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {title}
          </span>
          {openTasks.length > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
              {openTasks.length}
            </span>
          )}
        </div>
        <span className={`text-ink-300 text-xs transition-transform duration-150 inline-block ${isOpen ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>

      {isOpen && (
        <div>
          {openTasks.map(task => <ToDoItem key={task.id} task={task} />)}

          {/* Inline add form */}
          {adding ? (
            <form onSubmit={handleAdd} className="px-3 py-1.5">
              <input
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setAdding(false)}
                placeholder="Task title…"
                className="w-full text-sm px-2.5 py-1.5 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white"
              />
              <div className="flex gap-2 mt-1.5">
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="text-[11px] text-amber-600 font-medium hover:text-amber-700 transition-colors duration-150"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setNewTitle('') }}
                  className="text-[11px] text-ink-400 hover:text-ink-600 transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-ink-400 hover:text-amber-600 transition-colors duration-150 flex items-center gap-1"
            >
              <span className="text-base leading-none">+</span> Add task
            </button>
          )}

          {/* Done tasks */}
          {doneTasks.length > 0 && (
            <div className="mt-1 opacity-50">
              {doneTasks.map(task => <ToDoItem key={task.id} task={task} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
