import { useMemo } from 'react'
import { Check, GripVertical, ListChecks, Sparkles, X } from 'lucide-react'
import type { DevRequest } from '../types'
import { foldCheckpoints, parseDescription, unlinkedPicks } from '../devRequestMarks'
import { isReviewable, requestPoints } from '../points'
import { useMarkRequestDone, useReviewPoint, useSendToRecheck } from '../hooks/usePointReview'
import { LinkedText } from './LinkedText'
import { MarkList } from './MarkList'
import { PointList, type PointReviewActions } from './PointList'
import { RecheckOfLink } from './RecheckOfLink'
import { IconButton, ToneDot, TonePill, cx } from '../../../shared/ui'
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
  /** Opens the request in the composer. */
  onOpen:        () => void
  /** Opens another request (a re-check, or the original of one). */
  onOpenRequest: (id: string) => void
}

/**
 * One request in the drawer. Its text shows with its links (a click opens
 * the spot — check a fix where it was reported). Once it went to Claude its
 * points (paragraphs) are listed and reviewed right here: Fixed, or Not
 * fixed with a note and Send to re-check.
 * The circle ticks it for the action bar (Mark
 * done, Delete, Build prompt); the rest of the card opens it in the composer,
 * where it is edited and its status changed. A request a prompt was built for
 * that is still open is flagged "Prompted" (warn): check the work, then close it.
 */
export function DevRequestCard({ request, hasDraft, selected, dragging, onDragStart, onDragEnd, onToggleSelect, onDelete, onOpen, onOpenRequest }: Props) {
  const isDone = request.status === 'done'
  const prompted = awaitingCheck(request)
  const timeline = cardTimeline(request)
  const parsed = useMemo(() => parseDescription(request.description), [request.description])
  const points = useMemo(() => requestPoints(parsed), [parsed])
  const reviewable = isReviewable(request) && points.length > 0
  // Older picks (not linked from the text) as rows; the page it was written
  // on stays out of sight.
  const marks = unlinkedPicks(parsed.marks)
  const body = useMemo(() => foldCheckpoints(parsed).body.trim(), [parsed])
  const reviewPoint = useReviewPoint()
  const sendToRecheck = useSendToRecheck()
  const markDone = useMarkRequestDone()
  const review: PointReviewActions | undefined = reviewable ? {
    onSet: (key, r) => reviewPoint(request, key, r),
    onSendRecheck: keys => sendToRecheck.mutate({ original: request, keys }),
    sending: sendToRecheck.isPending,
    onOpenRequest,
    onMarkDone: isDone ? undefined : () => markDone(request),
  } : undefined

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-tone={prompted ? 'warn' : undefined}
      className={cx(
        'group flex cursor-grab select-none flex-col rounded-row border py-1 pl-1 pr-1 transition-opacity',
        prompted ? 'tone-soft border-[rgb(var(--tone)/0.45)]' : 'border-line bg-surface',
        selected && 'ring-2 ring-accent-500/40',
        dragging && 'opacity-30',
        isDone && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical aria-hidden className="mt-3.5 h-4 w-4 shrink-0 text-fg-faint opacity-0 transition-opacity [@media(hover:hover)]:group-hover:opacity-100" />
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          onClick={onToggleSelect}
          aria-label={`Select "${request.title}"`}
          title={selected ? 'Selected — tap to unselect' : 'Select'}
          className="grid min-h-[44px] min-w-[36px] shrink-0 place-items-center lg:min-h-[40px]"
        >
          <span
            data-tone={STATUS_TONE[request.status]}
            className={cx(
              'grid h-4 w-4 place-items-center rounded-full border-2',
              selected ? 'border-accent-500 bg-accent-500' : 'border-[rgb(var(--tone))]',
            )}
          >
            {selected && <Check aria-hidden className="h-2.5 w-2.5 text-on-accent" strokeWidth={3} />}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onOpen}
            className="-mx-0.5 flex min-h-[44px] min-w-0 cursor-pointer flex-col gap-1 rounded-control px-0.5 py-2 text-left transition-colors [@media(hover:hover)]:hover:bg-surface-hover"
          >
            <span className="flex items-start justify-between gap-2">
              <span className={cx('min-w-0 text-body', isDone ? 'text-fg-faint line-through' : 'text-fg')}>{request.title}</span>
              {request.page && <span className="chip shrink-0 font-mono text-micro">{request.page}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {prompted && (
                <span data-tone="warn" className="tone-pill gap-1" title="A prompt was built for this request — check the result, then close it">
                  <Sparkles aria-hidden className="h-3 w-3 shrink-0" />Prompted
                </span>
              )}
              {request.status === 'in_progress' && <TonePill tone={STATUS_TONE.in_progress}>{STATUS_LABEL.in_progress}</TonePill>}
              <TonePill tone={CATEGORY_TONE[request.category]}>{request.category}</TonePill>
              <span className="inline-flex items-center gap-1 text-meta text-fg-muted" title={`Priority: ${request.priority}`}>
                <ToneDot tone={PRIORITY_TONE[request.priority]} />{request.priority}
              </span>
              {request.effort && <span className="text-meta text-fg-faint">· {request.effort}</span>}
              {!review && points.length > 1 && (
                <span className="inline-flex items-center gap-1 text-meta tabular-nums text-fg-muted">
                  <ListChecks aria-hidden className="h-3.5 w-3.5 shrink-0" />{points.length} points
                </span>
              )}
              {hasDraft && (
                <span data-tone="warn" className="tone-pill" title="Unsaved changes are kept on this device — open the request to continue">Unsaved edits</span>
              )}
            </span>
            {timeline && <span className="text-meta tabular-nums text-fg-muted">{timeline}</span>}
          </button>
          {parsed.recheck && <div className="pb-1"><RecheckOfLink recheck={parsed.recheck} onOpen={onOpenRequest} /></div>}
          {!review && body && <LinkedText text={body} marks={parsed.marks} lines={3} className="pb-1.5 pr-1 text-meta text-fg-2" />}
          {marks.length > 0 && <MarkList marks={marks} className="pb-1.5 pr-1" />}
        </div>

        <IconButton label="Delete request" onClick={onDelete} className="shrink-0 hover:!text-danger"><X /></IconButton>
      </div>
      {/* The points get the card's whole width: on a phone the column beside the select circle is narrow. */}
      {review && <PointList points={points} marks={parsed.marks} review={review} lines={2} className="px-1.5 pb-1.5 pt-0.5" />}
    </div>
  )
}
