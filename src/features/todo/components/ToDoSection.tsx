import { useState } from 'react'
import type { Task, TaskSection } from '../types'
import { ToDoItem } from './ToDoItem'
import { AddTaskModal } from '../../../shared/components/AddTaskModal'
import { useSwapTaskOrder } from '../hooks/useTodos'

interface Props {
  title:        string
  section:      TaskSection
  tasks:        Task[]
  defaultOpen?: boolean
  isLoading?:   boolean
}

export function ToDoSection({ title, section, tasks, defaultOpen = true, isLoading }: Props) {
  const [isOpen,        setIsOpen]        = useState(defaultOpen)
  const [completedOpen, setCompletedOpen] = useState(false)
  const [modalOpen,     setModalOpen]     = useState(false)
  const swap = useSwapTaskOrder()

  const openTasks = [...tasks.filter(t => t.status === 'open' || t.status === 'in_progress')]
    .sort((a, b) => a.sort_order - b.sort_order)
  const doneTasks = tasks.filter(t => t.status === 'done')

  return (
    <>
      <div>
        <button
          onClick={() => setIsOpen(p => !p)}
          className="w-full flex items-center justify-between px-3 py-2 min-h-[44px] text-left hover:bg-cream-50 transition-colors duration-150"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {title}
            </span>
            {openTasks.length > 0 && (
              <span className="text-[10px] bg-accent-100 text-accent-700 font-semibold px-1.5 py-0.5 rounded-full">
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
            {isLoading && (
              <div className="px-3 py-1.5 space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-3 bg-cream-200 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
                ))}
              </div>
            )}
            {!isLoading && openTasks.map((task, idx) => (
              <ToDoItem
                key={task.id}
                task={task}
                canMoveUp={idx > 0}
                canMoveDown={idx < openTasks.length - 1}
                onMoveUp={() => swap.mutate({ id1: task.id, id2: openTasks[idx - 1].id })}
                onMoveDown={() => swap.mutate({ id1: task.id, id2: openTasks[idx + 1].id })}
              />
            ))}
            {!isLoading && openTasks.length === 0 && doneTasks.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-ink-300 italic">Nothing here yet</p>
            )}

            <button
              onClick={() => setModalOpen(true)}
              className="w-full text-left px-3 min-h-[44px] text-[11px] text-ink-400 hover:text-accent-600 transition-colors duration-150 flex items-center gap-1"
            >
              <span className="text-base leading-none">+</span> Add task
            </button>

            {/* Completed section — collapsed by default, matching Google Tasks design */}
            {doneTasks.length > 0 && (
              <div className="border-t border-ink-50">
                <button
                  onClick={() => setCompletedOpen(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] text-left hover:bg-cream-50 transition-colors duration-150"
                >
                  <span className={`text-ink-300 text-xs transition-transform duration-150 inline-block ${completedOpen ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                  <span className="text-[11px] text-ink-400">
                    Completed ({doneTasks.length})
                  </span>
                </button>
                {completedOpen && (
                  <div className="opacity-60">
                    {doneTasks.map(task => <ToDoItem key={task.id} task={task} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AddTaskModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultSection={section}
      />
    </>
  )
}
