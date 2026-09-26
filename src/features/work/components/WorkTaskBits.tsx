import { Hourglass } from 'lucide-react'
import type { Task } from '../../todo/types'
import { TonePill, cx } from '../../../shared/ui'
import { PRIORITY_ICON, PRIORITY_LABEL, PRIORITY_TONE, dueLabel } from './workMeta'

// Small chips every Work view shares (card, list row, focus strip), so the
// board, the list and the strip can never drift apart visually.

export function PriorityMark({ task, withLabel = false }: { task: Task; withLabel?: boolean }) {
  return (
    <span
      data-tone={PRIORITY_TONE[task.priority]}
      title={`${PRIORITY_LABEL[task.priority]} priority`}
      className="tone-text inline-flex shrink-0 items-center gap-1 text-micro leading-none"
    >
      <span aria-hidden>{PRIORITY_ICON[task.priority]}</span>
      {withLabel ? PRIORITY_LABEL[task.priority] : <span className="sr-only">{PRIORITY_LABEL[task.priority]} priority</span>}
    </span>
  )
}

export function DueChip({ task }: { task: Task }) {
  const due = dueLabel(task)
  if (!due || task.status === 'done') return null
  return <TonePill tone={due.urgent ? 'danger' : 'neutral'} className="shrink-0 tabular-nums">{due.text}</TonePill>
}

export function WaitingChip({ text, className }: { text: string; className?: string }) {
  return (
    <TonePill tone="warn" className={cx('max-w-[10rem] shrink-0', className)}>
      <Hourglass aria-hidden className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </TonePill>
  )
}
