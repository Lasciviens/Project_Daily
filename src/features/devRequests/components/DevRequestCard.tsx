import { useMemo } from 'react'
import { Check, CornerUpLeft, GripVertical, ListOrdered, MapPin, Sparkles, Trash2 } from 'lucide-react'
import type { DevRequest } from '../types'
import { descriptionPreview, parseDescription, pickMarks, plainText } from '../devRequestMarks'
import { cleanText } from '../devRequestContext'
import { isReviewable, reviewProgress, requestPoints } from '../points'
import { ReviewMeter } from './ReviewMeter'
import { IconButton, ToneDot, TonePill, Truncate, cx } from '../../../shared/ui'
import { awaitingCheck, cardTimeline } from '../devRequestRules'
import { CATEGORY_TONE, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from './devRequestMeta'

interface Props {
  request:    DevRequest
  /** Unsaved edits of this request are kept on this device. */
  hasDraft?:  boolean
  selected:   boolean
  dragging:   boolean
  onDragStart: () => void
  onDragEnd:   () => void
  onToggleSelect: () => void
  onDelete:      () => void
  /** Opens the request in the request window (where it is edited and checked). */
  onOpen:        () => void
}

/**
 * One request in the list — a summary only: title and page, a line of the
 * text, its details as pills, how the check is going (a meter + "3 of 5
 * fixed") and its dates. Writing and checking happen in the request window
 * (a tap on the card); the circle ticks it for the action bar (Mark done,
 * Delete, Build prompt).
 */
export function DevRequestCard({ request, hasDraft, selected, dragging, onDragStart, onDragEnd, onToggleSelect, onDelete, onOpen }: Props) {
  const isDone = request.status === 'done'
  const prompted = awaitingCheck(request)
  const timeline = cardTimeline(request)
  const parsed = useMemo(() => parseDescription(request.description), [request.description])
  const points = useMemo(() => requestPoints(parsed), [parsed])
  const progress = isReviewable(request) ? reviewProgress(points) : ''
  // The points' own words, one after another ("Still not fixed" notes left out).
  const preview = useMemo(
    () => cleanText(points.map(pt => plainText(pt.words, parsed.marks)).filter(Boolean).join(' · '), 200) || descriptionPreview(request.description, 200),
    [points, parsed.marks, request.description],
  )
  const picks = pickMarks(parsed.marks).length

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cx(
        'group relative flex select-none items-start gap-1 rounded-row border bg-surface py-1 pl-0.5 pr-1 transition-[border-color,box-shadow,opacity] duration-100',
        selected ? 'border-accent-500/50 shadow-[0_0_0_3px_rgb(var(--accent-500)/0.14)]' : 'border-line [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:shadow-card-hover',
        dragging && 'opacity-30',
        isDone && 'opacity-70',
      )}
    >
      <GripVertical aria-hidden className="absolute -left-0.5 top-4 h-4 w-4 cursor-grab text-fg-faint opacity-0 transition-opacity [@media(hover:hover)]:group-hover:opacity-100" />
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={onToggleSelect}
        aria-label={`Select "${request.title}"`}
        title={selected ? 'Selected — tap to unselect' : 'Select'}
        className="grid min-h-[44px] min-w-[40px] shrink-0 place-items-center"
      >
        <span
          data-tone={STATUS_TONE[request.status]}
          className={cx(
            'grid h-[18px] w-[18px] place-items-center rounded-full border-2 transition-colors',
            selected ? 'border-accent-500 bg-accent-500' : isDone ? 'border-[rgb(var(--tone))] bg-[rgb(var(--tone))]' : 'border-[rgb(var(--tone)/0.7)]',
          )}
        >
          {(selected || isDone) && <Check aria-hidden className="h-3 w-3 text-on-accent" strokeWidth={3} />}
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer flex-col gap-1.5 rounded-control py-2 pr-1 text-left"
      >
        <span className="flex items-start gap-2">
          <Truncate lines={2} className={cx('min-w-0 flex-1 text-body font-semibold', isDone ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg')}>{request.title}</Truncate>
          {request.page && request.page !== 'other' && <span className="chip mt-px shrink-0 font-mono text-micro">{request.page}</span>}
        </span>
        {preview && <Truncate lines={2} className="text-meta text-fg-muted">{preview}</Truncate>}
        <span className="flex flex-wrap items-center gap-1.5">
          {request.status !== 'open' && <TonePill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</TonePill>}
          {prompted && (
            <span data-tone="warn" className="tone-pill gap-1" title="A prompt was built for this request — open it to check each point">
              <Sparkles aria-hidden className="h-3 w-3 shrink-0" />Prompted
            </span>
          )}
          {parsed.recheck && (
            <span data-tone="info" className="tone-pill max-w-[12rem] gap-1" title={`Re-check of “${parsed.recheck.title}”`}>
              <CornerUpLeft aria-hidden className="h-3 w-3 shrink-0" /><Truncate reveal="none">{`Re-check · ${cleanText(parsed.recheck.title, 40)}`}</Truncate>
            </span>
          )}
          <TonePill tone={CATEGORY_TONE[request.category]}>{request.category}</TonePill>
          <span className="inline-flex items-center gap-1 text-meta text-fg-muted" title={`Priority: ${request.priority}`}>
            <ToneDot tone={PRIORITY_TONE[request.priority]} />{request.priority}
          </span>
          {request.effort && <span className="text-meta text-fg-faint">· {request.effort}</span>}
          {points.length > 1 && !progress && (
            <span className="inline-flex items-center gap-1 text-meta tabular-nums text-fg-muted" title="Points">
              <ListOrdered aria-hidden className="h-3.5 w-3.5 shrink-0" />{points.length}
            </span>
          )}
          {picks > 0 && (
            <span className="inline-flex items-center gap-1 text-meta tabular-nums text-fg-muted" title="Spots picked on the page">
              <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />{picks}
            </span>
          )}
          {hasDraft && <span data-tone="warn" className="tone-pill" title="Unsaved changes are kept on this device — open the request to continue">Unsaved edits</span>}
        </span>
        {progress && (
          <span className="flex flex-col gap-1">
            <ReviewMeter points={points} />
            <span className="text-meta tabular-nums text-fg-2">{progress}</span>
          </span>
        )}
        {timeline && <span className="text-meta tabular-nums text-fg-faint">{timeline}</span>}
      </button>

      <IconButton
        label="Delete request"
        onClick={onDelete}
        className="shrink-0 text-fg-faint hover:!text-danger [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
      >
        <Trash2 />
      </IconButton>
    </div>
  )
}
