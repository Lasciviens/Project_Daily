import { Fragment, useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, Heart, HandCoins, Plus, RotateCcw, ShieldCheck, ShoppingBag, Tag, Wrench } from 'lucide-react'
import { cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import type { StoryKind, StoryStep } from '../../recordStory'

const ICON: Record<StoryKind, LucideIcon> = {
  wished: Heart, model: Heart, planned: CalendarClock, bought: ShoppingBag, accessory: Plus, cost: Wrench, value: Tag,
  gone: HandCoins, return: RotateCcw, complaint: ShieldCheck,
}

/**
 * The record's Story (recordStory.storyOf): the thing's life, oldest first,
 * each step with its day — a line of icons joined top to bottom, and "Today"
 * between what happened and the deadlines or plans still ahead (drawn open).
 */
export function RecordStory({ steps, today }: { steps: readonly StoryStep[]; today: string }) {
  const headId = useId()
  if (!steps.length) return null
  const firstAhead = steps.findIndex(s => s.ahead)
  return (
    <section aria-labelledby={headId} className="min-w-0">
      <h3 id={headId} className="section-label mb-2">Story</h3>
      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const Icon = ICON[s.kind]
          const last = i === steps.length - 1
          return (
            <Fragment key={s.key}>
              {i === firstAhead && (
                <li className="flex items-center gap-2 pb-2 pl-8 text-micro font-semibold uppercase tracking-[0.04em] text-fg-muted">
                  Today <span className="tabular-nums">{formatDate(today)}</span><span aria-hidden className="h-px flex-1 bg-line" />
                </li>
              )}
              <li className="relative flex gap-2.5">
                {/* The thread down to the next step. */}
                {!last && <span aria-hidden className={cx('absolute bottom-0 left-[11px] top-6', steps[i + 1].ahead ? 'w-0 border-l-2 border-dashed border-line-strong' : 'w-0.5 bg-line-strong')} />}
                <span aria-hidden className={cx('relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border',
                  s.ahead ? 'border-dashed border-line-strong bg-surface text-fg-muted' : 'border-line bg-surface-2 text-fg-2')}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className={cx('min-w-0 flex-1', !last && 'pb-3')}>
                  <span className="flex items-baseline gap-2">
                    <span className={cx('min-w-0 flex-1 break-words text-body', s.ahead ? 'text-fg-2' : 'text-fg')}>{s.title}</span>
                    <span className="shrink-0 text-meta tabular-nums text-fg-muted">{s.approx ? '≈ ' : ''}{formatDate(s.day)}</span>
                  </span>
                  {s.detail && <span className="block break-words text-meta tabular-nums text-fg-muted">{s.detail}</span>}
                </span>
              </li>
            </Fragment>
          )
        })}
      </ol>
    </section>
  )
}
