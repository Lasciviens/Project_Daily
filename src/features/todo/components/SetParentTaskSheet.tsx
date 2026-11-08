import { Suspense, useState } from 'react'
import { Sheet } from '../../../shared/components/Sheet'
import { Skeleton, SkeletonText } from '../../../shared/ui'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import type { Task } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  task: Task
  // Passed down from ToDoItem, which already runs useSubtasks(task.id) for
  // its own "N subtasks" badge — avoids a second identical query here.
  hasSubtasks: boolean
}

// Every task row renders this sheet, closed. The picker — the list of every
// task and the Combobox — mounts only while it is open: each closed sheet used
// to read all tasks, on every page with a task row and again on each return to
// the app. Its code loads in idle time, so the sheet still opens at once.
// The rules are in ParentPicker.tsx.
const ParentPicker = lazyPart('task-parent-picker', () => import('./ParentPicker').then(m => m.ParentPicker))
const PICKER = [ParentPicker]

export function SetParentTaskSheet({ open, onClose, task, hasSubtasks }: Props) {
  useIdlePreload(PICKER)
  const [query, setQuery] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="Set parent task" size="sm">
      <Suspense fallback={<PickerSkeleton task={task} hasSubtasks={hasSubtasks} />}>
        <ParentPicker task={task} hasSubtasks={hasSubtasks} query={query} onQuery={setQuery} onClose={onClose} />
      </Suspense>
    </Sheet>
  )
}

/** The picker's loading copy, at its size: the Remove button when the task has a parent, then the search field (or
 *  the note about subtasks) — the sheet opens at its size instead of growing when the code lands. */
function PickerSkeleton({ task, hasSubtasks }: { task: Task; hasSubtasks: boolean }) {
  return (
    <div aria-busy="true" className="p-4">
      {task.parent_task_id && <Skeleton className="mb-3 h-11 w-full" />}
      {hasSubtasks
        ? <SkeletonText lines={3} className="py-1" />
        : <Skeleton className="h-10 w-full [@media(pointer:coarse)]:h-11" rounded="rounded-input" />}
    </div>
  )
}
