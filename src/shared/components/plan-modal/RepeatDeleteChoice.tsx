import { ModalShell } from '../../modals/ModalShell'
import { Button } from '../../ui'
import { formatDate } from '../../utils/dateFormat'

/**
 * Deleting a repeating item from one of its days asks which: "Only
 * 15.10.2026" or "Every day it repeats". The sheet's own question — the
 * delete then runs with `ask: false` and still says what happened with Undo.
 */
export function RepeatDeleteChoice({ open, title, date, onPick, onClose }: {
  open: boolean
  title: string
  date: string
  onPick: (scope: 'day' | 'all') => void
  onClose: () => void
}) {
  return (
    <ModalShell
      open={open} onClose={onClose} size="xs" layer="confirm" title={`Delete “${title}”?`}
      footer={<Button block onClick={onClose}>Cancel</Button>}
    >
      <p className="text-body text-fg-muted">It repeats. Delete one day, or the whole repeat?</p>
      <div className="mt-3 flex flex-col gap-2">
        <Button block variant="danger" onClick={() => onPick('day')}>Only {formatDate(date)}</Button>
        <Button block variant="danger" onClick={() => onPick('all')}>Every day it repeats</Button>
      </div>
    </ModalShell>
  )
}
