import { toast } from '../../app/store'
import { entityModal } from './useEntityModal'
import { runDeleteFlow, type DeleteFlow } from './deleteFlowCore'

export { NO_UNDO, type DeleteFlow, type RestoreAnswer } from './deleteFlowCore'

/**
 * Every delete in the app goes through this: the question, the delete, the
 * result ("Task deleted · Undo") and the Undo that puts the same rows back.
 *
 *   await confirmDelete({
 *     title: 'Delete this task?',
 *     remove: () => del.mutateAsync(task.id),      // returns the deleted rows
 *     restore: rows => restore.mutateAsync(rows),  // same ids back
 *     done: 'Task deleted',
 *   })
 */
export function confirmDelete<S>(flow: DeleteFlow<S>) {
  return runDeleteFlow(flow, {
    confirm: entityModal.confirm,
    undoToast: (message, onUndo) => { toast.undo(message, onUndo) },
    success: toast.success,
    info: toast.info,
    warning: toast.warning,
  })
}
