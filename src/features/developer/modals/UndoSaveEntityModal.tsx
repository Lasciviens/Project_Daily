import type { EntityModalProps } from '../../../shared/modals'
import { UndoSaveSheet } from '../components/UndoSaveSheet'

/**
 * `undo-save`: the preview of undoing one save of the activity log, by its
 * transaction id. A popup of the shell's host, so the result toast's Undo
 * (the undo's own save) opens it from any screen.
 */
export function UndoSaveEntityModal({ request, onClose }: EntityModalProps<'undo-save'>) {
  return <UndoSaveSheet txId={request.txId} onClose={onClose} />
}
