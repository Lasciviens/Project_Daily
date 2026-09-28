import type { SetStateAction } from 'react'
import { DateNav } from './DateNav'
import { PeriodToggle, type Period } from './PeriodToggle'
import { labelForAnchor, stepAnchor } from './dateNav'

/** The page's one period + date control, directly under the section tabs:
 *  the period first, then the window's dates ("21.09 – 27.09"). The toggle's
 *  segments are equal-width and the date box has a fixed width that fits the
 *  longest label ("30.12.2025 – 05.01.2026", healthDateLabels
 *  NUMERIC_SPAN_MAX_CHARS), so nothing moves when the period or date changes. */
export function HealthRangeBar({ period, setPeriod, anchor, setAnchor, today }: {
  period: Period
  setPeriod: (v: SetStateAction<Period>) => void
  anchor: string
  setAnchor: (v: SetStateAction<string>) => void
  today: string
}) {
  return (
    <div role="group" aria-label="Period and dates" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="scroll-x max-w-full">
        <PeriodToggle value={period} onChange={setPeriod} dayLabel={anchor === today ? 'Today' : 'Day'} />
      </div>
      <DateNav
        label={labelForAnchor(period, anchor, today)}
        onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
        onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
        canGoNext={anchor < today}
        value={anchor}
        onPick={d => setAnchor(d > today ? today : d)}
      />
    </div>
  )
}
