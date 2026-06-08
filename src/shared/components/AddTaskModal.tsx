import { useState, useEffect } from 'react'
import { useCreateTask, useUpdateTask } from '../../features/todo/hooks/useTodos'
import { useCreateTimeBlock } from '../../features/daily/hooks/useSchedule'
import { toast } from '../../app/store'
import type { Task, TaskSection, TaskPriority, TaskDomain } from '../../features/todo/types'

interface Props {
  isOpen:          boolean
  onClose:         () => void
  defaultSection?: TaskSection
  defaultDate?:    string
  defaultDomain?:  TaskDomain
  task?:           Task        // when provided → edit mode
}

const SECTIONS: { id: TaskSection; label: string }[] = [
  { id: 'inbox',     label: 'Inbox'     },
  { id: 'today',     label: 'Today'     },
  { id: 'tomorrow',  label: 'Tomorrow'  },
  { id: 'this_week', label: 'This Week' },
  { id: 'backlog',   label: 'Backlog'   },
]

const PRIORITIES: { id: TaskPriority; label: string; color: string }[] = [
  { id: 'low',    label: 'Low',    color: 'bg-ink-300'    },
  { id: 'medium', label: 'Medium', color: 'bg-accent-400' },
  { id: 'high',   label: 'High',   color: 'bg-red-400'    },
]

export function AddTaskModal({ isOpen, onClose, defaultSection = 'inbox', defaultDate, defaultDomain = 'personal', task }: Props) {
  const editMode = !!task

  const [title,    setTitle]    = useState('')
  const [section,  setSection]  = useState<TaskSection>(defaultSection)
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [domain,   setDomain]   = useState<TaskDomain>(defaultDomain)
  const [dueDate,  setDueDate]  = useState(defaultDate ?? '')

  const create          = useCreateTask()
  const update          = useUpdateTask()
  const createTimeBlock = useCreateTimeBlock()
  const isPending = create.isPending || update.isPending

  useEffect(() => {
    if (isOpen) {
      if (editMode && task) {
        setTitle(task.title)
        setSection(task.section)
        setPriority(task.priority)
        setDomain(task.domain)
        setDueDate(task.due_date ?? '')
      } else {
        setTitle('')
        setSection(defaultSection)
        setPriority('medium')
        setDomain(defaultDomain)
        setDueDate(defaultDate ?? '')
      }
    }
  }, [isOpen, defaultSection, defaultDate, defaultDomain, task, editMode])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    if (editMode && task) {
      await update.mutateAsync({
        id: task.id,
        patch: { title: trimmed, section, priority, domain, due_date: dueDate || null },
      })
    } else {
      const { task: result, todoistError } = await create.mutateAsync({
        title: trimmed,
        section,
        priority,
        domain,
        due_date: dueDate || null,
      })
      if (todoistError) {
        console.warn('[Todoist] create error:', todoistError)
      }
      // Auto-schedule onto the day timeline
      if (domain === 'personal' && dueDate) {
        const dow     = new Date(dueDate + 'T00:00:00').getDay()
        const weekend = dow === 0 || dow === 6
        const toastId = toast.loading('Scheduling on timeline…')
        await new Promise<void>(resolve => {
          createTimeBlock.mutate(
            {
              date:             dueDate,
              title:            trimmed,
              start_time:       weekend ? '12:00:00' : '17:00:00',
              duration_minutes: 60,
              color:            'accent',
              source_type:      'task',
              source_id:        result.id,
            },
            {
              onSuccess: () => { toast.dismiss(toastId); toast.success('Added to day schedule ✓'); resolve() },
              onError:   (err) => { toast.dismiss(toastId); toast.error(`Schedule failed: ${(err as Error).message}`); resolve() },
            }
          )
        })
      }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-card-hover border border-ink-200">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-ink-800">{editMode ? 'Edit Task' : 'New Task'}</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 transition-colors duration-150 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5 flex flex-col gap-4">
          <textarea
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            rows={3}
            className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-3 text-sm text-ink-900
                       placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400
                       focus:border-accent-400 transition-colors duration-150 resize-none"
          />

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
              Section
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors duration-150 ${
                    section === s.id
                      ? 'bg-accent-500 text-white'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
              Priority
            </label>
            <div className="flex gap-1.5">
              {PRIORITIES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors duration-150 ${
                    priority === p.id
                      ? 'bg-ink-900 text-white'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${p.color}`} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Domain
              </label>
              <div className="flex gap-1.5">
                {(['personal', 'work', 'media'] as TaskDomain[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDomain(d)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors duration-150 ${
                      domain === d
                        ? 'bg-accent-500 text-white'
                        : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Due Date
              </label>
              <input
                type="date"
                lang="en-GB"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full bg-ink-100 border-none rounded-lg px-3 py-1.5 text-xs text-ink-700
                           focus:outline-none focus:ring-2 focus:ring-accent-400 transition-colors duration-150"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? (editMode ? 'Saving…' : 'Adding…') : (editMode ? 'Save Changes' : 'Add Task')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
