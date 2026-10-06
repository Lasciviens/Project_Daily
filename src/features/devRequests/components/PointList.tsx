import { useState } from 'react'
import { ArrowUpRight, Check, CheckCheck, RotateCcw, Send, X } from 'lucide-react'
import type { Mark, PointReview } from '../devRequestMarks'
import { allResolved, reviewCounts, reviewProgress, type Point } from '../points'
import { LinkedText } from './LinkedText'
import { Button, IconButton, cx } from '../../../shared/ui'

export interface PointReviewActions {
  onSet: (key: string, review: Omit<PointReview, 'key'> | null) => void
  onSendRecheck: (keys: string[]) => void
  sending: boolean
  /** Opens another request (the re-check a point moved to). */
  onOpenRequest: (id: string) => void
  /** Offered once every point is Fixed or moved (absent: already done). */
  onMarkDone?: () => void
}

interface Props {
  points: readonly Point[]
  marks: readonly Mark[]
  /** Fixed / Not fixed per point (a request that went to Claude). */
  review?: PointReviewActions
  /** Lines of text per point before it is cut. */
  lines?: 1 | 2 | 3
  className?: string
}

/**
 * The request's points (its paragraphs), numbered as the prompt numbers
 * them. Once the request went to Claude each one is reviewed here: Fixed,
 * or Not fixed with a note of what is still wrong — and a Not fixed point
 * can be sent to the request's re-check request ("Re-check: <title>").
 */
export function PointList({ points, marks, review, lines = 2, className }: Props) {
  if (points.length === 0) return null
  const counts = reviewCounts(points)
  const progress = reviewProgress(points)
  const notFixed = points.filter(p => p.state === 'not_fixed').map(p => p.key)
  return (
    <section aria-label="Points" className={cx('flex flex-col gap-1', className)}>
      <div className="flex min-h-[28px] flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-muted">
        <span className="tabular-nums">{counts.total} point{counts.total === 1 ? '' : 's'}</span>
        {progress && <span className="tabular-nums">· {progress}</span>}
        {review && notFixed.length > 1 && (
          <Button size="sm" variant="ghost" icon={<Send />} loading={review.sending} onClick={() => review.onSendRecheck(notFixed)} className="ml-auto">
            Send {notFixed.length} not fixed to re-check
          </Button>
        )}
      </div>
      <ol className="flex flex-col gap-1">
        {points.map(p => (
          <PointRow key={p.key} point={p} marks={marks} review={review} lines={lines} />
        ))}
      </ol>
      {review?.onMarkDone && allResolved(points) && (
        <div data-tone="success" className="tone-soft flex flex-wrap items-center gap-2 rounded-row px-2.5 py-1.5">
          <span className="min-w-0 flex-1 text-meta text-fg-2">Every point is fixed{counts.moved ? ' or moved to a re-check' : ''}.</span>
          <Button size="sm" icon={<CheckCheck />} onClick={review.onMarkDone}>Mark request done</Button>
        </div>
      )}
    </section>
  )
}

function PointRow({ point: p, marks, review, lines }: { point: Point; marks: readonly Mark[]; review?: PointReviewActions; lines: 1 | 2 | 3 }) {
  const tone = p.state === 'fixed' ? 'success' : p.state === 'not_fixed' ? 'danger' : p.state === 'moved' ? 'info' : undefined
  return (
    <li className={cx('flex gap-2 rounded-row border px-2 py-1.5', p.state === 'moved' ? 'border-line bg-surface-2' : 'border-line bg-surface')}>
      <span
        data-tone={tone}
        aria-hidden
        className={cx(
          'mt-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-micro font-semibold tabular-nums',
          tone ? 'bg-[rgb(var(--tone))] text-on-accent' : 'bg-surface-2 text-fg-muted',
        )}
      >
        {p.state === 'fixed' ? <Check className="h-3 w-3" strokeWidth={3} /> : p.state === 'not_fixed' ? <X className="h-3 w-3" strokeWidth={3} /> : p.n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">Point {p.n}{p.state ? `, ${STATE_LABEL[p.state]}` : ''}:</span>
        <LinkedText text={p.text} marks={marks} lines={lines} className={cx('text-meta', p.state === 'fixed' || p.state === 'moved' ? 'text-fg-muted' : 'text-fg-2')} />
        {review && <ReviewControls point={p} review={review} />}
      </div>
      {review && (p.state === 'fixed' || p.state === 'not_fixed') && (
        <IconButton label={`Undo the review of point ${p.n}`} onClick={() => review.onSet(p.key, null)} className="-my-1 -mr-1 shrink-0"><RotateCcw /></IconButton>
      )}
    </li>
  )
}

const STATE_LABEL = { fixed: 'fixed', not_fixed: 'not fixed', moved: 'moved to re-check' } as const

function ReviewControls({ point: p, review }: { point: Point; review: PointReviewActions }) {
  if (p.state === 'moved') {
    return (
      <button
        type="button"
        onClick={() => p.review?.to && review.onOpenRequest(p.review.to)}
        disabled={!p.review?.to}
        title="Open the re-check request"
        className="flex min-h-[32px] items-center self-start [@media(pointer:coarse)]:min-h-[44px]"
      >
        <span data-tone="info" className="tone-pill gap-1">Moved to re-check<ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" /></span>
      </button>
    )
  }
  if (p.state === 'fixed') return <span data-tone="success" className="tone-pill self-start">Fixed</span>
  if (p.state === 'not_fixed') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-1.5">
          <span data-tone="danger" className="tone-pill">Not fixed</span>
          <Button size="sm" variant="ghost" icon={<Send />} loading={review.sending} onClick={() => review.onSendRecheck([p.key])} className="-ml-1">Send to re-check</Button>
        </div>
        <NoteField
          key={p.review?.note ?? ''}
          initial={p.review?.note ?? ''}
          onCommit={note => { if (note !== (p.review?.note ?? '')) review.onSet(p.key, { state: 'not_fixed', ...(note ? { note } : {}) }) }}
        />
      </div>
    )
  }
  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" icon={<Check />} onClick={() => review.onSet(p.key, { state: 'fixed' })} className="hover:!text-success">Fixed</Button>
      <Button size="sm" variant="ghost" icon={<X />} onClick={() => review.onSet(p.key, { state: 'not_fixed' })} className="hover:!text-danger">Not fixed</Button>
    </div>
  )
}

/** What is still wrong — saved when you leave the field or press Enter. */
function NoteField({ initial, onCommit }: { initial: string; onCommit: (note: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      onDragStart={e => { e.preventDefault(); e.stopPropagation() }}
      placeholder="What is still wrong? (optional)"
      aria-label="What is still wrong"
      className="input min-w-0"
    />
  )
}
