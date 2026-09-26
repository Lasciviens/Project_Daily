import { ChevronRight, CircleCheckBig } from 'lucide-react'
import { fmtInt } from './tgAnalyticsFormat'
import { REVIEW_EMPTY_HINT, reviewHeadline, reviewOverlap } from './tgAnalyticsHealthCopy'
import { openNeedsReview } from './tgAnalyticsNav'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgAnalyticsHealthMeter } from './TgAnalyticsHealthMeter'

/**
 * The retro games Needs review would list, and why: each reason with how
 * many games have it (a bar is its share of those games). The button opens
 * the list itself, where each game can be fixed.
 */
export function TgAnalyticsReview({ review, className = '' }: {
  review: { games: number; reasons: { reason: string; count: number }[] }
  className?: string
}) {
  const { games, reasons } = review
  if (!games) {
    return (
      <TgAnalyticsCard label="Needs review" className={className}>
        <TgAnalyticsEmpty icon={CircleCheckBig} title="Nothing needs review" hint={REVIEW_EMPTY_HINT} />
      </TgAnalyticsCard>
    )
  }
  const overlap = reviewOverlap(review)

  return (
    <TgAnalyticsCard label="Needs review" meta="retro games" className={className}>
      <p className="flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--tg-text)]">{fmtInt(games)}</span>
        <span className="text-[13px] font-medium text-[var(--tg-text-2)]">{reviewHeadline(games)}</span>
      </p>
      <ul aria-label="Reasons" className="mt-4 flex flex-col gap-0.5">
        {reasons.map(r => (
          <li key={r.reason} className="grid min-h-[32px] grid-cols-[minmax(0,1fr)_minmax(3rem,32%)_2.75rem] items-center gap-x-3">
            <span className="truncate text-[13px] text-[var(--tg-text-2)]" title={r.reason}>{r.reason}</span>
            <TgAnalyticsHealthMeter value={r.count} max={games} />
            <span className="text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{fmtInt(r.count)}</span>
          </li>
        ))}
      </ul>
      {overlap && <p className="mt-2 text-[12px] leading-relaxed text-[var(--tg-muted)]">{overlap}</p>}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={openNeedsReview}
          className="tg-btn tg-btn-secondary min-h-[36px] w-full px-3 text-[13px] @[22rem]:w-auto [@media(pointer:coarse)]:min-h-[44px]"
        >
          Open Needs review
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </TgAnalyticsCard>
  )
}
