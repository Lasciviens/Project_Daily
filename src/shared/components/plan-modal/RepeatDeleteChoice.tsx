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
      open={open} onClose={onClose} size="sm" layer="confirm" compact title={`Delete “${title}”?`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose} className="mr-auto -ml-2">Cancel</Button>
          <Button variant="danger" size="sm" onClick={() => onPick('day')}>Only {formatDate(date)}</Button>
          <Button variant="danger" size="sm" onClick={() => onPick('all')}>Every day it repeats</Button>
        </div>
      }
    >
      <p className="text-body text-fg-muted">It repeats. Delete one day, or the whole repeat?</p>
    </ModalShell>
  )
}
