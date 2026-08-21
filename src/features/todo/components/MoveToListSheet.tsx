import { Sheet } from '../../../shared/components/Sheet'
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
      <div className="p-4 flex flex-col gap-1.5">
        {lists.length === 0 && (
          <p className="text-sm text-ink-400">
            No lists synced yet — tap Import in Settings to pull your Google Task lists.
          </p>
        )}
        {lists.map(l => (
          <button
            key={l.id}
            type="button"
            onClick={() => choose(l.id === task.google_tasklist_id ? null : l.id)}
            disabled={update.isPending}
            className={`min-h-[44px] flex items-center justify-between px-3 rounded-lg border text-sm transition-colors press-feedback ${
              task.google_tasklist_id === l.id
                ? 'border-accent-300 bg-accent-50 text-accent-700'
                : 'border-ink-100 bg-cream-50 text-ink-700 hover:border-accent-200'
            }`}
          >
            <span className="truncate">{l.title}</span>
            {task.google_tasklist_id === l.id && <span aria-hidden>✓</span>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
