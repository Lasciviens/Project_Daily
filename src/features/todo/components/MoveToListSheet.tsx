import { Check } from 'lucide-react'
import { Sheet } from '../../../shared/components/Sheet'
import { cx } from '../../../shared/ui'
import { useGoogleTaskLists } from '../hooks/useGoogleTaskLists'
import { useUpdateTask } from '../hooks/useTodos'
import type { Task } from '../types'

interface Props {
  open:    boolean
  onClose: () => void
  task:    Task
}

// Per-task list assignment — mirrors SetParentTaskSheet's shape (its own
// sheet, not a UnifiedPlanModal taskExtra slot; see that file's comment for
// why). Works the same whether the task is already synced (queues a real
// tasks.move via the outbox — migration 071's trigger detects the
// google_tasklist_id change) or still local-only (just changes which list
// the eventual first create targets).
export function MoveToListSheet({ open, onClose, task }: Props) {
  const { data: lists = [] } = useGoogleTaskLists()
  const update = useUpdateTask()

  function choose(googleTasklistLocalId: string | null) {
    update.mutate({ id: task.id, patch: { google_tasklist_id: googleTasklistLocalId } }, { onSuccess: onClose })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Move to list" size="sm">
      <div className="flex flex-col gap-1.5 p-4">
        {lists.length === 0 && (
          <p className="text-body text-fg-muted">
            No lists synced yet — tap Import in Settings to pull your Google Task lists.
          </p>
        )}
        {lists.map(l => (
          <button
            key={l.id}
            type="button"
            onClick={() => choose(l.id === task.google_tasklist_id ? null : l.id)}
            disabled={update.isPending}
            aria-pressed={task.google_tasklist_id === l.id}
            className={cx(
              'row row-interactive justify-between border text-body press-feedback disabled:opacity-50',
              task.google_tasklist_id === l.id
                ? 'border-accent-500/30 bg-accent-50 font-semibold text-accent-700'
                : 'border-line bg-surface text-fg-2',
            )}
          >
            <span className="truncate">{l.title}</span>
            {task.google_tasklist_id === l.id && <Check className="h-4 w-4 shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
