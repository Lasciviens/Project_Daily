import { useRef } from 'react'
import { Combobox, ComboboxInput, ComboboxOption } from '@headlessui/react'
import { X } from 'lucide-react'
import { Button, Skeleton, Truncate } from '../../../shared/ui'
import { FieldOptions } from '../../../shared/components/FieldOptions'
import { typingHints } from '../../../shared/components/plan-modal/fieldStyles'
import { useAllTasks, useSetParentTask } from '../hooks/useTodos'
import { isOpenTask } from '../taskRules'
import type { Task } from '../types'

// Google Tasks caps subtask nesting at one level (a subtask can't itself be
// a parent — the Tasks API v1 discovery doc's tasks.move description says
// so explicitly). Two distinct ways a 3-level chain could otherwise happen:
// 1. The CANDIDATE already has a parent, or already has children of its own
//    (picking it would put `task` two levels under the candidate's own
//    parent, or make the candidate a parent-of-a-parent).
// 2. `task` ITSELF already has children — parenting it under anyone makes
//    its own children a grandchild layer. Gated entirely via hasSubtasks:
//    the picker doesn't render at all in that case (see below).
// The item screen's Parent row (TaskRows.tsx): mounted only while the row is
// open, so the list of every task is read then, not by every task row. Its
// matches open in the shared field list under the search (FieldOptions —
// owner, 28.11.2026: every list on the item screen is that one).
export function ParentPicker({ task, hasSubtasks, query, onQuery, onClose, className = 'p-4' }: {
  task: Task
  hasSubtasks: boolean
  query: string
  onQuery: (query: string) => void
  onClose: () => void
  /** Its padding: the item screen's Parent row puts it in a panel that has its own. */
  className?: string
}) {
  const { data: tasks = [], isLoading } = useAllTasks()
  const setParent = useSetParentTask()
  const field = useRef<HTMLInputElement>(null)

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
    && isOpenTask(t)
    && !childIds.has(t.id)     // would create a 3-level chain from below
    && !t.parent_task_id       // candidate already a subtask itself — same reason
    && (!task.google_task_id || (!!t.google_task_id && t.google_tasklist_id === task.google_tasklist_id))
  ).filter(t => t.title.toLowerCase().includes(query.toLowerCase()))

  function choose(parentId: string | null) {
    setParent.mutate({ id: task.id, parentTaskId: parentId }, { onSuccess: onClose })
  }

  return (
    <div className={className}>
      {task.parent_task_id && (
        <Button block icon={<X />} onClick={() => choose(null)} disabled={setParent.isPending} className="mb-3" tip="Top-level — remove it from its parent">
          Top-level
        </Button>
      )}

      {hasSubtasks ? (
        <p className="text-body leading-snug text-fg-muted">
          This task already has subtasks of its own — Google Tasks only supports one level of
          nesting, so it can't also become a subtask of another task.
        </p>
      ) : (
        <Combobox onChange={(id: string | null) => id && choose(id)} immediate>
          <ComboboxInput
            ref={field}
            className="input"
            placeholder="Search"
            aria-label="Parent: search your open tasks"
            onChange={e => onQuery(e.target.value)}
            {...typingHints('q-parent', 'search')}
            autoFocus
          />
          <FieldOptions field={field} align="start" className="min-w-[15rem]">
            {/* While every task loads: a few rows at a row's height, so the list doesn't grow under the field. */}
            {isLoading && [0, 1, 2].map(i => <Skeleton key={i} rounded="rounded-row" className="my-0.5 h-9" />)}
            {candidates.length === 0 && !isLoading && (
              <p className="px-3 py-2 text-meta text-fg-muted">No matching tasks</p>
            )}
            {candidates.map(t => (
              <ComboboxOption key={t.id} value={t.id} className="menu-item cursor-pointer data-[focus]:bg-surface-hover">
                <bdi className="min-w-0 flex-1"><Truncate>{t.title}</Truncate></bdi>
              </ComboboxOption>
            ))}
          </FieldOptions>
        </Combobox>
      )}
    </div>
  )
}
