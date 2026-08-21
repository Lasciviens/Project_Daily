import { useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { Sheet } from '../../../shared/components/Sheet'
import { useAllTasks, useSetParentTask } from '../hooks/useTodos'
import type { Task } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
}

// Google Tasks caps subtask nesting at one level (a subtask can't itself be
// a parent — the Tasks API v1 discovery doc's tasks.move description says
// so explicitly), so a candidate that already has children is excluded
// rather than silently producing a 3-level chain our own sync can't express.
export function SetParentTaskSheet({ open, onClose, task }: Props) {
  const { data: tasks = [] } = useAllTasks()
  const setParent = useSetParentTask()
  const [query, setQuery] = useState('')

  const childIds = new Set(tasks.filter(t => t.parent_task_id === task.id).map(t => t.id))
  const candidates = tasks.filter(t =>
    t.id !== task.id
    && t.status !== 'done' && t.status !== 'cancelled'
    && !childIds.has(t.id)     // would create a 3-level chain
    && !t.parent_task_id       // already a subtask itself — same reason
  ).filter(t => t.title.toLowerCase().includes(query.toLowerCase()))

  function choose(parentId: string | null) {
    setParent.mutate({ id: task.id, parentTaskId: parentId }, { onSuccess: onClose })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set parent task" size="sm">
      <div className="p-4">
        {task.parent_task_id && (
          <button
            type="button"
            onClick={() => choose(null)}
            disabled={setParent.isPending}
            className="w-full min-h-[44px] mb-3 rounded-lg border border-ink-200 text-sm text-ink-600 hover:border-accent-300 hover:text-accent-700 transition-colors press-feedback"
          >
            ✕ Remove from parent (make top-level)
          </button>
        )}
        <Combobox onChange={(id: string | null) => id && choose(id)}>
          <ComboboxInput
            className="w-full min-h-[44px] px-3 rounded-lg border border-ink-200 bg-cream-50 text-sm focus:outline-none focus:ring-2 focus:ring-accent-300"
            placeholder="Search tasks…"
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <ComboboxOptions className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-ink-100">
            {candidates.length === 0 && (
              <p className="px-3 py-2 text-sm text-ink-400">No matching tasks</p>
            )}
            {candidates.map(t => (
              <ComboboxOption
                key={t.id}
                value={t.id}
                className="min-h-[44px] flex items-center px-3 text-sm text-ink-700 cursor-pointer data-[focus]:bg-cream-100"
              >
                {t.title}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </Combobox>
      </div>
    </Sheet>
  )
}
