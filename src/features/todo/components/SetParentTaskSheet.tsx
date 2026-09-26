import { useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { X } from 'lucide-react'
import { Sheet } from '../../../shared/components/Sheet'
import { Button } from '../../../shared/ui'
import { useAllTasks, useSetParentTask } from '../hooks/useTodos'
import type { Task } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
  // Passed down from ToDoItem, which already runs useSubtasks(task.id) for
  // its own "N subtasks" badge — avoids a second identical query here.
  hasSubtasks: boolean
}

// Google Tasks caps subtask nesting at one level (a subtask can't itself be
// a parent — the Tasks API v1 discovery doc's tasks.move description says
// so explicitly). Two distinct ways a 3-level chain could otherwise happen:
// 1. The CANDIDATE already has a parent, or already has children of its own
//    (picking it would put `task` two levels under the candidate's own
//    parent, or make the candidate a parent-of-a-parent).
// 2. `task` ITSELF already has children — parenting it under anyone makes
//    its own children a grandchild layer. Gated entirely via hasSubtasks:
//    the picker doesn't render at all in that case (see below).
export function SetParentTaskSheet({ open, onClose, task, hasSubtasks }: Props) {
  const { data: tasks = [] } = useAllTasks()
  const setParent = useSetParentTask()
  const [query, setQuery] = useState('')

  const childIds = new Set(tasks.filter(t => t.parent_task_id === task.id).map(t => t.id))
  // Once a task is actually synced to Google (has its own google_task_id),
  // a candidate parent must ALSO exist there already and live in the SAME
  // Google list — tasks.move's `parent` is resolved within one list, and a
  // candidate with no google_task_id yet would make the eventual move()
  // call silently omit the parent (see googleTasksOutbox.ts's
  // resolveGoogleParentId, which returns undefined for an unsynced task).
  // Cross-list parenting is a bigger move (destinationTasklist + parent at
  // once) intentionally left out of this simple picker.
  const candidates = tasks.filter(t =>
    t.id !== task.id
    && t.status !== 'done' && t.status !== 'cancelled'
    && !childIds.has(t.id)     // would create a 3-level chain from below
    && !t.parent_task_id       // candidate already a subtask itself — same reason
    && (!task.google_task_id || (!!t.google_task_id && t.google_tasklist_id === task.google_tasklist_id))
  ).filter(t => t.title.toLowerCase().includes(query.toLowerCase()))

  function choose(parentId: string | null) {
    setParent.mutate({ id: task.id, parentTaskId: parentId }, { onSuccess: onClose })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set parent task" size="sm">
      <div className="p-4">
        {task.parent_task_id && (
          <Button block icon={<X />} onClick={() => choose(null)} disabled={setParent.isPending} className="mb-3">
            Remove from parent (make top-level)
          </Button>
        )}

        {hasSubtasks ? (
          <p className="text-body leading-snug text-fg-muted">
            This task already has subtasks of its own — Google Tasks only supports one level of
            nesting, so it can't also become a subtask of another task.
          </p>
        ) : (
          <Combobox onChange={(id: string | null) => id && choose(id)}>
            <ComboboxInput
              className="input"
              placeholder="Search tasks…"
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            <ComboboxOptions className="mt-2 max-h-64 overflow-y-auto rounded-row border border-line p-1">
              {candidates.length === 0 && (
                <p className="px-3 py-2 text-body text-fg-muted">No matching tasks</p>
              )}
              {candidates.map(t => (
                <ComboboxOption
                  key={t.id}
                  value={t.id}
                  className="row cursor-pointer text-body text-fg-2 data-[focus]:bg-surface-hover data-[focus]:text-fg"
                >
                  {t.title}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        )}
      </div>
    </Sheet>
  )
}
