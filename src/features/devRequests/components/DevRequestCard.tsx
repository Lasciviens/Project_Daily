import { Check, GripVertical, X } from 'lucide-react'
import type { DevRequest } from '../types'
import { IconButton, ToneDot, TonePill, cx } from '../../../shared/ui'
import { CATEGORY_TONE, PRIORITY_TONE } from './devRequestMeta'

interface Props {
  request:    DevRequest
  dragging:   boolean
  onDragStart: () => void
  onDragEnd:   () => void
  onCycleStatus: () => void
  onDelete:      () => void
  onEdit:        () => void
}

export function DevRequestCard({ request, dragging, onDragStart, onDragEnd, onCycleStatus, onDelete, onEdit }: Props) {
  const isDone = request.status === 'done'
  const inProgress = request.status === 'in_progress'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cx(
        'group flex cursor-grab select-none items-start gap-1 rounded-row border border-line bg-surface py-1 pl-1 pr-1 transition-opacity',
        dragging && 'opacity-30',
        isDone && 'opacity-60',
      )}
    >
      <GripVertical aria-hidden className="mt-3.5 h-4 w-4 shrink-0 text-fg-faint opacity-0 transition-opacity [@media(hover:hover)]:group-hover:opacity-100" />
      <button
        type="button"
        onClick={onCycleStatus}
        aria-label={`Status: ${request.status.replace('_', ' ')} — advance`}
        title={`Status: ${request.status.replace('_', ' ')} (click to advance)`}
        className="grid min-h-[44px] min-w-[36px] shrink-0 place-items-center lg:min-h-[40px]"
      >
        <span
          data-tone={isDone ? 'success' : inProgress ? 'info' : 'neutral'}
          className={cx(
            'grid h-4 w-4 place-items-center rounded-full border-2 border-[rgb(var(--tone))]',
            isDone && 'bg-[rgb(var(--tone))]',
          )}
        >
          {isDone && <Check aria-hidden className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onEdit}
            className={cx(
              '-mx-1 rounded-control px-1 text-left text-body transition-colors [@media(hover:hover)]:hover:bg-surface-hover',
              isDone ? 'text-fg-faint line-through' : 'text-fg',
            )}
          >
            {request.title}
          </button>
          {request.page && <span className="chip shrink-0 font-mono text-micro">{request.page}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TonePill tone={CATEGORY_TONE[request.category]}>{request.category}</TonePill>
          <span className="inline-flex items-center gap-1 text-meta text-fg-muted" title={`Priority: ${request.priority}`}>
            <ToneDot tone={PRIORITY_TONE[request.priority]} />{request.priority}
          </span>
          {request.effort && <span className="text-meta text-fg-faint">· {request.effort}</span>}
        </div>
      </div>

      <IconButton label="Delete request" onClick={onDelete} className="shrink-0 hover:!text-danger"><X /></IconButton>
    </div>
  )
}
