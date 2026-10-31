import { Hash } from 'lucide-react'
import { TonePill, cx } from '../../../shared/ui'
import { labelsOf } from '../taskLabels'

/** A task's own labels (migration 180) as small chips, after what the app says about the task; each in its own
 *  <bdi>, so a label's writing direction never reorders the row around it. */
export function TaskLabelPills({ task, className }: { task: { labels?: unknown }; className?: string }) {
  return labelsOf(task).map(l => (
    <TonePill key={l} tone="neutral" className={cx('max-w-[10rem]', className)}>
      <Hash className="h-3 w-3 shrink-0" aria-hidden /><bdi className="truncate">{l}</bdi>
    </TonePill>
  ))
}
